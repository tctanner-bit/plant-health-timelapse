"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { SensorKey, Series, generateFakeSeries } from "../lib/sensors";
import SensorReadouts from "./SensorReadouts";
import SensorCharts from "./SensorCharts";
import SensorToggles from "./SensorToggles";
import TimeRangeBar from "./TimeRangeBar";
import NovaDrawer, { ChatTurn, JournalEntry } from "./NovaDrawer";
import { buildPlaceholderJournal, placeholderAsk } from "../lib/nova-placeholder";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type Frame = { id: number; captured_at: string; storage_path: string; ts: number };

const BUCKET = "frames";
const SIGNED_URL_TTL_SEC = 60 * 60;

export default function Player() {
  const [allFrames, setAllFrames] = useState<Frame[] | null>(null);
  const [urls, setUrls] = useState<Record<number, string>>({});
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(8);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState<Set<SensorKey>>(
    new Set<SensorKey>(["air_temp", "humidity", "vpd", "par", "sub_moisture"])
  );
  const [rangeStart, setRangeStart] = useState<number | null>(null);
  const [rangeEnd, setRangeEnd] = useState<number | null>(null);

  const [novaOpen, setNovaOpen] = useState(false);
  const [chat, setChat] = useState<ChatTurn[]>([]);
  const [thinking, setThinking] = useState(false);

  const timer = useRef<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("frames")
        .select("id, captured_at, storage_path")
        .order("captured_at", { ascending: true })
        .limit(5000);
      if (error) setError(error.message);
      else {
        const withTs: Frame[] = (data ?? []).map((f) => ({
          ...f,
          ts: new Date(f.captured_at).getTime(),
        }));
        setAllFrames(withTs);
        if (withTs.length > 0) {
          setRangeStart(withTs[0].ts);
          setRangeEnd(withTs[withTs.length - 1].ts);
        }
      }
    })();
  }, []);

  const frames = useMemo(() => {
    if (!allFrames || rangeStart == null || rangeEnd == null) return [];
    return allFrames.filter((f) => f.ts >= rangeStart && f.ts <= rangeEnd);
  }, [allFrames, rangeStart, rangeEnd]);

  useEffect(() => {
    if (index >= frames.length) setIndex(Math.max(0, frames.length - 1));
  }, [frames.length, index]);

  useEffect(() => {
    if (frames.length === 0) return;
    const w = 20;
    const start = Math.max(0, index - 2);
    const end = Math.min(frames.length, index + w);
    const need = frames.slice(start, end).filter((f) => !urls[f.id]);
    if (need.length === 0) return;
    (async () => {
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(need.map((f) => f.storage_path), SIGNED_URL_TTL_SEC);
      if (error) {
        setError(error.message);
        return;
      }
      setUrls((prev) => {
        const next = { ...prev };
        data?.forEach((row, i) => {
          if (row.signedUrl) next[need[i].id] = row.signedUrl;
        });
        return next;
      });
    })();
  }, [frames, index, urls]);

  useEffect(() => {
    if (!playing || frames.length === 0) return;
    timer.current = window.setInterval(() => {
      setIndex((i) => (i + 1 >= frames.length ? 0 : i + 1));
    }, 1000 / fps);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [playing, fps, frames.length]);

  const frameTs = useMemo(() => frames.map((f) => f.ts), [frames]);
  const series: Series | null = useMemo(
    () => (frameTs.length ? generateFakeSeries(frameTs) : null),
    [frameTs]
  );

  const allFrameTs = useMemo(() => allFrames?.map((f) => f.ts) ?? [], [allFrames]);
  const allSeries: Series | null = useMemo(
    () => (allFrameTs.length ? generateFakeSeries(allFrameTs) : null),
    [allFrameTs]
  );
  const journal: JournalEntry[] = useMemo(
    () => (allFrames ? buildPlaceholderJournal(allFrames, allSeries) : []),
    [allFrames, allSeries]
  );

  const current = frames[index];
  const currentUrl = current ? urls[current.id] : undefined;
  const tNow = current ? current.ts : null;
  const label = useMemo(
    () => (current ? new Date(current.captured_at).toLocaleString() : ""),
    [current]
  );

  const jumpValue = useMemo(() => {
    if (!current) return "";
    const d = new Date(current.ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, [current]);

  const jumpToTs = (ts: number) => {
    if (!allFrames || allFrames.length === 0) return;
    if (rangeStart == null || rangeEnd == null || ts < rangeStart || ts > rangeEnd) {
      setRangeStart(allFrames[0].ts);
      setRangeEnd(allFrames[allFrames.length - 1].ts);
    }
    let lo = 0, hi = allFrames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (allFrames[mid].ts < ts) lo = mid + 1;
      else hi = mid;
    }
    const cand = [allFrames[Math.max(0, lo - 1)], allFrames[lo]];
    const bestGlobal = Math.abs(cand[0].ts - ts) < Math.abs(cand[1].ts - ts) ? lo - 1 : lo;
    const target = allFrames[Math.max(0, bestGlobal)];
    const idxInVisible = frames.findIndex((f) => f.id === target.id);
    setIndex(idxInVisible >= 0 ? idxInVisible : 0);
    setPlaying(false);
  };

  const handleJump = (iso: string) => {
    const ms = new Date(iso).getTime();
    if (Number.isFinite(ms)) jumpToTs(ms);
  };

  const toggle = (k: SensorKey) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };

  const askNova = async (text: string) => {
    const userTurn: ChatTurn = { role: "user", text, ts: Date.now() };
    setChat((c) => [...c, userTurn]);
    setThinking(true);
    const reply = await placeholderAsk(text);
    setChat((c) => [...c, { role: "nova", text: reply, ts: Date.now() }]);
    setThinking(false);
  };

  if (error) return <Centered>error: {error}</Centered>;
  if (!allFrames) return <Centered>loading…</Centered>;
  if (allFrames.length === 0)
    return <Centered>no frames yet — let the capture script run for a bit</Centered>;

  const dataMin = allFrames[0].ts;
  const dataMax = allFrames[allFrames.length - 1].ts;

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <h1 style={{ fontSize: 18, margin: 0, fontWeight: 500, flex: 1 }}>
          Plant Health Timelapse
        </h1>
        <button onClick={() => setNovaOpen(true)} style={novaBtn} aria-label="Open Nova AI">
          <span aria-hidden style={{ marginRight: 8 }}>◆</span>
          Nova AI
        </button>
      </div>

      <TimeRangeBar
        dataMin={dataMin}
        dataMax={dataMax}
        rangeStart={rangeStart ?? dataMin}
        rangeEnd={rangeEnd ?? dataMax}
        onRangeChange={(s, e) => {
          setRangeStart(s);
          setRangeEnd(e);
        }}
        jumpValue={jumpValue}
        onJump={handleJump}
        countShown={frames.length}
        countTotal={allFrames.length}
      />

      {/* Readouts above the video, full width, wrapping as needed */}
      <div style={{ marginBottom: 12 }}>
        <SensorReadouts series={series} t={tNow} visible={visible} />
      </div>

      {/* Full-width video */}
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
        {frames.length === 0 ? (
          <span style={{ color: "#888" }}>no frames in this range</span>
        ) : currentUrl ? (
          <img
            src={currentUrl}
            alt={label}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
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

      {/* Transport */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
        <button
          onClick={() => setPlaying((p) => !p)}
          disabled={frames.length === 0}
          style={btn}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, frames.length - 1)}
          value={index}
          onChange={(e) => setIndex(Number(e.target.value))}
          disabled={frames.length === 0}
          style={{ flex: 1 }}
        />
        <span style={{ fontVariantNumeric: "tabular-nums", fontSize: 13, color: "#aaa" }}>
          {frames.length === 0 ? "0 / 0" : `${index + 1} / ${frames.length}`}
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

      <SensorToggles visible={visible} onToggle={toggle} />

      <SensorCharts
        series={series}
        visible={visible}
        tNow={tNow}
        tMin={frameTs[0] ?? null}
        tMax={frameTs[frameTs.length - 1] ?? null}
      />

      <p style={{ color: "#555", fontSize: 11, marginTop: 24 }}>
        Sensor data and Nova entries shown are placeholder. The Growlink and Claude integrations
        will replace them without changing this view.
      </p>

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
    </div>
  );
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

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: "100vh", display: "grid", placeItems: "center", color: "#888" }}>
      {children}
    </div>
  );
}
