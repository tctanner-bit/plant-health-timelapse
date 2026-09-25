"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, listFrames, signFrames } from "../lib/api";
import { getSensorChart, getSensors } from "../lib/growlink";
import {
  SensorMeta,
  Series,
  defaultVisible,
  seriesFromChart,
  toSensorMeta,
} from "../lib/sensors";
import SensorReadouts from "./SensorReadouts";
import SensorCharts from "./SensorCharts";
import SensorToggles from "./SensorToggles";
import TimeRangeBar from "./TimeRangeBar";
import NovaDrawer, { ChatTurn, JournalEntry } from "./NovaDrawer";
import { buildPlaceholderJournal, placeholderAsk } from "../lib/nova-placeholder";

type Frame = { id: number; ts: number };

const DAY = 24 * 3600 * 1000;
const PREFETCH = 20;

export default function Player({
  apiKey,
  orgId,
  camera,
  roomName,
  onBack,
}: {
  apiKey: string;
  orgId: string;
  camera: Camera;
  roomName: string;
  onBack: () => void;
}) {
  const [bounds, setBounds] = useState<{ first: number; last: number } | null | undefined>(undefined);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [frames, setFrames] = useState<Frame[] | null>(null);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(8);
  const [error, setError] = useState<string | null>(null);

  const [sensors, setSensors] = useState<SensorMeta[]>([]);
  const [visible, setVisible] = useState<Set<string>>(new Set());
  const [series, setSeries] = useState<Series | null>(null);
  const [nights, setNights] = useState<[number, number][]>([]);
  const [sensorError, setSensorError] = useState<string | null>(null);

  const [novaOpen, setNovaOpen] = useState(false);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [thinking, setThinking] = useState(false);

  const timer = useRef<number | null>(null);
  const pendingJump = useRef<number | null>(null);
  const requested = useRef<Set<number>>(new Set());

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
    let dead = false;
    const h = window.setTimeout(async () => {
      try {
        const r = await listFrames(apiKey, orgId, camera.id, range[0], range[1]);
        if (dead) return;
        setFrames(r.frames);
        if (r.first != null && r.last != null) setBounds({ first: r.first, last: r.last });
        const jump = pendingJump.current;
        pendingJump.current = null;
        setIndex(jump != null ? nearestIndex(r.frames, jump) : 0);
      } catch (e: any) {
        if (!dead) setError(e.message);
      }
    }, 250);
    return () => { dead = true; window.clearTimeout(h); };
  }, [apiKey, orgId, camera.id, range]);

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

  // 4. The room's sensors, from Growlink.
  useEffect(() => {
    let dead = false;
    getSensors(apiKey, camera.roomId)
      .then((list) => {
        if (dead) return;
        const meta = toSensorMeta(list);
        setSensors(meta);
        setVisible(defaultVisible(meta));
      })
      .catch((e) => !dead && setSensorError(e.message));
    return () => { dead = true; };
  }, [apiKey, camera.roomId]);

  // 5. Sensor history for visible sensors over the range.
  useEffect(() => {
    if (!range || visible.size === 0) return setSeries(null);
    const req = sensors.filter((s) => visible.has(s.id));
    if (req.length === 0) return;
    let dead = false;
    getSensorChart(apiKey, orgId, req.map((s) => s.id), range[0], range[1])
      .then((chart) => {
        if (dead) return;
        const { series, units } = seriesFromChart(chart, req);
        setSeries(series);
        setSensors((prev) => prev.map((s) => (units[s.id] !== undefined ? { ...s, unit: units[s.id] } : s)));
        setNights(nightsFrom(chart.dayNight, range[0], range[1]));
        setSensorError(null);
      })
      .catch((e) => !dead && setSensorError(e.message));
    return () => { dead = true; };
    // sensors is intentionally omitted: unit updates above would refetch forever.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, orgId, range, visible, sensors.length]);

  useEffect(() => {
    if (!playing || !frames?.length) return;
    timer.current = window.setInterval(() => {
      setIndex((i) => (i + 1 >= frames.length ? 0 : i + 1));
    }, 1000 / fps);
    return () => { if (timer.current) window.clearInterval(timer.current); };
  }, [playing, fps, frames]);

  const journal: JournalEntry[] = useMemo(
    () => buildPlaceholderJournal(frames ?? [], series, sensors),
    [frames, series, sensors]
  );

  const current = frames?.[index];
  const currentUrl = current ? urls[current.id] : undefined;
  const tNow = current ? current.ts : null;
  const label = current ? new Date(current.ts).toLocaleString() : "";
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

  const askNova = async (text: string) => {
    setChat((c) => [...c, { role: "user", text, ts: Date.now() }]);
    setThinking(true);
    const reply = await placeholderAsk(text);
    setChat((c) => [...c, { role: "nova", text: reply, ts: Date.now() }]);
    setThinking(false);
  };

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
      <button onClick={onBack} style={btn} aria-label="Back to cameras">← Cameras</button>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1 style={{ fontSize: 18, margin: 0, fontWeight: 500 }}>{camera.name}</h1>
        <div style={{ fontSize: 12, color: "#888" }}>
          {roomName}
          {camera.lastFrameAt && ` · last frame ${new Date(camera.lastFrameAt).toLocaleString()}`}
        </div>
      </div>
      <button onClick={() => setNovaOpen(true)} style={novaBtn} aria-label="Open Nova AI">
        <span aria-hidden style={{ marginRight: 8 }}>◆</span>
        Nova AI
      </button>
    </div>
  );

  const shell = (body: React.ReactNode) => (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
      {header}
      {body}
    </div>
  );

  if (error) return shell(<Note>Error: {error}</Note>);
  if (bounds === undefined) return shell(<Note>Loading…</Note>);
  if (bounds === null)
    return shell(
      <Note>
        No frames yet. Once the camera is plugged in and online, the first frame arrives within{" "}
        {Math.round(camera.intervalSec / 60)} minutes.
      </Note>
    );

  return shell(
    <>
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

      <div style={{ marginBottom: 12 }}>
        <SensorReadouts sensors={sensors} series={series} t={tNow} visible={visible} />
      </div>

      <div
        style={{
          position: "relative",
          aspectRatio: "16 / 9",
          background: "#000",
          borderRadius: 8,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {frames == null ? (
          <span style={{ color: "#888" }}>loading…</span>
        ) : frames.length === 0 ? (
          <span style={{ color: "#888" }}>no frames in this range</span>
        ) : currentUrl ? (
          <img src={currentUrl} alt={label} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        ) : (
          <span style={{ color: "#888" }}>loading frame…</span>
        )}
        {label && (
          <div
            style={{
              position: "absolute",
              left: 12,
              bottom: 12,
              padding: "4px 8px",
              background: "rgba(0,0,0,0.55)",
              borderRadius: 4,
              fontVariantNumeric: "tabular-nums",
              fontSize: 13,
            }}
          >
            {label}
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
        <button onClick={() => setPlaying((p) => !p)} disabled={!frames?.length} style={btn}>
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, (frames?.length ?? 1) - 1)}
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
          disabled={!frames?.length}
          style={{ flex: 1, minWidth: 120 }}
        />
        <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 13, color: "#aaa" }}>
          {frames?.length ? `${index + 1} / ${frames.length}` : "0 / 0"}
        </span>
        <label style={{ fontSize: 13, color: "#aaa" }}>
          {fps} fps
          <input
            type="range"
            min={1}
            max={30}
            value={fps}
            onChange={(e) => setFps(Number(e.target.value))}
            style={{ marginLeft: 8, verticalAlign: "middle" }}
          />
        </label>
      </div>

      <SensorToggles sensors={sensors} visible={visible} onToggle={toggle} />
      {sensorError && <p style={{ color: "#e24b4a", fontSize: 12 }}>Sensor data: {sensorError}</p>}

      <SensorCharts
        sensors={sensors}
        series={series}
        nights={nights}
        visible={visible}
        tNow={tNow}
        tMin={range?.[0] ?? null}
        tMax={range?.[1] ?? null}
      />

      <NovaDrawer
        open={novaOpen}
        onClose={() => setNovaOpen(false)}
        entries={journal}
        chat={chat}
        thinking={thinking}
        onAsk={askNova}
        onJumpTo={(ts) => {
          jumpToTs(ts);
          setNovaOpen(false);
        }}
      />
    </>
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

const btn: React.CSSProperties = {
  background: "#1f1f1f",
  color: "#eee",
  border: "1px solid #333",
  borderRadius: 6,
  padding: "6px 14px",
  cursor: "pointer",
};

const novaBtn: React.CSSProperties = {
  background: "linear-gradient(135deg, #7f77dd, #d4537e)",
  color: "#fff",
  border: "none",
  borderRadius: 999,
  padding: "6px 14px 6px 12px",
  fontSize: 13,
  fontWeight: 500,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
};

function Note({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "48px 0", textAlign: "center", color: "#888" }}>{children}</div>;
}
