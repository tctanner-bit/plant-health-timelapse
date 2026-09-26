// Background Nova. Two jobs, both started by the database's scheduler
// (pg_cron → pg_net → our /api/jobs routes):
//
//   runWatch()    every 5 minutes. Cheap checks with no AI on each camera's
//                 newest frame and its room's live sensors. A condition that
//                 holds on two runs in a row trips a trigger; a trigger queues
//                 a Nova "alert" review of the last three hours. Also queues
//                 each camera's daily review once its org's day is over.
//   runNovaJob()  every minute. Runs one queued review.
//
// Cost is capped per camera: at most ALERTS_PER_DAY alerts, and the same
// trigger at most once per COOLDOWN_MS. Thresholds are first guesses;
// every trip is logged in camera_events so they can be tuned.

import { db, FRAMES_BUCKET } from "./supabase";
import type { CameraRow } from "./cameras";
import { access, billingConfigured, getBilling } from "./billing";
import { dropRejectedKey, loadMonitoring, markKeyUsed } from "./monitoring";
import { Lights, decodeThumb, encodeThumb, frameStats, lightsFrom, visualDifference } from "./frame-stats";
import { GrowlinkError, LiveReading, getLiveSensors } from "../growlink";
import { analyzeDay, analyzeRange } from "./nova";
import { completeInsight } from "./insights";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const ALERTS_PER_DAY = 6;
const COOLDOWN_MS = 3 * HOUR;
const CONFIRM_RUNS = 2; // a condition must hold this many runs in a row
const VISUAL_CHANGE = 0.15; // normalized thumbnail difference vs an hour ago
const ALERT_WINDOW_MS = 3 * HOUR;
const TIME_BUDGET_MS = 45_000;

// Readings are requested in Growlink's default units (°F, kPa, ppm).
type Rule = { metric: number; label: string; unit: string; min: number; max: number; swing?: number; digits: number };
const RULES: Rule[] = [
  { metric: 0, label: "Temperature", unit: "°F", min: 60, max: 90, swing: 6, digits: 1 },
  { metric: 1, label: "Humidity", unit: "%", min: 30, max: 80, swing: 15, digits: 0 },
  { metric: 8, label: "VPD", unit: " kPa", min: 0.4, max: 1.8, digits: 2 },
  { metric: 3, label: "CO₂", unit: " ppm", min: 250, max: 2000, digits: 0 },
  { metric: 2, label: "pH", unit: "", min: 5.0, max: 7.0, digits: 2 },
];

type Cam = CameraRow & { org_id: string; org_name: string | null };
type Condition = { kind: string; label: string; detail: string; question: string };
type State = {
  pending?: Record<string, number>;
  readings?: Record<string, { t: number; v: number }[]>;
  cooldown?: Record<string, number>;
};

// ------------------------------------------------------------------ helpers

async function takeLock(name: string, holdMs: number): Promise<boolean> {
  const now = new Date();
  const { data } = await db()
    .from("job_locks")
    .update({ locked_until: new Date(now.getTime() + holdMs).toISOString() })
    .eq("name", name)
    .lt("locked_until", now.toISOString())
    .select("name");
  return !!data?.length;
}
async function releaseLock(name: string) {
  await db().from("job_locks").update({ locked_until: new Date().toISOString() }).eq("name", name);
}

const fmtTime = (t: number, tz: string | null) => {
  try {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: tz ?? undefined }).format(new Date(t));
  } catch {
    return new Date(t).toISOString().slice(11, 16) + " UTC";
  }
};

