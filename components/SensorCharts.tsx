"use client";

import { useMemo } from "react";
import { SENSORS, SensorKey, Series } from "../lib/sensors";

// Simple SVG line chart per sensor with a shared time axis and a moving
// playhead. Charts share the same x-domain (frame timestamps), so the
// playhead lines up across rows.

const W = 1060;
const H = 70;
const PAD_L = 56;
const PAD_R = 12;
const PAD_T = 6;
const PAD_B = 14;

export default function SensorCharts({
  series,
  visible,
  tNow,
  tMin,
  tMax,
}: {
  series: Series | null;
  visible: Set<SensorKey>;
  tNow: number | null;
  tMin: number | null;
  tMax: number | null;
}) {
  if (!series || tMin == null || tMax == null) return null;
  const span = Math.max(1, tMax - tMin);
  const xOf = (t: number) => PAD_L + ((t - tMin) / span) * (W - PAD_L - PAD_R);
  const playX = tNow != null ? xOf(tNow) : null;
  const shown = SENSORS.filter((s) => visible.has(s.key));

  return (
    <div style={{ marginTop: 16 }}>
      {shown.map((s) => {
        const data = series[s.key];
        const ys = data.map((d) => d.v);
        const yMin = Math.min(...ys);
        const yMax = Math.max(...ys);
        const yRange = yMax - yMin || 1;
        const yOf = (v: number) =>
          PAD_T + (1 - (v - yMin) / yRange) * (H - PAD_T - PAD_B);

        const d = data
          .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.t).toFixed(1)},${yOf(p.v).toFixed(1)}`)
          .join(" ");

        const lastV = data[data.length - 1]?.v;

        return (
          <div
            key={s.key}
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr",
              gap: 12,
              alignItems: "center",
              padding: "6px 0",
              borderTop: "1px solid #1f1f1f",
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: "#aaa" }}>{s.label}</div>
              <div style={{ fontSize: 11, color: "#666" }}>
                {yMin.toFixed(s.decimals)}–{yMax.toFixed(s.decimals)} {s.unit}
              </div>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }}>
              <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#222" strokeWidth={0.5} />
              <path d={d} fill="none" stroke={s.color} strokeWidth={1.25} />
              {playX != null && (
                <line x1={playX} y1={PAD_T} x2={playX} y2={H - PAD_B} stroke="#eee" strokeOpacity={0.5} strokeWidth={1} />
              )}
              {lastV != null && (
                <text x={W - PAD_R} y={PAD_T + 10} textAnchor="end" fontSize={10} fill="#666">
                  last {lastV.toFixed(s.decimals)} {s.unit}
                </text>
              )}
            </svg>
          </div>
        );
      })}
    </div>
  );
}
