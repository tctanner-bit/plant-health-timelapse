"use client";

import { SensorMeta } from "../lib/sensors";

export default function SensorToggles({
  sensors,
  visible,
  onToggle,
}: {
  sensors: SensorMeta[];
  visible: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (sensors.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 16 }}>
      {sensors.map((s) => {
        const on = visible.has(s.id);
        return (
          <button
            key={s.id}
            onClick={() => onToggle(s.id)}
            title={s.label}
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
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
