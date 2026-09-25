"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, LatestFrame, latestFrames } from "../lib/api";
import { LiveReading, Room, Sensor, getLiveSensors, getSensors } from "../lib/growlink";
import { SensorMeta, configuredSensors, displayRows, fmt } from "../lib/sensors";
import { loadUom } from "../lib/prefs";
import { ago, cameraStatus } from "../lib/status";

// Facility view: every camera's latest snapshot with its room's live sensor
// readings underneath, for the whole facility at a glance.
//
// Built for 12–40 rooms: one request for every camera's latest frame, one
// batched Growlink call for every live reading, and polling that pauses
// while the tab is hidden. Snapshot URLs are only replaced when a camera has
// a new frame, so unchanged images aren't downloaded again.

const LIVE_MS = 30_000;
const FRAMES_MS = 60_000;
const STALE_MS = 15 * 60_000;
const MAX_READINGS = 6;

// Compact labels for the small reading tiles (full names stay in the tooltip).
const SHORT: Record<number, string> = {
  0: "Temp", 1: "RH", 2: "pH", 3: "CO₂", 4: "TDS", 6: "Light", 8: "VPD",
  9: "WC", 10: "EC", 13: "DO", 20: "PAR", 22: "DLI",
};
const shortUnit = (u: string) => (u.includes("mol/m²/s") ? "µmol" : u);

type Sort = "room" | "attention";

