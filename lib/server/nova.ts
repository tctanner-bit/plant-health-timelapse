// Nova insights: frames from a camera read against that room's sensor history
// by a vision model, returned as structured, evidence-cited observations.
//
// The model call goes through the Growlink AI proxy (the same one the display
// app's Nova uses): the vendor key lives there, and the model and token caps
// are enforced there. This server authenticates to it with a service key.
//
// Server-only: needs the service role (frames, signing) and the caller's
// Growlink key (sensor history). Nothing here trusts the browser for data.

import { db, FRAMES_BUCKET } from "./supabase";
import type { CameraRow } from "./cameras";
import { Uom, getSensorChart, getSensors, METRIC_LABELS } from "../growlink";
import { SensorMeta, configuredSensors, displayRows, rowSeries, seriesFromChart } from "../sensors";

const PROXY_URL =
  process.env.NOVA_PROXY_URL ?? "https://qjitjkoerviorscyupun.supabase.co/functions/v1/ai";
const SIGN_TTL_SEC = 15 * 60;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

export type Concern = "none" | "watch" | "action";
export type FrameRef = { id: number; ts: number; label: string; role: string };
export type Observation = {
  text: string;
  category: string;
  concern: Concern;
  frames: { id: number; ts: number; label: string }[];
  sensors: string[];
};
export type NovaUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  usageId: number | null;
};

// Tags the proxy records against this call in the Growlink AI usage ledger.
export type UsageTags = { orgId: string; orgName: string | null; feature: string; ref: string };

export type NovaResult = {
  headline: string;
  concern: Concern;
  confidence: "low" | "medium" | "high";
  observations: Observation[];
  suggestions: string[];
  frames: FrameRef[];
  sensorSummary: SensorSummary[];
  model: string | null;
  usage: NovaUsage;
};

type SensorSummary = {
  label: string;
  unit: string;
  averagedOver?: number;
  min: number | null;
  minAt: string | null;
  max: number | null;
  maxAt: string | null;
  avg: number | null;
  lightsOnAvg: number | null;
  lightsOffAvg: number | null;
  hourly: (number | null)[];
};

export class NovaError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

// ------------------------------------------------------------------ frames

type FrameRow = { id: number; captured_at: string; storage_path: string };

async function framesBetween(cam: CameraRow, orgId: string, start: number, end: number) {
  const { data, error } = await db()
    .from("camera_frames")
    .select("id, captured_at, storage_path")
    .eq("camera_id", cam.id)
    .eq("org_id", orgId)
    .gte("captured_at", new Date(start).toISOString())
    .lte("captured_at", new Date(end).toISOString())
    .order("captured_at")
    .limit(2000);
  if (error) throw new NovaError("Could not read frames", 500);
  return (data ?? []) as FrameRow[];
}

function nearest(frames: FrameRow[], t: number, maxGap: number): FrameRow | null {
  let best: FrameRow | null = null;
  let bestGap = Infinity;
  for (const f of frames) {
    const gap = Math.abs(new Date(f.captured_at).getTime() - t);
    if (gap < bestGap) {
      best = f;
      bestGap = gap;
    }
  }
  return best && bestGap <= maxGap ? best : null;
}

// Lights-on/off from Growlink's day/night markers (y=1 starts a day).
function lightPeriods(markers: { x: string; y: number }[]) {
  return markers
    .map((m) => ({ t: new Date(m.x).getTime(), on: m.y === 1 }))
    .sort((a, b) => a.t - b.t);
}
function lightsOnAt(periods: { t: number; on: boolean }[], t: number): boolean | null {
  let state: boolean | null = null;
  for (const p of periods) {
    if (p.t > t) break;
    state = p.on;
  }
  return state;
}

// ----------------------------------------------------------------- sensors

