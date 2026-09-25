"use client";

import { useMemo } from "react";

type Preset = "1h" | "24h" | "7d" | "all";

const DUR: Record<Exclude<Preset, "all">, number> = { "1h": 3_600_000, "24h": 86_400_000, "7d": 604_800_000 };

export default function TimeRangeBar({
  dataMin,
  dataMax,
  rangeStart,
  rangeEnd,
  onRangeChange,
  jumpValue,
  onJump,
  countShown,
  countTotal,
}: {
  dataMin: number;
  dataMax: number;
  rangeStart: number;
  rangeEnd: number;
  onRangeChange: (start: number, end: number) => void;
  jumpValue: string;          // "yyyy-MM-ddTHH:mm" of current frame, for the Jump input
  onJump: (iso: string) => void;
  countShown: number;
  countTotal?: number;
}) {
  // datetime-local uses LOCAL time, no timezone suffix.
  const toLocalInput = (ms: number) => {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const startVal = useMemo(() => toLocalInput(rangeStart), [rangeStart]);
  const endVal = useMemo(() => toLocalInput(rangeEnd), [rangeEnd]);
  const minVal = useMemo(() => toLocalInput(dataMin), [dataMin]);
  const maxVal = useMemo(() => toLocalInput(dataMax), [dataMax]);

  const presetRange = (p: Preset): [number, number] =>
    p === "all" ? [dataMin, dataMax] : [Math.max(dataMin, dataMax - DUR[p]), dataMax];
  // Several presets can cover the same span (a day of data is also "7d" and
  // "All"); light up only the shortest one that matches.
  const PRESETS: Preset[] = ["1h", "24h", "7d", "all"];
  const activePreset = PRESETS.find((p) => {
    const [s, e] = presetRange(p);
    return s === rangeStart && e === rangeEnd;
  });
  const active = (p: Preset) => p === activePreset;

  const onStart = (s: string) => {
    const ms = new Date(s).getTime();
    if (Number.isFinite(ms)) onRangeChange(Math.max(dataMin, ms), Math.max(ms + 60_000, rangeEnd));
  };
  const onEnd = (s: string) => {
    const ms = new Date(s).getTime();
    if (Number.isFinite(ms)) onRangeChange(Math.min(rangeStart, ms - 60_000), Math.min(dataMax, ms));
  };

  return (
    <div className="toolbar">
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {(["1h", "24h", "7d", "all"] as Preset[]).map((p) => (
          <button
            key={p}
            className={`chip${active(p) ? " on" : ""}`}
            onClick={() => onRangeChange(...presetRange(p))}
            aria-pressed={active(p)}
          >
            {p === "all" ? "All" : p}
          </button>
        ))}
      </div>
      <label className="label">
        <span>From</span>
        <input className="field" type="datetime-local" value={startVal} min={minVal} max={maxVal} onChange={(e) => onStart(e.target.value)} />
      </label>
      <label className="label">
        <span>To</span>
        <input className="field" type="datetime-local" value={endVal} min={minVal} max={maxVal} onChange={(e) => onEnd(e.target.value)} />
      </label>
      <div className="spacer" />
      <label className="label">
        <span>Jump to</span>
        <input className="field" type="datetime-local" value={jumpValue} min={startVal} max={endVal} onChange={(e) => onJump(e.target.value)} />
      </label>
      <span className="eyebrow" style={{ alignSelf: "center", whiteSpace: "nowrap" }}>
        {countTotal == null ? `${countShown} frames` : `${countShown} of ${countTotal} frames`}
      </span>
    </div>
  );
}
