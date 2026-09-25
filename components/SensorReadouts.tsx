"use client";

import { Band, SensorMeta, Series, fmt, readingAt } from "../lib/sensors";

// Metric tiles, styled after the display app: label, big value at the
// playhead, and a sparkline of the selected range with the playhead marked.
export default function SensorReadouts({
  sensors,
  series,
  bands,
  t,
  tMin,
  tMax,
  visible,
}: {
  sensors: SensorMeta[];
  series: Series | null;
  bands: Record<string, Band[]>;
  t: number | null;
  tMin: number | null;
  tMax: number | null;
  visible: Set<string>;
}) {
  const shown = sensors.filter((s) => visible.has(s.id));
  if (shown.length === 0) return null;
  return (
    <div className="metrics">
      {shown.map((s) => {
        const data = series?.[s.id] ?? [];
        const v = t != null ? readingAt(data, t) : null;
        const band = bands[s.id];
        const spread = band && t != null ? bandAt(band, t) : null;
        return (
          <div key={s.id} className="metric" style={{ ["--swatch" as any]: s.color }}>
            <div className="metric-label" title={s.label}>{s.label}</div>
            <div className="metric-value">
              {v == null ? "—" : fmt(v)}
              <small>{s.unit}</small>
            </div>
            <div className="metric-detail" title={spread ? `${s.detail}, spread ${fmt(spread.lo)}–${fmt(spread.hi)} ${s.unit}` : s.detail}>
              {spread
                ? `${s.members.length} sensors · ${fmt(spread.lo)}–${fmt(spread.hi)}`
                : s.detail ?? s.short}
            </div>
            <Spark data={data} color={s.color} t={t} tMin={tMin} tMax={tMax} />
          </div>
        );
      })}
    </div>
  );
}

function bandAt(band: Band[], t: number) {
  let best: Band | null = null;
  for (const b of band) {
    if (b.t > t) break;
    best = b;
  }
  return best;
}

function Spark({
  data,
  color,
  t,
  tMin,
  tMax,
}: {
  data: { t: number; v: number }[];
  color: string;
  t: number | null;
  tMin: number | null;
  tMax: number | null;
}) {
  const W = 200;
  const H = 26;
  if (tMin == null || tMax == null) return <svg className="spark" />;
  const pts = data.filter((p) => p.t >= tMin && p.t <= tMax);
  if (pts.length < 2) return <svg className="spark" />;
  const vs = pts.map((p) => p.v);
  const lo = Math.min(...vs);
  const hi = Math.max(...vs);
  const span = Math.max(1, tMax - tMin);
  const x = (tt: number) => ((tt - tMin) / span) * W;
  const y = (v: number) => H - 2 - ((v - lo) / (hi - lo || 1)) * (H - 4);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join("");
  const cur = t != null ? readingAt(pts, t) : null;
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" opacity={0.9} />
      {t != null && cur != null && (
        <line x1={x(t)} x2={x(t)} y1={0} y2={H} stroke="var(--text)" strokeOpacity={0.35} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}