// Local calendar parts and midnights in an IANA zone, without a library.
function zoneParts(t: number, tz: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}
function zoneOffset(t: number, tz: string) {
  const p = zoneParts(t, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
}
function zonedMidnight(y: number, m: number, d: number, tz: string) {
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - zoneOffset(guess, tz);
  return guess - zoneOffset(first, tz);
}
const label = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

async function statsNear(cameraId: string, t: number, within: number) {
  const { data } = await db()
    .from("camera_frame_stats")
    .select("frame_id, captured_at, brightness, ir, thumb")
    .eq("camera_id", cameraId)
    .gte("captured_at", new Date(t - within).toISOString())
    .lte("captured_at", new Date(t + within).toISOString())
    .limit(20);
  let best: { brightness: number; ir: boolean; thumb: string; ts: number } | null = null;
  for (const r of data ?? []) {
    const ts = Date.parse(r.captured_at);
    if (!best || Math.abs(ts - t) < Math.abs(best.ts - t)) best = { brightness: r.brightness, ir: r.ir, thumb: r.thumb, ts };
  }
  return best;
}

// --------------------------------------------------------------- watchers

async function frameConditions(cam: Cam, tz: string | null, lastId: number | null): Promise<{ checked: boolean; frameId?: number; conds: Condition[] }> {
  const { data: f } = await db()
    .from("camera_frames")
    .select("id, captured_at, storage_path")
    .eq("camera_id", cam.id)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!f || f.id === lastId) return { checked: false, conds: [] }; // nothing new
  const t = Date.parse(f.captured_at);
  if (Date.now() - t > 30 * MIN) return { checked: false, conds: [] }; // offline: the app already shows that

  const { data: blob, error } = await db().storage.from(FRAMES_BUCKET).download(f.storage_path);
  if (error || !blob) return { checked: false, conds: [] };
  const s = await frameStats(Buffer.from(await blob.arrayBuffer()));
  await db().from("camera_frame_stats").upsert({
    frame_id: f.id,
    camera_id: cam.id,
    captured_at: f.captured_at,
    brightness: s.brightness,
    chroma: s.chroma,
    ir: s.ir,
    thumb: encodeThumb(s.thumb),
  });

  const conds: Condition[] = [];
  const now: Lights = lightsFrom(s);
  const at = fmtTime(t, tz);

  // Lights: different from the same time yesterday.
  const y = await statsNear(cam.id, t - DAY, 20 * MIN);
  if (y) {
    const then = lightsFrom(y);
    if (now !== "dim" && then !== "dim" && now !== then) {
      conds.push({
        kind: "lights",
        label: now === "off" ? "Lights off unexpectedly" : "Lights on unexpectedly",
        detail: `Lights look ${now.toUpperCase()} at ${at}; they were ${then.toUpperCase()} at this time yesterday.`,
        question: `A background check noticed the lights look ${now.toUpperCase()} at ${at}, but they were ${then.toUpperCase()} at this time yesterday. Confirm from the frames whether the lighting really changed, when it happened, and whether the plants or environment show any effect.`,
      });
    }
  }

  // Visual change vs about an hour ago, both lit (not a lights change).
  const h = await statsNear(cam.id, t - HOUR, 15 * MIN);
  if (h && now === "on" && lightsFrom(h) === "on") {
    const diff = visualDifference(s.thumb, decodeThumb(h.thumb));
    if (diff > VISUAL_CHANGE) {
      conds.push({
        kind: "visual_change",
        label: "Canopy looks different",
        detail: `The picture changed noticeably in the last hour (difference ${diff.toFixed(2)}).`,
        question: `A background check noticed the canopy picture changed noticeably over the hour before ${at} (not a lights change). Describe what changed — plant posture or color, camera position, something blocking the view, people working — and whether it matters for the crop.`,
      });
    }
  }
  return { checked: true, frameId: f.id, conds };
}