async function summarizeSensors(
  apiKey: string,
  orgId: string,
  cam: CameraRow,
  start: number,
  end: number,
  uom: Uom | undefined,
  fmtTime: (t: number) => string
): Promise<{ summary: SensorSummary[]; periods: { t: number; on: boolean }[] }> {
  if (!cam.sensors?.length) return { summary: [], periods: [] };
  const roomSensors = await getSensors(apiKey, cam.room_id);
  const { meta } = configuredSensors(roomSensors, cam.sensors);
  if (!meta.length) return { summary: [], periods: [] };
  const chart = await getSensorChart(apiKey, orgId, meta.map((m) => m.id), start, end, uom);
  const periods = lightPeriods(chart.dayNight);
  const raw = seriesFromChart(chart, meta);
  const rows: SensorMeta[] = displayRows(meta, cam.average_same_type).map((r) => ({
    ...r,
    unit: raw.units[r.members[0]] ?? "",
  }));
  const { series } = rowSeries(raw.series, rows);

  const hours = Math.max(1, Math.ceil((end - start) / HOUR));
  const round = (v: number) => Math.round(v * 100) / 100;
  const summary = rows.map((r) => {
    const pts = (series[r.id] ?? []).filter((p) => p.t >= start && p.t <= end);
    const on = pts.filter((p) => lightsOnAt(periods, p.t) === true);
    const off = pts.filter((p) => lightsOnAt(periods, p.t) === false);
    const avg = (xs: { v: number }[]) => (xs.length ? round(xs.reduce((a, p) => a + p.v, 0) / xs.length) : null);
    const lo = pts.length ? pts.reduce((a, b) => (b.v < a.v ? b : a)) : null;
    const hi = pts.length ? pts.reduce((a, b) => (b.v > a.v ? b : a)) : null;
    const hourly = Array.from({ length: Math.min(hours, 48) }, (_, h) => {
      const bucket = pts.filter((p) => p.t >= start + h * HOUR && p.t < start + (h + 1) * HOUR);
      return avg(bucket);
    });
    return {
      label: r.label,
      unit: r.unit,
      ...(r.members.length > 1 ? { averagedOver: r.members.length } : {}),
      min: lo ? round(lo.v) : null,
      minAt: lo ? fmtTime(lo.t) : null,
      max: hi ? round(hi.v) : null,
      maxAt: hi ? fmtTime(hi.t) : null,
      avg: avg(pts),
      lightsOnAvg: avg(on),
      lightsOffAvg: avg(off),
      hourly,
    };
  });
  return { summary, periods };
}

// ------------------------------------------------------------------ prompt

