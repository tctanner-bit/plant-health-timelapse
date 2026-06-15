"use client";

import { SENSORS, SensorKey, Series, readingAt } from "../lib/sensors";

export default function SensorReadouts({
  series,
  t,
  visible,
}: {
  series: Series | null;
  t: number | null;
  visible: Set<SensorKey>;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
      }}
    >
      {SENSORS.filter((s) => visible.has(s.key)).map((s) => {
        const v = series && t != null ? readingAt(series[s.key], t) : null;
        const text = v == null ? "—" : v.toFixed(s.decimals);
        return (
          <div
            key={s.key}
            style={{
              flex: "1 1 140px",
              minWidth: 140,
              background: "#1a1a1a",
              border: "1px solid #2a2a2a",
              borderRadius: 8,
              padding: "10px 12px",
              borderLeft: `3px solid ${s.color}`,
            }}
          >
            <div style={{ fontSize: 11, color: "#888", letterSpacing: 0.3 }}>
              {s.label.toUpperCase()}
            </div>
            <div
              style={{
                fontSize: 22,
                fontVariantNumeric: "tabular-nums",
                marginTop: 2,
                color: "#eee",
              }}
            >
              {text}
              <span style={{ fontSize: 12, color: "#888", marginLeft: 4 }}>{s.unit}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