function sensorConditions(
  cam: Cam,
  live: Map<string, LiveReading>,
  state: State,
  tz: string | null
): { checked: boolean; conds: Condition[] } {
  const now = Date.now();
  const byMetric = new Map<number, number[]>();
  for (const id of cam.sensors ?? []) {
    const r = live.get(id.toLowerCase());
    if (!r || now - Date.parse(r.timestamp) > 20 * MIN) continue;
    const list = byMetric.get(r.metric) ?? [];
    list.push(r.value);
    byMetric.set(r.metric, list);
  }
  if (byMetric.size === 0) return { checked: false, conds: [] };

  const conds: Condition[] = [];
  const readings = (state.readings ??= {});
  const at = fmtTime(now, tz);
  for (const rule of RULES) {
    const vals = byMetric.get(rule.metric);
    if (!vals?.length) continue;
    const v = vals.reduce((a, b) => a + b, 0) / vals.length;
    const shown = `${v.toFixed(rule.digits)}${rule.unit}`;
    const key = String(rule.metric);
    const hist = (readings[key] ?? []).filter((p) => now - p.t <= 45 * MIN);

    if (v > rule.max || v < rule.min) {
      const high = v > rule.max;
      const bound = `${high ? rule.max : rule.min}${rule.unit}`;
      conds.push({
        kind: `range:${rule.metric}`,
        label: `${rule.label} ${high ? "high" : "low"}`,
        detail: `${rule.label} ${shown} at ${at}, ${high ? "above" : "below"} ${bound}.`,
        question: `A background check found ${rule.label} at ${shown} (${high ? "above" : "below"} ${bound}) for at least ten minutes as of ${at}. Look for effects on the canopy across these frames and relate them to the sensor data.`,
      });
    }
    if (rule.swing) {
      const old = hist.find((p) => now - p.t >= 20 * MIN && now - p.t <= 35 * MIN);
      if (old && Math.abs(v - old.v) >= rule.swing) {
        const dir = v > old.v ? "rose" : "fell";
        conds.push({
          kind: `swing:${rule.metric}`,
          label: `${rule.label} ${dir} fast`,
          detail: `${rule.label} ${dir} from ${old.v.toFixed(rule.digits)} to ${shown} in about half an hour (to ${at}).`,
          question: `A background check found ${rule.label} ${dir} from ${old.v.toFixed(rule.digits)}${rule.unit} to ${shown} in about half an hour, ending ${at}. Say what likely caused it if the frames or other sensors show it, and whether the plants react.`,
        });
      }
    }
    hist.push({ t: now, v });
    readings[key] = hist;
  }
  return { checked: true, conds };
}

// ------------------------------------------------------------------- jobs

async function queueDaily(cam: Cam, tz: string) {
  const now = Date.now();
  const p = zoneParts(now, tz);
  if (p.h < 1) return; // let the day finish and its last frames arrive
  const yd = new Date(Date.UTC(p.y, p.m - 1, p.d - 1));
  const dayLabel = label(yd.getUTCFullYear(), yd.getUTCMonth() + 1, yd.getUTCDate());
  const start = zonedMidnight(yd.getUTCFullYear(), yd.getUTCMonth() + 1, yd.getUTCDate(), tz);
  const end = zonedMidnight(p.y, p.m, p.d, tz);
  if (!cam.claimed_at || Date.parse(cam.claimed_at) > end) return;

  const { data: have } = await db()
    .from("camera_insights")
    .select("id")
    .eq("camera_id", cam.id)
    .eq("kind", "daily")
    .eq("day_label", dayLabel)
    .limit(1);
  if (have?.length) return;
  const { count } = await db()
    .from("camera_frames")
    .select("id", { count: "exact", head: true })
    .eq("camera_id", cam.id)
    .gte("captured_at", new Date(start).toISOString())
    .lt("captured_at", new Date(end).toISOString());
  if ((count ?? 0) < 3) return;
  // The unique (camera, day) index makes a race with the app harmless.
  await db().from("camera_insights").insert({
    camera_id: cam.id,
    org_id: cam.org_id,
    kind: "daily",
    status: "queued",
    day_label: dayLabel,
    period_start: new Date(start).toISOString(),
    period_end: new Date(end).toISOString(),
  });
}