const SYSTEM = `You are Nova, Growlink's crop advisor, reviewing time-lapse photos of a cultivation room's canopy together with that room's sensor history. Growers use your insights to decide what to check in person.

How to work:
- Compare the frames with each other (growth, posture, color, droop or curl, recovery) and relate what you see to the sensor data (temperature, humidity, VPD, CO2, light, substrate). Connect cause and effect only when both the images and the data support it.
- Report only what is visible or in the data. Never invent readings, times, or plant details. If something can't be judged from these photos, say so.
- Frames taken with lights off may be infrared (grey-scale) or dark; don't judge color from them.
- If a photo is blurry, obstructed, overexposed, or doesn't show plants, report that as an image_quality observation instead of guessing.
- Pests and disease (powdery mildew, botrytis, mites, thrips, aphids): only flag them if you can actually see signs; a wide canopy shot rarely shows them, so recommend a close inspection rather than a diagnosis.
- Be specific and brief: each observation is one or two sentences, cites the frames it comes from by their labels (F1, F2 …) and the sensors it relies on by their names exactly as given.
- concern: "action" only for a clear problem that needs attention today; "watch" for early or ambiguous signs worth rechecking; "none" when the canopy looks healthy and the environment is steady.
- confidence reflects image quality and how much the data supports your read.
- suggestions: at most three concrete checks or adjustments, each tied to an observation. No generic advice.
- headline: one short sentence a grower can read at a glance.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["headline", "concern", "confidence", "observations", "suggestions"],
  properties: {
    headline: { type: "string" },
    concern: { type: "string", enum: ["none", "watch", "action"] },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    observations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "category", "concern", "frames", "sensors"],
        properties: {
          text: { type: "string" },
          category: {
            type: "string",
            enum: ["growth", "stress", "pest_disease", "irrigation", "environment", "light", "image_quality"],
          },
          concern: { type: "string", enum: ["none", "watch", "action"] },
          frames: { type: "array", items: { type: "string" } },
          sensors: { type: "array", items: { type: "string" } },
        },
      },
    },
    suggestions: { type: "array", items: { type: "string" } },
  },
} as const;

async function callNova(context: string, images: { label: string; url: string; detail: "low" | "high" }[], tags: UsageTags) {
  const key = process.env.NOVA_SERVICE_KEY;
  if (!key) throw new NovaError("Nova isn't configured on this server yet", 503);

  const content: unknown[] = [{ type: "text", text: context }];
  for (const im of images) {
    content.push({ type: "text", text: im.label });
    content.push({ type: "image_url", image_url: { url: im.url, detail: im.detail } });
  }

  let res: Response;
  try {
    res = await fetch(`${PROXY_URL}?op=chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-service-key": key,
        "x-usage-product": "plant-health",
        "x-usage-feature": tags.feature,
        "x-usage-org": tags.orgId,
        ...(tags.orgName ? { "x-usage-org-name": encodeURIComponent(tags.orgName).slice(0, 120) } : {}),
        "x-usage-ref": tags.ref,
      },
      body: JSON.stringify({
        temperature: 0.2,
        max_tokens: 1000,
        response_format: { type: "json_schema", json_schema: { name: "nova_insight", strict: true, schema: SCHEMA } },
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content },
        ],
      }),
      signal: AbortSignal.timeout(55_000),
    });
  } catch {
    throw new NovaError("Nova didn't respond in time");
  }
  if (res.status === 401) throw new NovaError("Nova rejected this server's key", 503);
  if (res.status === 402) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new NovaError(b.error ?? "Nova's monthly limit for this organization has been reached", 402);
  }
  if (!res.ok) throw new NovaError(`Nova is unavailable (HTTP ${res.status})`);
  const body = (await res.json()) as {
    model?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    choices?: { message?: { content?: string; refusal?: string } }[];
  };
  const cost = res.headers.get("x-ai-cost-usd");
  const usageId = res.headers.get("x-ai-usage-id");
  const usage: NovaUsage = {
    inputTokens: body.usage?.prompt_tokens ?? null,
    outputTokens: body.usage?.completion_tokens ?? null,
    costUsd: cost != null && Number.isFinite(Number(cost)) ? Number(cost) : null,
    usageId: usageId != null && Number.isFinite(Number(usageId)) ? Number(usageId) : null,
  };
  const msg = body.choices?.[0]?.message;
  if (!msg?.content) throw new NovaError(msg?.refusal ? "Nova declined to analyze these frames" : "Nova returned nothing");
  try {
    return { parsed: JSON.parse(msg.content), model: body.model ?? null, usage };
  } catch {
    throw new NovaError("Nova's reply wasn't readable");
  }
}

// --------------------------------------------------------------- analyses

type Ctx = { apiKey: string; orgId: string; orgName: string | null };
type Cam = CameraRow;

function timeFmt(tz: string | undefined) {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: tz };
  let f: Intl.DateTimeFormat;
  try {
    f = new Intl.DateTimeFormat("en-US", opts);
  } catch {
    f = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: undefined });
  }
  return (t: number) => f.format(new Date(t));
}

async function sign(paths: string[]) {
  const { data, error } = await db().storage.from(FRAMES_BUCKET).createSignedUrls(paths, SIGN_TTL_SEC);
  if (error) throw new NovaError("Could not prepare frames", 500);
  return new Map(data.map((d) => [d.path, d.signedUrl]));
}

