"use client";

import { SENSORS, SensorKey } from "../lib/sensors";

export default function SensorToggles({
  visible,
  onToggle,
}: {
  visible: Set<SensorKey>;
  onToggle: (k: SensorKey) => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 16 }}>
      {SENSORS.map((s) => {
        const on = visible.has(s.key);
        return (
          <button
            key={s.key}
            onClick={() => onToggle(s.key)}
            style={{
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: 999,
              border: `1px solid ${on ? s.color : "#2a2a2a"}`,
              background: on ? `${s.color}22` : "transparent",
              color: on ? "#eee" : "#888",
              cursor: "pointer",
            }}
            aria-pressed={on}
          >
            <span style={{ color: s.color, marginRight: 6 }}>●</span>
            {s.short}
          </button>
        );
      })}
    </div>
  );
}