export default function FacilityView({
  apiKey,
  orgId,
  rooms,
  cameras,
  onOpen,
  onRefreshCameras,
  onAddCamera,
}: {
  apiKey: string;
  orgId: string;
  rooms: Room[];
  cameras: Camera[];
  onOpen: (cameraId: string) => void;
  onRefreshCameras: () => Promise<void>;
  onAddCamera: () => void;
}) {
  const [latest, setLatest] = useState<Record<string, LatestFrame>>({});
  const [roomSensors, setRoomSensors] = useState<Record<string, Sensor[]>>({});
  const [live, setLive] = useState<Record<string, LiveReading>>({});
  const [liveError, setLiveError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("room");
  const [, setTick] = useState(0); // re-render so "x min ago" stays true
  const uom = useMemo(() => loadUom(), []);

  const active = cameras.filter((c) => !c.revoked);
  const roomName = useCallback(
    (id: string) => rooms.find((r) => r.id.toLowerCase() === id)?.name ?? "Unknown room",
    [rooms]
  );

  // Sensor names/metrics for rooms whose cameras have sensors configured.
  // Loaded once per room, a few at a time.
  const neededRooms = useMemo(
    () => Array.from(new Set(active.filter((c) => c.sensors.length).map((c) => c.roomId))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active.map((c) => c.roomId + c.sensors.length).join()]
  );
  useEffect(() => {
    let dead = false;
    const todo = neededRooms.filter((r) => !roomSensors[r]);
    (async () => {
      for (let i = 0; i < todo.length; i += 6) {
        const batch = todo.slice(i, i + 6);
        const got = await Promise.all(batch.map((r) => getSensors(apiKey, r).then((s) => [r, s] as const).catch(() => null)));
        if (dead) return;
        setRoomSensors((prev) => {
          const next = { ...prev };
          for (const g of got) if (g) next[g[0]] = g[1];
          return next;
        });
      }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, neededRooms.join()]);

  // Latest frames (and camera status) every minute. The parent's refresh
  // callback is read through a ref so a new function identity never restarts
  // the polling loop.
  const refreshRef = useRef(onRefreshCameras);
  refreshRef.current = onRefreshCameras;
  const pollFrames = useCallback(async () => {
    try {
      const got = await latestFrames(apiKey, orgId);
      setLatest((prev) => {
        const next: Record<string, LatestFrame> = {};
        for (const [id, f] of Object.entries(got)) next[id] = prev[id]?.id === f.id ? prev[id] : f;
        return next;
      });
    } catch {}
    refreshRef.current();
  }, [apiKey, orgId]);

  // Live readings for every configured sensor in the facility, every 30s.
  const sensorIds = useMemo(
    () => Array.from(new Set(active.flatMap((c) => c.sensors.map((s) => s.toLowerCase())))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active.map((c) => c.sensors.join()).join("|")]
  );
  const pollLive = useCallback(async () => {
    if (sensorIds.length === 0) return;
    try {
      const readings = await getLiveSensors(apiKey, orgId, sensorIds, uom);
      const map: Record<string, LiveReading> = {};
      for (const r of readings) map[r.sensorId.toLowerCase()] = r;
      setLive(map);
      setLiveError(null);
      setUpdatedAt(Date.now());
    } catch (e: any) {
      setLiveError(e.message); // keep showing the last good readings
    }
  }, [apiKey, orgId, sensorIds, uom]);

  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    pollFrames();
    pollLive();
    const f = window.setInterval(() => visible() && pollFrames(), FRAMES_MS);
    const l = window.setInterval(() => visible() && pollLive(), LIVE_MS);
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    const onVis = () => { if (visible()) { pollFrames(); pollLive(); } };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(f);
      window.clearInterval(l);
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [pollFrames, pollLive]);

  // Summary + filtering + sorting.
  const statuses = new Map(cameras.map((c) => [c.id, cameraStatus(c)]));
  const counts = { ok: 0, alarm: 0, warn: 0 };
  for (const c of active) {
    const t = statuses.get(c.id)!.tone;
    if (t === "ok" || t === "alarm" || t === "warn") counts[t]++;
  }
  const q = query.trim().toLowerCase();
  const shown = active
    .filter((c) => !q || roomName(c.roomId).toLowerCase().includes(q) || c.name.toLowerCase().includes(q))
    .sort((a, b) =>
      sort === "attention"
        ? statuses.get(a.id)!.rank - statuses.get(b.id)!.rank || roomName(a.roomId).localeCompare(roomName(b.roomId))
        : roomName(a.roomId).localeCompare(roomName(b.roomId)) || a.name.localeCompare(b.name)
    );
  const camsPerRoom = new Map<string, number>();
  for (const c of active) camsPerRoom.set(c.roomId, (camsPerRoom.get(c.roomId) ?? 0) + 1);

  if (active.length === 0) {
    return (
      <div className="card" style={{ textAlign: "center", padding: "56px 24px" }}>
        <div className="eyebrow">No cameras yet</div>
        <p className="muted" style={{ maxWidth: 440, margin: "12px auto 20px", lineHeight: 1.5 }}>
          Add a camera to a room and its latest snapshot and sensor readings will appear here.
        </p>
        <button className="btn accent" onClick={onAddCamera}>+ Add camera</button>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
        <div className="row" style={{ gap: 18, flexWrap: "wrap", flex: 1, minWidth: 260 }}>
          <span className="eyebrow" style={{ color: "var(--text)" }}>
            {active.length} camera{active.length === 1 ? "" : "s"}
          </span>
          {counts.ok > 0 && <span className="status ok">{counts.ok} capturing</span>}
          {counts.alarm > 0 && <span className="status alarm">{counts.alarm} offline</span>}
          {counts.warn > 0 && <span className="status warn">{counts.warn} waiting</span>}
          <span className="small" style={{ color: liveError ? "var(--warn)" : "var(--dim)" }}>
            {liveError
              ? `Live readings paused: ${liveError}`
              : updatedAt
              ? `Readings updated ${ago(updatedAt)}`
              : sensorIds.length
              ? "Loading readings…"
              : ""}
          </span>
        </div>
        {active.length > 6 && (
          <input
            className="field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search rooms"
            aria-label="Search rooms"
            style={{ width: 220 }}
          />
        )}
        <div className="seg" role="group" aria-label="Sort">
          <button aria-pressed={sort === "room"} onClick={() => setSort("room")}>A–Z</button>
          <button aria-pressed={sort === "attention"} onClick={() => setSort("attention")}>Needs attention</button>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="muted" style={{ padding: 32, textAlign: "center" }}>No rooms match “{query}”.</div>
      ) : (
        <div className="facility">
          {shown.map((c) => (
            <RoomTile
              key={c.id}
              camera={c}
              room={roomName(c.roomId)}
              showCameraName={(camsPerRoom.get(c.roomId) ?? 0) > 1}
              frame={latest[c.id]}
              sensors={roomSensors[c.roomId]}
              live={live}
              onOpen={() => onOpen(c.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RoomTile({
  camera: c,
  room,
  showCameraName,
  frame,
  sensors,
  live,
  onOpen,
}: {
  camera: Camera;
  room: string;
  showCameraName: boolean;
  frame?: LatestFrame;
  sensors?: Sensor[];
  live: Record<string, LiveReading>;
  onOpen: () => void;
}) {
  const st = cameraStatus(c);
  const rows: SensorMeta[] = useMemo(
    () => (sensors ? displayRows(configuredSensors(sensors, c.sensors).meta, c.averageSameType) : []),
    [sensors, c.sensors, c.averageSameType]
  );
  const frameAge = frame ? Date.now() - frame.ts : null;

  return (
    <article className="room-tile">
      <button className="room-shot" onClick={onOpen} aria-label={`Open ${room} timelapse`}>
        {frame ? <img src={frame.url} alt={`${room}, ${new Date(frame.ts).toLocaleTimeString()}`} loading="lazy" /> : <span>No snapshot yet</span>}
        <span className={`status ${st.tone} room-status`}>{st.label}</span>
        {frame && (
          <span className="room-stamp" style={{ color: frameAge! > 3 * c.intervalSec * 1000 ? "var(--warn)" : undefined }}>
            {frameAge! < 12 * 3600_000
              ? new Date(frame.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
              : ago(frame.ts)}
          </span>
        )}
      </button>

      <div className="room-body">
        <button className="room-title" onClick={onOpen}>
          <span>{room}</span>
          {showCameraName && <span className="muted" style={{ fontWeight: 500, fontSize: 13 }}>{c.name}</span>}
        </button>

        {c.sensors.length === 0 ? (
          <button className="room-empty" onClick={onOpen}>No sensors chosen · open to choose</button>
        ) : !sensors ? (
          <div className="room-empty">Loading sensors…</div>
        ) : (
          <div className="readings">
            {rows.slice(0, MAX_READINGS).map((r) => {
              // Short metric label unless another tile here would share it.
              const short = SHORT[r.metric];
              const unique = short && rows.filter((x) => x.metric === r.metric).length === 1;
              return <Reading key={r.id} row={r} label={unique ? short : r.label} live={live} />;
            })}
            {rows.length > MAX_READINGS && (
              <button className="reading more" onClick={onOpen}>+{rows.length - MAX_READINGS} more</button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

// One reading tile. An averaged row averages its members' live values.
function Reading({ row, label, live }: { row: SensorMeta; label: string; live: Record<string, LiveReading> }) {
  const got = row.members.map((m) => live[m]).filter((r): r is LiveReading => !!r && r.value != null);
  const now = Date.now();
  const fresh = got.filter((r) => now - new Date(r.timestamp).getTime() <= STALE_MS);
  const use = fresh.length ? fresh : got;
  const value = use.length ? use.reduce((a, r) => a + r.value, 0) / use.length : null;
  const unit = shortUnit(use[0]?.suffix ?? "");
  const stale = use.length > 0 && fresh.length === 0;
  const title = [
    row.label,
    row.members.length > 1 ? `average of ${use.length} of ${row.members.length} sensors` : null,
    stale ? `last reading ${ago(use[0].timestamp)}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="reading" style={{ ["--swatch" as any]: row.color, opacity: stale ? 0.55 : 1 }} title={title}>
      <div className="reading-label">{label}</div>
      <div className="reading-value">
        {value == null ? "—" : fmt(value)}
        <small>{unit}</small>
      </div>
      {row.members.length > 1 && <div className="reading-sub">avg of {row.members.length}</div>}
    </div>
  );
}
