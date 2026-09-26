"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  Insight,
  listFrames,
  listInsights,
  requestDailyInsight,
  requestMomentInsight,
  signFrames,
  updateCamera,
} from "../lib/api";
import { Sensor, Uom, getSensorChart, getSensors } from "../lib/growlink";
import {
  SensorMeta,
  Series,
  configuredSensors,
  displayRows,
  rowSeries,
  seriesFromChart,
} from "../lib/sensors";
import { loadUom, saveUom } from "../lib/prefs";
import DisplaySettings from "./DisplaySettings";
import SensorReadouts from "./SensorReadouts";
import SensorCharts from "./SensorCharts";
import SensorToggles from "./SensorToggles";
import TimeRangeBar from "./TimeRangeBar";
import NovaPanel from "./NovaPanel";
import { Brand } from "./ui";

type Frame = { id: number; ts: number };

const DAY = 24 * 3600 * 1000;
const PREFETCH = 20;

export default function Player({
  apiKey,
  orgId,
  camera,
  roomName,
  onBack,
  onCameraChange,
}: {
  apiKey: string;
  orgId: string;
  camera: Camera;
  roomName: string;
  onBack: () => void;
  onCameraChange: (c: Camera) => void;
}) {
  const [bounds, setBounds] = useState<{ first: number; last: number } | null | undefined>(undefined);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(8);
  const [error, setError] = useState<string | null>(null);

  const [roomSensors, setRoomSensors] = useState<Sensor[] | null>(null);
  const [units, setUnits] = useState<Record<string, string>>({});
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [raw, setRaw] = useState<Series | null>(null);
  const [uom, setUom] = useState<Uom>(() => loadUom());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nights, setNights] = useState<[number, number][]>([]);
  const [sensorError, setSensorError] = useState<string | null>(null);

  const [novaOpen, setNovaOpen] = useState(false);
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [dailyBusy, setDailyBusy] = useState<string | null>(null);
  const dailyTried = useRef(false);

  const timer = useRef<number | null>(null);
  const pendingJump = useRef<number | null>(null);
  const requested = useRef<Set<number>>(new Set());
  // Set when live updates extend the range themselves, so effect 2 doesn't
  // refetch the whole range and jump the playhead.
  const appendOnly = useRef(false);

  // 1. Camera history bounds → default to the most recent day.
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await listFrames(apiKey, orgId, camera.id);
        if (dead) return;
        if (r.first == null || r.last == null) return setBounds(null);
        setBounds({ first: r.first, last: r.last });
        setRange([Math.max(r.first, r.last - DAY), r.last]);
      } catch (e: any) {
        if (!dead) setError(e.message);
      }
    })();
    return () => { dead = true; };
  }, [apiKey, orgId, camera.id]);

  // 2. Frames for the selected range (debounced while the user drags dates).
  useEffect(() => {
    if (!range) return;
    if (appendOnly.current) {
      appendOnly.current = false;
      return;
    }
    let dead = false;
    const h = window.setTimeout(async () => {
      try {
        const r = await listFrames(apiKey, orgId, camera.id, range[0], range[1]);
        if (dead) return;
        setFrames(r.frames);
        if (r.first != null && r.last != null) setBounds({ first: r.first, last: r.last });
        const jump = pendingJump.current;
        pendingJump.current = null;
        setIndex(jump != null ? nearestIndex(r.frames, jump) : Math.max(0, r.frames.length - 1));
      } catch (e: any) {
        if (!dead) setError(e.message);
      }
    }, 250);
    return () => { dead = true; window.clearTimeout(h); };
  }, [apiKey, orgId, camera.id, range]);

  // 2b. Live: check for new frames every minute. When the selected range ends
  // at the newest frame (the default), new frames are appended and, if you're
  // parked on the last frame, the playhead moves to the newest one.
  const liveState = useRef({ frames, index, range, bounds, playing });
  liveState.current = { frames, index, range, bounds, playing };
  useEffect(() => {
    let busy = false;
    const tick = async () => {
      const cur = liveState.current;
      if (busy || document.visibilityState !== "visible" || !cur.bounds || !cur.range || !cur.frames) return;
      busy = true;
      try {
        const lastKnown = cur.bounds.last;
        const r = await listFrames(apiKey, orgId, camera.id, lastKnown + 1, Date.now() + 60_000);
        const fresh = r.frames.filter((f) => f.ts > lastKnown);
        if (!fresh.length) return;
        const newest = fresh[fresh.length - 1].ts;
        const now = liveState.current;
        setBounds((b) => (b ? { ...b, last: Math.max(b.last, newest) } : b));
        if (now.range && now.frames && now.range[1] >= lastKnown) {
          const merged = [...now.frames, ...fresh.filter((f) => !now.frames!.some((x) => x.id === f.id))];
          const atEnd = now.index >= now.frames.length - 1;
          appendOnly.current = true;
          setFrames(merged);
          setRange([now.range[0], newest]);
          if (atEnd && !now.playing) setIndex(merged.length - 1);
        }
      } catch {
        // Try again next minute.
      } finally {
        busy = false;
      }
    };
    const t = window.setInterval(tick, 60_000);
    const onVis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [apiKey, orgId, camera.id]);

  // 3. Signed URLs for a window around the playhead.
  useEffect(() => {
    if (!frames?.length) return;
    const need = frames
      .slice(Math.max(0, index - 2), Math.min(frames.length, index + PREFETCH))
      .map((f) => f.id)
      .filter((id) => !urls[id] && !requested.current.has(id));
    if (need.length === 0) return;
    need.forEach((id) => requested.current.add(id));
    signFrames(apiKey, orgId, camera.id, need)
      .then((got) => setUrls((prev) => ({ ...prev, ...got })))
      .catch((e) => {
        need.forEach((id) => requested.current.delete(id));
        setError(e.message);
      });
  }, [apiKey, orgId, camera.id, frames, index, urls]);

  // 4. The camera room's sensors, from Growlink: names and metrics for the
  //    configured ones, and the choices offered in settings.
  useEffect(() => {
    let dead = false;
    setRoomSensors(null);
    getSensors(apiKey, camera.roomId)
      .then((list) => !dead && setRoomSensors(list))
      .catch((e) => !dead && setSensorError(e.message));
    return () => { dead = true; };
  }, [apiKey, camera.roomId]);

  // Configured sensors (no guessing), then display rows: with averaging on,
  // same-type sensors become one room-average row.
  const configKey = camera.sensors.join();
  const { meta: configured, missing } = useMemo(
    () => configuredSensors(roomSensors ?? [], camera.sensors),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [roomSensors, configKey]
  );
  const baseRows = useMemo(
    () => displayRows(configured, camera.averageSameType),
    [configured, camera.averageSameType]
  );
  const rows: SensorMeta[] = useMemo(
    () => baseRows.map((r) => ({ ...r, unit: units[r.members[0]] ?? "" })),
    [baseRows, units]
  );

  // Everything configured starts visible; toggles hide rows for this session.
  useEffect(() => {
    setVisible(new Set(baseRows.map((r) => r.id)));
  }, [baseRows]);

  // 5. History for every sensor behind a visible row, in the viewer's units.
  useEffect(() => {
    const ids = Array.from(new Set(baseRows.filter((r) => visible.has(r.id)).flatMap((r) => r.members)));
    const req = configured.filter((s) => ids.includes(s.id));
    if (!range || req.length === 0) return setRaw(null);
    let dead = false;
    getSensorChart(apiKey, orgId, req.map((s) => s.id), range[0], range[1], uom)
      .then((chart) => {
        if (dead) return;
        const got = seriesFromChart(chart, req);
        setRaw(got.series);
        setUnits((prev) => ({ ...prev, ...got.units }));
        setNights(nightsFrom(chart.dayNight, range[0], range[1]));
        setSensorError(null);
      })
      .catch((e) => !dead && setSensorError(e.message));
    return () => { dead = true; };
  }, [apiKey, orgId, range, visible, baseRows, configured, uom]);

  const { series, bands } = useMemo(
    () => (raw ? rowSeries(raw, rows) : { series: null, bands: {} }),
    [raw, rows]
  );

  // Settings apply on Save only. Sensors and averaging go to the server
  // (shared); units stay in this browser, applied after the server save
  // succeeds so a failed save changes nothing.
  const saveSettings = async (
    patch: { sensors?: string[]; averageSameType?: boolean } | null,
    u: Uom | null
  ) => {
    if (patch) onCameraChange(await updateCamera(apiKey, orgId, camera.id, patch));
    if (u) {
      setUom(u);
      saveUom(u);
    }
  };

  useEffect(() => {
    if (!playing || !frames?.length) return;
    timer.current = window.setInterval(() => {
      setIndex((i) => (i + 1 >= frames.length ? 0 : i + 1));
    }, 1000 / fps);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [playing, fps, frames]);

  // Nova insights for this camera.
  const loadInsights = async () => {
    setInsightsLoading(true);
    try {
      setInsights(await listInsights(apiKey, orgId, camera.id));
    } catch {
      setInsights((prev) => prev ?? []);
    } finally {
      setInsightsLoading(false);
    }
  };
  useEffect(() => {
    loadInsights();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, orgId, camera.id]);

  // Yesterday's daily review is made the first time anyone opens the camera
  // after that day ends (the server never holds a Growlink key to run it on
  // a schedule). Shared with the org, so it runs once per camera per day.
  useEffect(() => {
    if (dailyTried.current || !insights || !bounds) return;
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - 1);
    const label = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`;
    if (bounds.first >= end.getTime()) return; // camera started today
    if (insights.some((i) => i.kind === "daily" && i.day === label)) return;
    dailyTried.current = true;
    setDailyBusy(start.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }));
    requestDailyInsight(apiKey, orgId, camera.id, { label, start: start.getTime(), end: end.getTime() }, uom)
      .catch(() => {})
      .finally(() => {
        setDailyBusy(null);
        loadInsights();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insights, bounds]);

  const askNova = async (question: string) => {
    if (!current) return;
    const i = await requestMomentInsight(apiKey, orgId, camera.id, current.ts, question || undefined, uom);
    setInsights((prev) => [i, ...(prev ?? []).filter((x) => x.id !== i.id)]);
  };

  const latestConcern = insights?.find((i) => i.status === "ready")?.concern;

  const current = frames?.[index];
  const currentUrl = current ? urls[current.id] : undefined;
  const tNow = current ? current.ts : null;
  const label = current
    ? new Date(current.ts).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
  const jumpValue = current ? toLocalInput(current.ts) : "";

  const jumpToTs = (ts: number) => {
    setPlaying(false);
    if (!bounds) return;
    if (range && ts >= range[0] && ts <= range[1] && frames) {
      setIndex(nearestIndex(frames, ts));
      return;
    }
    pendingJump.current = ts;
    setRange([Math.max(bounds.first, ts - DAY / 2), Math.min(bounds.last, ts + DAY / 2)]);
  };

  const toggle = (id: string) =>
    setVisible((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });


  const header = (
    <header className="row" style={{ flexWrap: "wrap", alignItems: "flex-end", gap: 16, marginBottom: 20 }}>
      <div style={{ flex: 1, minWidth: 240 }}>
        <div className="row" style={{ gap: 14 }}>
          <button className="btn ghost" onClick={onBack} style={{ paddingLeft: 0, minHeight: 0 }}>← Cameras</button>
          <Brand />
        </div>
        <h1 className="title" style={{ marginTop: 8 }}>{camera.name}</h1>
        <div className="subtitle">
          {roomName}
          {(bounds?.last ?? camera.lastFrameAt) &&
            ` · last frame ${new Date(bounds?.last ?? camera.lastFrameAt!).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`}
        </div>
      </div>
      <button className="btn" onClick={() => setSettingsOpen(true)} aria-haspopup="dialog">Settings</button>
      <button className="btn nova" onClick={() => setNovaOpen(true)} aria-label="Open Nova insights">
        <span aria-hidden>◆</span> Nova
        {(latestConcern === "watch" || latestConcern === "action") && (
          <span className="nova-dot" style={{ background: latestConcern === "action" ? "var(--alarm)" : "var(--warn)" }} aria-label={latestConcern} />
        )}
      </button>
    </header>
  );

  const shell = (body: React.ReactNode) => (
    <div className="page">
      {header}
      {settingsOpen && (
        <DisplaySettings
          cameraName={camera.name}
          roomName={roomName}
          roomSensors={roomSensors}
          selected={camera.sensors}
          averageSameType={camera.averageSameType}
          uom={uom}
          onSave={saveSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      {body}
    </div>
  );

  // Where the tiles go when nothing is configured: ask, don't guess.
  const sensorPrompt =
    camera.sensors.length === 0 ? (
      <div className="callout">
        <span className="callout-label">Sensors</span>
        <span className="callout-text">
          Choose which sensors from <b>{roomName}</b> to show alongside this camera.
        </span>
        <button className="btn accent" onClick={() => setSettingsOpen(true)}>Choose sensors</button>
      </div>
    ) : missing.length > 0 && roomSensors ? (
      <div className="callout warn">
        <span className="callout-label">Sensors</span>
        <span className="callout-text">
          {missing.length === 1 ? "One configured sensor is" : `${missing.length} configured sensors are`} no
          longer in {roomName} in Growlink.
        </span>
        <button className="btn" onClick={() => setSettingsOpen(true)}>Review</button>
      </div>
    ) : null;

  if (error) return shell(<Note><span className="error-text">{error}</span></Note>);
  if (bounds === undefined) return shell(<Note><span className="eyebrow">Loading…</span></Note>);
  if (bounds === null)
    return shell(
      <Note>
        No frames yet. Once the camera is plugged in and online, the first frame arrives within{" "}
        {Math.round(camera.intervalSec / 60)} minutes.
      </Note>
    );

  return shell(
    <div className="stack" style={{ gap: 16 }}>
      <TimeRangeBar
        dataMin={bounds.first}
        dataMax={bounds.last}
        rangeStart={range?.[0] ?? bounds.first}
        rangeEnd={range?.[1] ?? bounds.last}
        onRangeChange={(s, e) => setRange([s, e])}
        jumpValue={jumpValue}
        onJump={(iso) => {
          const ms = new Date(iso).getTime();
          if (Number.isFinite(ms)) jumpToTs(ms);
        }}
        countShown={frames?.length ?? 0}
      />

      {sensorPrompt}
      <div className={`viewer${rows.some((r) => visible.has(r.id)) ? "" : " no-tiles"}`}>
        <div className="stage">
          {frames == null ? (
            <span className="empty">Loading…</span>
          ) : frames.length === 0 ? (
            <span className="empty">No frames in this range</span>
          ) : currentUrl ? (
            <img src={currentUrl} alt={label} />
          ) : (
            <span className="empty">Loading frame…</span>
          )}
          {label && <div className="stamp">{label}</div>}
        </div>
        <SensorReadouts
          sensors={rows}
          series={series}
          bands={bands}
          t={tNow}
          tMin={range?.[0] ?? null}
          tMax={range?.[1] ?? null}
          visible={visible}
        />
      </div>

      <div className="transport">
        <button className="play" onClick={() => setPlaying((p) => !p)} disabled={!frames?.length} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <input
          className="scrub"
          type="range"
          min={0}
          max={Math.max(0, (frames?.length ?? 1) - 1)}
          value={index}
          onChange={(e) => { setPlaying(false); setIndex(Number(e.target.value)); }}
          disabled={!frames?.length}
          aria-label="Timeline"
        />
        <span className="counter">{frames?.length ? `${index + 1} / ${frames.length}` : "0 / 0"}</span>
        <div className="seg" role="group" aria-label="Playback speed">
          {[4, 8, 16, 30].map((f) => (
            <button key={f} aria-pressed={fps === f} onClick={() => setFps(f)} style={{ padding: "8px 12px" }}>
              {f}fps
            </button>
          ))}
        </div>
      </div>

      <SensorToggles sensors={rows} visible={visible} onToggle={toggle} />
      {sensorError && <div className="error-text">Sensor data: {sensorError}</div>}

      <SensorCharts
        sensors={rows}
        series={series}
        bands={bands}
        nights={nights}
        visible={visible}
        tNow={tNow}
        tMin={range?.[0] ?? null}
        tMax={range?.[1] ?? null}
      />

      <NovaPanel
        open={novaOpen}
        onClose={() => setNovaOpen(false)}
        insights={insights}
        loading={insightsLoading}
        dailyBusy={dailyBusy}
        currentTs={tNow}
        onAsk={askNova}
        onJumpTo={(ts) => {
          jumpToTs(ts);
          setNovaOpen(false);
        }}
      />
    </div>
  );
}

function nearestIndex(frames: Frame[], ts: number) {
  if (!frames.length) return 0;
  let lo = 0, hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].ts < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 && Math.abs(frames[lo - 1].ts - ts) < Math.abs(frames[lo].ts - ts) ? lo - 1 : lo;
}

// Growlink day/night markers: y=1 starts a day, y=0 starts a night.
function nightsFrom(markers: { x: string; y: number }[], start: number, end: number): [number, number][] {
  const pts = markers.map((m) => ({ t: new Date(m.x).getTime(), day: m.y === 1 })).sort((a, b) => a.t - b.t);
  const out: [number, number][] = [];
  let nightStart: number | null = pts.length && pts[0].day ? start : null;
  for (const p of pts) {
    if (!p.day && nightStart == null) nightStart = p.t;
    else if (p.day && nightStart != null) {
      out.push([nightStart, p.t]);
      nightStart = null;
    }
  }
  if (nightStart != null) out.push([nightStart, end]);
  return out;
}

function toLocalInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: "56px 24px", textAlign: "center", color: "var(--muted)" }}>
      {children}
    </div>
  );
}