async function fire(cam: Cam, conds: Condition[]) {
  const now = Date.now();
  const events = conds.map((c) => ({ camera_id: cam.id, org_id: cam.org_id, kind: c.kind, detail: { label: c.label, detail: c.detail } }));
  const { count } = await db()
    .from("camera_insights")
    .select("id", { count: "exact", head: true })
    .eq("camera_id", cam.id)
    .eq("kind", "alert")
    .gte("created_at", new Date(now - DAY).toISOString());
  if ((count ?? 0) >= ALERTS_PER_DAY) {
    await db().from("camera_events").insert(events.map((e) => ({ ...e, detail: { ...e.detail, skipped: "daily alert limit" } })));
    return;
  }
  // Several trips at once become one review.
  const { data: ins } = await db()
    .from("camera_insights")
    .insert({
      camera_id: cam.id,
      org_id: cam.org_id,
      kind: "alert",
      status: "queued",
      period_start: new Date(now - ALERT_WINDOW_MS).toISOString(),
      period_end: new Date(now).toISOString(),
      question: conds.map((c) => c.question).join(" Also: "),
      trigger: {
        kind: conds.map((c) => c.kind).join(","),
        label: conds.map((c) => c.label).join(" · "),
        detail: conds.map((c) => c.detail).join(" "),
      },
    })
    .select("id")
    .single();
  await db().from("camera_events").insert(events.map((e) => ({ ...e, insight_id: ins?.id ?? null })));
}

export async function runWatch(): Promise<Record<string, unknown>> {
  const started = Date.now();
  if (!(await takeLock("watch", 4 * MIN))) return { skipped: "another run is in progress" };
  const summary = { cameras: 0, checkedFrames: 0, checkedSensors: 0, triggers: 0, dailies: 0, orgsSkipped: 0, timedOut: false };
  try {
    const { data: cams } = await db()
      .from("cameras")
      .select("*")
      .not("org_id", "is", null)
      .is("revoked_at", null);
    const byOrg = new Map<string, Cam[]>();
    for (const c of (cams ?? []) as Cam[]) byOrg.set(c.org_id, [...(byOrg.get(c.org_id) ?? []), c]);

    const { data: watchRows } = await db().from("camera_watch").select("*");
    const watch = new Map((watchRows ?? []).map((w: any) => [w.camera_id as string, w]));

    for (const [orgId, list] of byOrg) {
      if (Date.now() - started > TIME_BUDGET_MS) { summary.timedOut = true; break; }

      if (billingConfigured()) {
        const b = await getBilling(orgId, list[0].org_name).catch(() => null);
        if (b && !access(b).entitled) { summary.orgsSkipped++; continue; }
      }
      const { row: mon, apiKey } = await loadMonitoring(orgId);
      if (mon && !mon.enabled) { summary.orgsSkipped++; continue; }
      const tz = mon?.tz ?? null;

      // One batched live-data call for every sensor the org's cameras use.
      const live = new Map<string, LiveReading>();
      const ids = Array.from(new Set(list.flatMap((c) => (c.sensors ?? []).map((s) => s.toLowerCase()))));
      if (apiKey && ids.length) {
        try {
          for (const r of await getLiveSensors(apiKey, orgId, ids)) live.set(r.sensorId.toLowerCase(), r);
          await markKeyUsed(orgId);
        } catch (e) {
          if (e instanceof GrowlinkError && e.status === 401) await dropRejectedKey(orgId, "Growlink rejected the stored key");
          else console.error("watch: live sensors failed", orgId, e instanceof Error ? e.message : e);
        }
      }

      for (const cam of list) {
        if (Date.now() - started > TIME_BUDGET_MS) { summary.timedOut = true; break; }
        summary.cameras++;
        const w = watch.get(cam.id);
        const state: State = (w?.state as State) ?? {};
        const pending = (state.pending ??= {});
        const cooldown = (state.cooldown ??= {});

        const conds: Condition[] = [];
        let frameChecked = false;
        let lastFrameId: number | null = w?.last_frame_id ?? null;
        try {
          // Only look again when there's a new frame.
          if (cam.last_frame_at) {
            const fr = await frameConditions(cam, tz, w?.last_frame_id ?? null);
            if (fr.checked) {
              frameChecked = true;
              lastFrameId = fr.frameId ?? lastFrameId;
              conds.push(...fr.conds);
              summary.checkedFrames++;
            }
          }
        } catch (e) {
          console.error("watch: frame check failed", cam.id, e instanceof Error ? e.message : e);
        }
        const sc = sensorConditions(cam, live, state, tz);
        if (sc.checked) summary.checkedSensors++;
        conds.push(...sc.conds);

        // Confirmation: a condition must repeat on the next check of its kind.
        const now = Date.now();
        const seen = new Set(conds.map((c) => c.kind));
        for (const k of Object.keys(pending)) {
          const isFrame = k === "lights" || k === "visual_change";
          if (!seen.has(k) && (isFrame ? frameChecked : sc.checked)) delete pending[k];
        }
        const firing: Condition[] = [];
        for (const c of conds) {
          pending[c.kind] = (pending[c.kind] ?? 0) + 1;
          if (pending[c.kind] >= CONFIRM_RUNS && now - (cooldown[c.kind] ?? 0) > COOLDOWN_MS) {
            firing.push(c);
            cooldown[c.kind] = now;
            delete pending[c.kind];
          }
        }
        if (firing.length) {
          await fire(cam, firing);
          summary.triggers += firing.length;
        }

        if (tz) {
          try {
            await queueDaily(cam, tz);
          } catch (e) {
            console.error("watch: daily queue failed", cam.id, e instanceof Error ? e.message : e);
          }
        }

        for (const k of Object.keys(cooldown)) if (now - cooldown[k] > DAY) delete cooldown[k];
        await db().from("camera_watch").upsert({
          camera_id: cam.id,
          last_run_at: new Date().toISOString(),
          last_frame_id: lastFrameId,
          state,
        });
      }
    }
  } finally {
    await releaseLock("watch");
  }
  return summary;
}

