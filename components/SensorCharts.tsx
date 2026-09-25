"use client";

import { SensorMeta, Series, fmt } from "../lib/sensors";

// Simple SVG line chart per sensor with a shared time axis and a moving
// playhead. Charts share the same x-domain (the selected range), so the
// playhead lines up across rows. Night periods from Growlink are shaded.

const W = 1060;
const H = 70;
const PAD_L = 56;
const PAD_R = 12;
const PAD_T = 6;
const PAD_B = 14;

export default function SensorCharts({
  sensors,
  series,
  nights,
  visible,
  tNow,
  tMin,
  tMax,
}: {
  sensors: SensorMeta[];
  series: Series | null;
  nights: [number, number][];
  visible: Set<string>;
  tNow: number | null;
  tMin: number | null;
  tMax: number | null;
}) {
  if (!series || tMin == null || tMax == null) return null;
  const span = Math.max(1, tMax - tMin);
  const xOf = (t: number) => PAD_L + ((Math.min(tMax, Math.max(tMin, t)) - tMin) / span) * (W - PAD_L - PAD_R);
  const playX = tNow != null ? xOf(tNow) : null;
  const shown = sensors.filter((s) => visible.has(s.id));

  return (
    <div style={{ marginTop: 16 }}>
      {shown.map((s) => {
        const data = (series[s.id] ?? []).filter((p) => p.t >= tMin && p.t <= tMax);
        const ys = data.map((d) => d.v);
        const yMin = ys.length ? Math.min(...ys) : 0;
        const yMax = ys.length ? Math.max(...ys) : 1;
        const yRange = yMax - yMin || 1;
        const yOf = (v: number) => PAD_T + (1 - (v - yMin) / yRange) * (H - PAD_T - PAD_B);

        const d = data
          .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.t).toFixed(1)},${yOf(p.v).toFixed(1)}`)
          .join(" ");
        const lastV = data[data.length - 1]?.v;

        return (
          <div
            key={s.id}
            style={{
              display: "grid",
              gridTemplateColumns: "140px 1fr",
              gap: 12,
              alignItems: "center",
              padding: "6px 0",
              borderTop: "1px solid #1f1f1f",
            }}
          >
            <div>
              <div style={{ fontSize: 12, color: "#aaa" }}>{s.label}</div>
              <div style={{ fontSize: 11, color: "#666" }}>
                {ys.length ? `${fmt(yMin)}–${fmt(yMax)} ${s.unit}` : "no data in range"}
              </div>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H, display: "block" }}>
              {nights.map(([a, b], i) =>
                b < tMin || a > tMax ? null : (
                  <rect key={i} x={xOf(a)} y={PAD_T} width={Math.max(0, xOf(b) - xOf(a))} height={H - PAD_T - PAD_B} fill="#000" fillOpacity={0.35} />
                )
              )}
              <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#222" strokeWidth={0.5} />
              <path d={d} fill="none" stroke={s.color} strokeWidth={1.25} />
              {playX != null && (
                <line x1={playX} y1={PAD_T} x2={playX} y2={H - PAD_B} stroke="#eee" strokeOpacity={0.5} strokeWidth={1} />
              )}
              {lastV != null && (
                <text x={W - PAD_R} y={PAD_T + 10} textAnchor="end" fontSize={10} fill="#666">
                  last {fmt(lastV)} {s.unit}
                </text>
              )}
            </svg>
          </div>
        );
      })}
    </div>
  );
}
