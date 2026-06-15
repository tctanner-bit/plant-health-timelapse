"use client";

import { useMemo } from "react";

type Preset = "1h" | "24h" | "7d" | "all";

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
  countTotal: number;
}) {
  // Convert a ms timestamp to the value an <input type="datetime-local"> wants.
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

  const applyPreset = (p: Preset) => {
    if (p === "all") return onRangeChange(dataMin, dataMax);
    const map: Record<Exclude<Preset, "all">, number> = {
      "1h": 60 * 60 * 1000,
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
    };
    const end = dataMax;
    const start = Math.max(dataMin, end - map[p]);
    onRangeChange(start, end);
  };

  const onStart = (s: string) => {
    const ms = new Date(s).getTime();
    if (Number.isFinite(ms)) onRangeChange(Math.max(dataMin, ms), Math.max(ms + 60_000, rangeEnd));
  };
  const onEnd = (s: string) => {
    const ms = new Date(s).getTime();
    if (Number.isFinite(ms)) onRangeChange(Math.min(rangeStart, ms - 60_000), Math.min(dataMax, ms));
  };

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        background: "#161616",
        border: "1px solid #242424",
        borderRadius: 8,
        marginBottom: 12,
      }}
    >
      <Field label="From">
        <input
          type="datetime-local"
          value={startVal}
          min={minVal}
          max={maxVal}
          onChange={(e) => onStart(e.target.value)}
          style={input}
        />
      </Field>
      <Field label="To">
        <input
          type="datetime-local"
          value={endVal}
          min={minVal}
          max={maxVal}
          onChange={(e) => onEnd(e.target.value)}
          style={input}
        />
      </Field>

      <div style={{ display: "flex", gap: 4 }}>
        {(["1h", "24h", "7d", "all"] as Preset[]).map((p) => (
          <button key={p} onClick={() => applyPreset(p)} style={chip}>
            {p === "all" ? "All" : `Last ${p}`}
          </button>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      <Field label="Jump to">
        <input
          type="datetime-local"
          value={jumpValue}
          min={startVal}
          max={endVal}
          onChange={(e) => onJump(e.target.value)}
          style={input}
        />
      </Field>

      <span style={{ fontSize: 12, color: "#888", fontVariantNumeric: "tabular-nums" }}>
        {countShown} of {countTotal} frames
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 10, color: "#888", letterSpacing: 0.3, textTransform: "uppercase" }}>
        {label}
      </span>
      {children}
    </label>
  );
}

const input: React.CSSProperties = {
  background: "#1f1f1f",
  color: "#eee",
  border: "1px solid #333",
  borderRadius: 4,
  padding: "4px 6px",
  fontSize: 13,
  colorScheme: "dark",
};

const chip: React.CSSProperties = {
  background: "#1f1f1f",
  color: "#aaa",
  border: "1px solid #333",
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 12,
  cursor: "pointer",
};