/** Run one queued Nova review (daily or alert). */
export async function runNovaJob(): Promise<Record<string, unknown>> {
  const { data, error } = await db().rpc("claim_insight_job");
  if (error) return { error: "claim failed" };
  const job = (data ?? [])[0] as any;
  if (!job) return { idle: true };

  const { data: cam } = await db().from("cameras").select("*").eq("id", job.camera_id).maybeSingle();
  if (!cam || cam.org_id !== job.org_id || cam.revoked_at) {
    await db().from("camera_insights").update({ status: "failed", error: "Camera no longer in this organization" }).eq("id", job.id);
    return { id: job.id, failed: true };
  }
  const { row: mon, apiKey } = await loadMonitoring(job.org_id);
  const ctx = { apiKey: apiKey ?? "", orgId: job.org_id as string, orgName: (cam.org_name as string | null) ?? null };
  const tz = mon?.tz ?? undefined;
  const ref = `camera:${cam.id};insight:${job.id}`;
  const start = Date.parse(job.period_start);
  const end = Date.parse(job.period_end);

  const analyze = (c: typeof ctx) =>
    job.kind === "daily"
      ? analyzeDay(c, cam, { start, end, tz, ref })
      : analyzeRange(c, cam, { start, end, question: job.question ?? undefined, tz, ref });

  const r = await completeInsight(job.id, async () => {
    try {
      return await analyze(ctx);
    } catch (e) {
      // A stored key Growlink no longer accepts: drop it, review frames only.
      if (e instanceof GrowlinkError && e.status === 401 && ctx.apiKey) {
        await dropRejectedKey(ctx.orgId, "Growlink rejected the stored key");
        return analyze({ ...ctx, apiKey: "" });
      }
      throw e;
    }
  });
  return { id: job.id, kind: job.kind, ...("error" in r ? { error: r.error } : { ok: true }) };
}
