"use client";

import { Band, SensorMeta, Series, fmt } from "../lib/sensors";

// One chart row per visible sensor (or room average), on a shared time axis
// so the playhead lines up across rows. Nights are shaded; averaged rows show
// the min–max spread across their sensors as a faint band.

const W = 1060;
const H = 76;
const PAD_T = 8;
const PAD_B = 8;

export default function SensorCharts({
  sensors,
  series,
  bands,
  nights,
  visible,
  tNow,
  tMin,
  tMax,
}: {
  sensors: SensorMeta[];
  series: Series | null;
  bands: Record<string, Band[]>;
  nights: [number, number][];
  visible: Set<string>;
  tNow: number | null;
  tMin: number | null;
  tMax: number | null;
}) {
  if (!series || tMin == null || tMax == null) return null;
  const shown = sensors.filter((s) => visible.has(s.id));
  if (shown.length === 0) return null;
  const span = Math.max(1, tMax - tMin);
  const xOf = (t: number) => ((Math.min(tMax, Math.max(tMin, t)) - tMin) / span) * W;
  const playX = tNow != null ? xOf(tNow) : null;

  return (
    <div className="card chart-rows">
      {shown.map((s) => {
        const data = (series[s.id] ?? []).filter((p) => p.t >= tMin && p.t <= tMax);
        const band = (bands[s.id] ?? []).filter((b) => b.t >= tMin && b.t <= tMax);
        const ys = [...data.map((d) => d.v), ...band.flatMap((b) => [b.lo, b.hi])];
        const yMin = ys.length ? Math.min(...ys) : 0;
        const yMax = ys.length ? Math.max(...ys) : 1;
        const yRange = yMax - yMin || 1;
        const yOf = (v: number) => PAD_T + (1 - (v - yMin) / yRange) * (H - PAD_T - PAD_B);

        const d = data.map((p, i) => `${i ? "L" : "M"}${xOf(p.t).toFixed(1)},${yOf(p.v).toFixed(1)}`).join("");
        const area = band.length
          ? band.map((b, i) => `${i ? "L" : "M"}${xOf(b.t).toFixed(1)},${yOf(b.hi).toFixed(1)}`).join("") +
            band.slice().reverse().map((b) => `L${xOf(b.t).toFixed(1)},${yOf(b.lo).toFixed(1)}`).join("") + "Z"
          : "";

        return (
          <div key={s.id} className="chart-row">
            <div style={{ minWidth: 0 }}>
              <div className="metric-label" style={{ color: "var(--text)" }}>
                <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 99, background: s.color, marginRight: 8, verticalAlign: 1 }} />
                {s.label}
              </div>
              <div className="small muted" style={{ marginTop: 4 }}>
                {ys.length ? `${fmt(yMin)}–${fmt(yMax)} ${s.unit}` : "No data in range"}
              </div>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height: H, display: "block" }}>
              {nights.map(([a, b], i) =>
                b < tMin || a > tMax ? null : (
                  <rect key={i} x={xOf(a)} y={0} width={Math.max(0, xOf(b) - xOf(a))} height={H} fill="var(--night)" />
                )
              )}
              <line x1={0} y1={H - 0.5} x2={W} y2={H - 0.5} stroke="var(--line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
              {area && <path d={area} fill={s.color} fillOpacity={0.12} />}
              <path d={d} fill="none" stroke={s.color} strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              {playX != null && (
                <line x1={playX} y1={0} x2={playX} y2={H} stroke="var(--ok)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
              )}
            </svg>
          </div>
        );
      })}
    </div>
  );
}