function finish(parsed: any, frames: FrameRef[], summary: SensorSummary[], model: string | null, usage: NovaUsage): NovaResult {
  const byLabel = new Map(frames.map((f) => [f.label, f]));
  const labels = new Set(summary.map((s) => s.label));
  const concerns: Concern[] = ["none", "watch", "action"];
  const observations: Observation[] = (Array.isArray(parsed.observations) ? parsed.observations : [])
    .slice(0, 8)
    .map((o: any) => ({
      text: String(o.text ?? "").slice(0, 600),
      category: String(o.category ?? "environment"),
      concern: concerns.includes(o.concern) ? o.concern : "none",
      // Keep only citations that point at frames and sensors we actually sent.
      frames: (o.frames ?? [])
        .map((l: string) => byLabel.get(String(l).trim()))
        .filter(Boolean)
        .map((f: FrameRef) => ({ id: f.id, ts: f.ts, label: f.label })),
      sensors: (o.sensors ?? []).map(String).filter((s: string) => labels.has(s)),
    }))
    .filter((o: Observation) => o.text);
  return {
    headline: String(parsed.headline ?? "").slice(0, 200) || "No clear change",
    concern: concerns.includes(parsed.concern) ? parsed.concern : "none",
    confidence: ["low", "medium", "high"].includes(parsed.confidence) ? parsed.confidence : "low",
    observations,
    suggestions: (Array.isArray(parsed.suggestions) ? parsed.suggestions : []).slice(0, 3).map((s: unknown) => String(s).slice(0, 300)),
    frames,
    sensorSummary: summary,
    model,
    usage,
  };
}

/**
 * A day's insight: three frames across the lights-on period, plus the same
 * time the previous day and a week earlier when those exist, read against
 * the day's sensor summary.
 */
export async function analyzeDay(
  ctx: Ctx,
  cam: Cam,
  opts: { start: number; end: number; tz?: string; uom?: Uom; ref: string }
): Promise<NovaResult> {
  const { start, end } = opts;
  const fmt = timeFmt(opts.tz);
  const day = await framesBetween(cam, ctx.orgId, start, end);
  if (day.length < 3) throw new NovaError("Not enough frames that day for Nova to compare", 409);

  const { summary, periods } = await summarizeSensors(ctx.apiKey, ctx.orgId, cam, start, end, opts.uom, fmt);

  // Targets inside the lights-on period if Growlink knows it, else across the day.
  const on = periods.find((p) => p.on && p.t >= start && p.t < end)?.t;
  const off = periods.find((p) => !p.on && on != null && p.t > on && p.t <= end)?.t;
  const a = on ?? start + 6 * HOUR;
  const b = off ?? end - 2 * HOUR;
  const targets = [
    { t: a + HOUR, role: "early lights-on" },
    { t: (a + b) / 2, role: "mid photoperiod" },
    { t: b - HOUR, role: "late lights-on" },
  ];

  const picked: { row: FrameRow; role: string; detail: "low" | "high" }[] = [];
  for (const [i, tg] of targets.entries()) {
    const f = nearest(day, tg.t, 2 * HOUR);
    if (f && !picked.some((p) => p.row.id === f.id)) picked.push({ row: f, role: tg.role, detail: i === 0 ? "low" : "high" });
  }
  if (picked.length < 2) throw new NovaError("Not enough frames during lights-on for Nova to compare", 409);

  // Same time of day, one day and one week earlier, for growth comparison.
  const mid = targets[1].t;
  for (const [back, role] of [[DAY, "same time the previous day"], [7 * DAY, "same time a week earlier"]] as const) {
    const window = await framesBetween(cam, ctx.orgId, mid - back - HOUR, mid - back + HOUR);
    const f = nearest(window, mid - back, HOUR);
    if (f) picked.push({ row: f, role, detail: "low" });
  }

  return run(ctx, picked, summary, fmt, { feature: "daily_review", ref: opts.ref }, {
    intro: `Daily review of camera "${cam.name}" for ${fmt(start)} – ${fmt(end)}.`,
  });
}

