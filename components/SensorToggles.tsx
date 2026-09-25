"use client";

import { SensorMeta } from "../lib/sensors";

// Show or hide rows for this viewing session. What's configured is chosen in
// Settings; this only filters it.
export default function SensorToggles({
  sensors,
  visible,
  onToggle,
}: {
  sensors: SensorMeta[];
  visible: Set<string>;
  onToggle: (id: string) => void;
}) {
  if (sensors.length < 2) return null;
  return (
    <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
      {sensors.map((s) => {
        const on = visible.has(s.id);
        return (
          <button
            key={s.id}
            className={`chip${on ? " on" : ""}`}
            onClick={() => onToggle(s.id)}
            title={s.detail ? `${s.label} · ${s.detail}` : s.label}
            aria-pressed={on}
          >
            <span className="swatch" style={{ background: on ? s.color : "var(--dim)" }} />
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
