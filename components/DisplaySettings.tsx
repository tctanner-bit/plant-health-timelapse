"use client";

import { useMemo, useState } from "react";
import { METRIC_LABELS, Sensor, Uom, sameId } from "../lib/growlink";
import { UOM_OPTIONS } from "../lib/prefs";
import { btn, inputStyle } from "./ui";

const MAX = 20;

// Two kinds of settings with different reach, kept visibly separate:
//   Sensors — saved on the camera, shared with everyone in the organization.
//             Only sensors from the camera's own room can be picked.
//   Units   — this viewer's preference, saved in this browser.
export default function DisplaySettings({
  roomName,
  roomSensors,
  selected,
  uom,
  onSaveSensors,
  onUomChange,
  onClose,
}: {
  roomName: string;
  roomSensors: Sensor[] | null;
  selected: string[];
  uom: Uom;
  onSaveSensors: (ids: string[]) => Promise<void>;
  onUomChange: (u: Uom) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<string[]>(selected.map((s) => s.toLowerCase()));
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const dirty = picked.join() !== selected.map((s) => s.toLowerCase()).join();

  // Room sensors grouped by metric, filtered by the search box.
  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = (roomSensors ?? []).filter(
      (s) =>
        !q ||
        s.name.toLowerCase().includes(q) ||
        (s.moduleName ?? "").toLowerCase().includes(q) ||
        (METRIC_LABELS[s.metric] ?? "").toLowerCase().includes(q)
    );
    const byMetric = new Map<string, Sensor[]>();
    for (const s of list) {
      const k = METRIC_LABELS[s.metric] ?? "Other";
      byMetric.set(k, [...(byMetric.get(k) ?? []), s]);
    }
    return Array.from(byMetric.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [roomSensors, filter]);

  const nameOf = (id: string) => roomSensors?.find((s) => sameId(s.id, id))?.name ?? "Removed sensor";

  const toggle = (id: string) => {
    const k = id.toLowerCase();
    setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : p.length >= MAX ? p : [...p, k]));
  };

  const move = (i: number, d: -1 | 1) =>
    setPicked((p) => {
      const j = i + d;
      if (j < 0 || j >= p.length) return p;
      const next = [...p];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onSaveSensors(picked);
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Display settings"
      style={{ background: "#161616", border: "1px solid #242424", borderRadius: 8, padding: 16, marginBottom: 16 }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontWeight: 500, flex: 1 }}>Display settings</div>
        <button style={{ ...btn, color: "#888" }} onClick={onClose} aria-label="Close settings">Close</button>
      </div>

      <section>
        <div style={sectionHead}>Sensors</div>
        <div style={note}>
          Choose which sensors from <b>{roomName}</b> appear with this camera, and in what order. Saved on the
          camera for everyone in your organization.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 10 }}>
          <div>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search sensors in this room"
              aria-label="Search sensors"
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 8 }}
            />
            <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid #242424", borderRadius: 6 }}>
              {roomSensors == null ? (
                <div style={empty}>Loading sensors…</div>
              ) : roomSensors.length === 0 ? (
                <div style={empty}>Growlink reports no sensors in this room.</div>
              ) : groups.length === 0 ? (
                <div style={empty}>No sensors match.</div>
              ) : (
                groups.map(([metric, list]) => (
                  <div key={metric}>
                    <div style={groupHead}>{metric}</div>
                    {list.map((s) => {
                      const on = picked.includes(s.id.toLowerCase());
                      return (
                        <label key={s.id} style={row}>
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() => toggle(s.id)}
                            disabled={!on && picked.length >= MAX}
                          />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            {s.name}
                            {s.moduleName && <span style={{ color: "#666", marginLeft: 6, fontSize: 12 }}>{s.moduleName}</span>}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
              Shown with this camera ({picked.length}/{MAX})
            </div>
            {picked.length === 0 ? (
              <div style={{ ...empty, border: "1px dashed #333", borderRadius: 6 }}>Nothing selected yet.</div>
            ) : (
              <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
                {picked.map((id, i) => (
                  <li key={id} style={{ ...row, background: "#1a1a1a", borderRadius: 6, cursor: "default" }}>
                    <span style={{ color: "#666", width: 18, textAlign: "right" }}>{i + 1}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {nameOf(id)}
                    </span>
                    <button style={mini} onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${nameOf(id)} up`}>↑</button>
                    <button style={mini} onClick={() => move(i, 1)} disabled={i === picked.length - 1} aria-label={`Move ${nameOf(id)} down`}>↓</button>
                    <button style={mini} onClick={() => toggle(id)} aria-label={`Remove ${nameOf(id)}`}>✕</button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        {err && <div style={{ color: "#e24b4a", fontSize: 13, marginTop: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button style={btn} onClick={save} disabled={busy || !dirty}>{busy ? "Saving…" : "Save sensors"}</button>
          {dirty && (
            <button style={{ ...btn, color: "#888" }} onClick={() => setPicked(selected.map((s) => s.toLowerCase()))}>
              Undo changes
            </button>
          )}
        </div>
      </section>

      <section style={{ borderTop: "1px solid #242424", marginTop: 16, paddingTop: 16 }}>
        <div style={sectionHead}>Units</div>
        <div style={note}>Your preference, saved in this browser. Applies to every camera.</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 10 }}>
          {UOM_OPTIONS.map((o) => (
            <label key={o.key} style={{ display: "grid", gap: 4, fontSize: 12, color: "#888" }}>
              {o.label}
              <select
                value={uom[o.key]}
                onChange={(e) => onUomChange({ ...uom, [o.key]: Number(e.target.value) } as Uom)}
                style={inputStyle}
              >
                {o.options.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
              </select>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}

const sectionHead: React.CSSProperties = { fontSize: 13, fontWeight: 500, marginBottom: 2 };
const note: React.CSSProperties = { fontSize: 12, color: "#888" };
const empty: React.CSSProperties = { padding: 16, color: "#888", fontSize: 13, textAlign: "center" };
const groupHead: React.CSSProperties = {
  fontSize: 11, color: "#888", letterSpacing: 0.3, textTransform: "uppercase",
  padding: "8px 10px 4px", background: "#141414", position: "sticky", top: 0,
};
const row: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", fontSize: 13, cursor: "pointer",
};
const mini: React.CSSProperties = { ...btn, padding: "2px 8px", fontSize: 12 };