/**
 * One moment: the frame nearest `at`, an hour before, and the same time the
 * previous day, with the surrounding six hours of sensor data and an
 * optional question from the grower.
 */
export async function analyzeMoment(
  ctx: Ctx,
  cam: Cam,
  opts: { at: number; question?: string; tz?: string; uom?: Uom; ref: string }
): Promise<NovaResult & { periodStart: number; periodEnd: number }> {
  const fmt = timeFmt(opts.tz);
  const start = opts.at - 6 * HOUR;
  const end = opts.at + 30 * 60_000;
  const around = await framesBetween(cam, ctx.orgId, start, end);
  const focus = nearest(around, opts.at, 30 * 60_000);
  if (!focus) throw new NovaError("No frame near that time", 409);

  const picked: { row: FrameRow; role: string; detail: "low" | "high" }[] = [{ row: focus, role: "the moment in question", detail: "high" }];
  const t = new Date(focus.captured_at).getTime();
  const hourBefore = nearest(around, t - HOUR, 20 * 60_000);
  if (hourBefore && hourBefore.id !== focus.id) picked.push({ row: hourBefore, role: "an hour earlier", detail: "low" });
  const yWindow = await framesBetween(cam, ctx.orgId, t - DAY - HOUR, t - DAY + HOUR);
  const yesterday = nearest(yWindow, t - DAY, HOUR);
  if (yesterday) picked.push({ row: yesterday, role: "same time the previous day", detail: "low" });

  const { summary } = await summarizeSensors(ctx.apiKey, ctx.orgId, cam, start, end, opts.uom, fmt);
  const q = opts.question?.trim().slice(0, 500);
  const result = await run(ctx, picked, summary, fmt, { feature: "moment", ref: opts.ref }, {
    intro: `Look at camera "${cam.name}" at ${fmt(t)}. The sensor summary covers the six hours before it.`,
    question: q,
  });
  return { ...result, periodStart: start, periodEnd: end };
}

async function run(
  ctx: Ctx,
  picked: { row: FrameRow; role: string; detail: "low" | "high" }[],
  summary: SensorSummary[],
  fmt: (t: number) => string,
  tag: { feature: string; ref: string },
  extra: { intro: string; question?: string }
): Promise<NovaResult> {
  // Chronological labels F1, F2 … so the model can cite them.
  const ordered = [...picked].sort((a, b) => new Date(a.row.captured_at).getTime() - new Date(b.row.captured_at).getTime());
  const urls = await sign(ordered.map((p) => p.row.storage_path));
  const frames: FrameRef[] = ordered.map((p, i) => ({
    id: p.row.id,
    ts: new Date(p.row.captured_at).getTime(),
    label: `F${i + 1}`,
    role: p.role,
  }));
  const images = ordered.map((p, i) => ({
    label: `${frames[i].label} — ${fmt(frames[i].ts)} (${p.role})`,
    url: urls.get(p.row.storage_path)!,
    detail: p.detail,
  }));

  const sensorText = summary.length
    ? JSON.stringify(summary)
    : "No sensors are configured for this camera; base your read on the images only and say so.";
  const context = [
    extra.intro,
    extra.question ? `The grower asks: "${extra.question}" — answer it directly in the headline and first observation.` : null,
    `Frames (oldest first): ${frames.map((f) => `${f.label} = ${fmt(f.ts)}, ${f.role}`).join("; ")}.`,
    `Sensor summary (values in the units shown; "hourly" is one average per hour from the start of the period; lightsOnAvg/lightsOffAvg split by the room's light schedule; averagedOver = number of sensors combined): ${sensorText}`,
    `Metric names you may see: ${Object.values(METRIC_LABELS).join(", ")}.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const { parsed, model, usage } = await callNova(context, images, {
    orgId: ctx.orgId,
    orgName: ctx.orgName,
    feature: tag.feature,
    ref: tag.ref,
  });
  return finish(parsed, frames, summary, model, usage);
}
