"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { METRIC_LABELS, Sensor, Uom, sameId } from "../lib/growlink";
import { UOM_OPTIONS } from "../lib/prefs";
import { PALETTE } from "../lib/sensors";
import { btn, inputStyle } from "./ui";

const MAX = 20;

// Modal for a camera's display settings. Nothing applies until Save:
//   Sensors — saved on the camera, shared with everyone in the organization.
//             Only sensors from the camera's own room are offered.
//   Units   — this viewer's preference, saved in this browser.
export default function DisplaySettings({
  cameraName,
  roomName,
  roomSensors,
  selected,
  uom,
  initialTab = "sensors",
  onSave,
  onClose,
}: {
  cameraName: string;
  roomName: string;
  roomSensors: Sensor[] | null;
  selected: string[];
  uom: Uom;
  initialTab?: "sensors" | "units";
  onSave: (sensors: string[] | null, uom: Uom | null) => Promise<void>;
  onClose: () => void;
}) {
  const initial = useMemo(() => selected.map((s) => s.toLowerCase()), [selected]);
  const [tab, setTab] = useState(initialTab);
  const [picked, setPicked] = useState<string[]>(initial);
  const [units, setUnits] = useState<Uom>(uom);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  const sensorsDirty = picked.join() !== initial.join();
  const unitsDirty = JSON.stringify(units) !== JSON.stringify(uom);
  const dirty = sensorsDirty || unitsDirty;

  const cancel = () => {
    if (dirty && !confirm("Discard your changes?")) return;
    onClose();
  };

  // Focus moves into the dialog once, on open. Esc cancels — unless it was
  // already used to cancel a keyboard drag.
  const cancelRef = useRef(cancel);
  cancelRef.current = cancel;
  useEffect(() => {
    dialog.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) cancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await onSave(sensorsDirty ? picked : null, unitsDirty ? units : null);
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const byId = (id: string) => roomSensors?.find((s) => sameId(s.id, id));

  const toggle = (id: string) => {
    const k = id.toLowerCase();
    setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : p.length >= MAX ? p : [...p, k]));
  };

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

  const dnd = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    setPicked((p) => arrayMove(p, p.indexOf(String(active.id)), p.indexOf(String(over.id))));
  };

  const changes = [
    sensorsDirty && "sensors",
    unitsDirty && "units",
  ].filter(Boolean).join(" and ");

  return (
    <div style={backdrop} onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        style={panel}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 20px 0" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 id="settings-title" style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>Display settings</h2>
            <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{cameraName} · {roomName}</div>
          </div>
          <button onClick={cancel} aria-label="Cancel and close" style={iconBtn}>✕</button>
        </div>

        {/* Tabs */}
        <div role="tablist" style={{ display: "flex", gap: 4, padding: "12px 20px 0", borderBottom: "1px solid #242424" }}>
          {(["sensors", "units"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              style={{
                ...tabBtn,
                color: tab === t ? "#eee" : "#888",
                borderBottomColor: tab === t ? "#1d9e75" : "transparent",
              }}
            >
              {t === "sensors" ? `Sensors (${picked.length})` : "Units"}
              {(t === "sensors" ? sensorsDirty : unitsDirty) && <span aria-label="changed" style={dot} />}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {tab === "sensors" ? (
            <>
              <p style={note}>
                Pick the sensors from <b>{roomName}</b> to show with this camera, then drag them into the order you
                want. Shared with everyone in your organization.
              </p>
              <div style={columns}>
                {/* Available */}
                <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <div style={colHead}>Available in {roomName}</div>
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Search by name, module or type"
                    aria-label="Search sensors"
                    style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: 8 }}
                  />
                  <div style={listBox}>
                    {roomSensors == null ? (
                      <div style={empty}>Loading sensors from Growlink…</div>
                    ) : roomSensors.length === 0 ? (
                      <div style={empty}>Growlink reports no sensors in this room.</div>
                    ) : groups.length === 0 ? (
                      <div style={empty}>No sensors match “{filter}”.</div>
                    ) : (
                      groups.map(([metric, list]) => (
                        <div key={metric}>
                          <div style={groupHead}>{metric}</div>
                          {list.map((s) => {
                            const on = picked.includes(s.id.toLowerCase());
                            const full = !on && picked.length >= MAX;
                            return (
                              <label key={s.id} style={{ ...availRow, opacity: full ? 0.4 : 1, background: on ? "#132019" : "transparent" }}>
                                <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(s.id)} style={{ accentColor: "#1d9e75" }} />
                                <span style={{ flex: 1, minWidth: 0 }}>
                                  <span style={{ display: "block" }}>{s.name}</span>
                                  {s.moduleName && <span style={sub}>{s.moduleName}</span>}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Chosen, sortable */}
                <div style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
                  <div style={colHead}>
                    Shown with this camera
                    <span style={{ color: "#666", fontWeight: 400 }}> · drag to reorder</span>
                  </div>
                  <div style={{ ...listBox, padding: 6 }}>
                    {picked.length === 0 ? (
                      <div style={empty}>Tick sensors on the left and they’ll appear here.</div>
                    ) : (
                      <DndContext sensors={dnd} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                        <SortableContext items={picked} strategy={verticalListSortingStrategy}>
                          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
                            {picked.map((id, i) => {
                              const s = byId(id);
                              return (
                                <SortableRow
                                  key={id}
                                  id={id}
                                  color={PALETTE[i % PALETTE.length]}
                                  name={s?.name ?? "Removed from Growlink"}
                                  detail={s ? [METRIC_LABELS[s.metric], s.moduleName].filter(Boolean).join(" · ") : ""}
                                  missing={!s && roomSensors != null}
                                  onRemove={() => toggle(id)}
                                />
                              );
                            })}
                          </ol>
                        </SortableContext>
                      </DndContext>
                    )}
                  </div>
                  <div style={{ ...sub, marginTop: 6 }}>{picked.length} of {MAX} max</div>
                </div>
              </div>
            </>
          ) : (
            <>
              <p style={note}>Your preference, saved in this browser. Applies to every camera.</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16 }}>
                {UOM_OPTIONS.map((o) => (
                  <fieldset key={o.key} style={{ border: "1px solid #242424", borderRadius: 8, padding: "10px 12px", margin: 0 }}>
                    <legend style={{ fontSize: 12, color: "#888", padding: "0 4px" }}>{o.label}</legend>
                    <div style={{ display: "flex", gap: 6 }}>
                      {o.options.map((x) => {
                        const on = units[o.key] === x.value;
                        return (
                          <button
                            key={x.value}
                            onClick={() => setUnits({ ...units, [o.key]: x.value } as Uom)}
                            aria-pressed={on}
                            style={{
                              ...btn,
                              flex: 1,
                              background: on ? "#132019" : "#1a1a1a",
                              borderColor: on ? "#1d9e75" : "#333",
                              color: on ? "#eee" : "#999",
                            }}
                          >
                            {x.label}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer: always visible */}
        <div style={footer}>
          <div style={{ flex: 1, fontSize: 13, color: err ? "#e24b4a" : dirty ? "#ef9f27" : "#666", minWidth: 0 }}>
            {err ?? (dirty ? `Unsaved changes to ${changes}` : "No changes")}
          </div>
          <button onClick={cancel} style={{ ...btn, padding: "8px 16px" }}>Cancel</button>
          <button onClick={save} disabled={!dirty || busy} style={{ ...primary, opacity: !dirty || busy ? 0.45 : 1 }}>
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SortableRow({
  id,
  color,
  name,
  detail,
  missing,
  onRemove,
}: {
  id: string;
  color: string;
  name: string;
  detail: string;
  missing: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        background: isDragging ? "#232323" : "#1a1a1a",
        border: `1px solid ${isDragging ? "#1d9e75" : "#2a2a2a"}`,
        borderRadius: 6,
        boxShadow: isDragging ? "0 6px 20px rgba(0,0,0,0.5)" : "none",
        position: "relative",
        zIndex: isDragging ? 1 : 0,
      }}
    >
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${name}`}
        style={handle}
      >
        ⠿
      </button>
      <span style={{ width: 10, height: 10, borderRadius: 99, background: color, flex: "none" }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: missing ? "#ef9f27" : "#eee" }}>
          {name}
        </span>
        {detail && <span style={sub}>{detail}</span>}
      </span>
      <button onClick={onRemove} aria-label={`Remove ${name}`} style={iconBtn}>✕</button>
    </li>
  );
}

const backdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
  zIndex: 50,
};
const panel: React.CSSProperties = {
  width: "min(880px, 100%)",
  maxHeight: "min(760px, 100%)",
  display: "flex",
  flexDirection: "column",
  background: "#141414",
  border: "1px solid #2a2a2a",
  borderRadius: 12,
  boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
  outline: "none",
  color: "#eee",
};
const columns: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 20,
};
const colHead: React.CSSProperties = { fontSize: 13, fontWeight: 500, marginBottom: 8 };
const listBox: React.CSSProperties = {
  border: "1px solid #242424",
  borderRadius: 8,
  height: 340,
  overflowY: "auto",
  background: "#111",
};
const note: React.CSSProperties = { fontSize: 13, color: "#999", margin: "0 0 16px" };
const sub: React.CSSProperties = { display: "block", fontSize: 12, color: "#777" };
const empty: React.CSSProperties = { padding: 24, color: "#777", fontSize: 13, textAlign: "center" };
const groupHead: React.CSSProperties = {
  fontSize: 11,
  color: "#888",
  letterSpacing: 0.4,
  textTransform: "uppercase",
  padding: "8px 12px 4px",
  background: "#161616",
  position: "sticky",
  top: 0,
};
const availRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "8px 12px",
  fontSize: 14,
  cursor: "pointer",
};
const handle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#777",
  cursor: "grab",
  fontSize: 18,
  lineHeight: 1,
  padding: "4px 2px",
  touchAction: "none",
};
const iconBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#888",
  cursor: "pointer",
  fontSize: 15,
  padding: 6,
  lineHeight: 1,
};
const tabBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  borderBottom: "2px solid transparent",
  padding: "8px 12px",
  fontSize: 14,
  cursor: "pointer",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};
const dot: React.CSSProperties = { width: 6, height: 6, borderRadius: 99, background: "#ef9f27" };
const footer: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "14px 20px",
  borderTop: "1px solid #242424",
  background: "#161616",
  borderRadius: "0 0 12px 12px",
};
const primary: React.CSSProperties = {
  background: "#1d9e75",
  color: "#04140e",
  border: "none",
  borderRadius: 6,
  padding: "8px 18px",
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
};
