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

const MAX = 20;

type Patch = { sensors?: string[]; averageSameType?: boolean };

// Modal for a camera's display settings. Nothing applies until Save:
//   Sensors — saved on the camera, shared with everyone in the organization.
//             Only sensors from the camera's own room are offered.
//   Units   — this viewer's preference, saved in this browser.
export default function DisplaySettings({
  cameraName,
  roomName,
  roomSensors,
  selected,
  averageSameType,
  uom,
  initialTab = "sensors",
  onSave,
  onClose,
}: {
  cameraName: string;
  roomName: string;
  roomSensors: Sensor[] | null;
  selected: string[];
  averageSameType: boolean;
  uom: Uom;
  initialTab?: "sensors" | "units";
  onSave: (patch: Patch | null, uom: Uom | null) => Promise<void>;
  onClose: () => void;
}) {
  const initial = useMemo(() => selected.map((s) => s.toLowerCase()), [selected]);
  const [tab, setTab] = useState(initialTab);
  const [picked, setPicked] = useState<string[]>(initial);
  const [average, setAverage] = useState(averageSameType);
  const [units, setUnits] = useState<Uom>(uom);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  const sensorsDirty = picked.join() !== initial.join() || average !== averageSameType;
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
      const patch: Patch = {};
      if (picked.join() !== initial.join()) patch.sensors = picked;
      if (average !== averageSameType) patch.averageSameType = average;
      await onSave(Object.keys(patch).length ? patch : null, unitsDirty ? units : null);
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

  // How many picked sensors share each metric — those get averaged.
  const perMetric = useMemo(() => {
    const m = new Map<number, number>();
    for (const id of picked) {
      const s = byId(id);
      if (s) m.set(s.metric, (m.get(s.metric) ?? 0) + 1);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, roomSensors]);
  const averagedTypes = Array.from(perMetric.entries()).filter(([, n]) => n > 1);

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

  const changes = [sensorsDirty && "sensors", unitsDirty && "units"].filter(Boolean).join(" and ");

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} className="modal">
        <div className="modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">{cameraName} · {roomName}</div>
            <h2 id="settings-title" className="title" style={{ fontSize: 24, marginTop: 6 }}>Display settings</h2>
          </div>
          <button onClick={cancel} aria-label="Cancel and close" className="btn icon ghost">✕</button>
        </div>

        <div role="tablist" className="tabs">
          {(["sensors", "units"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className="tab">
              {t === "sensors" ? `Sensors · ${picked.length}` : "Units"}
              {(t === "sensors" ? sensorsDirty : unitsDirty) && <span aria-label="changed" className="dirty" />}
            </button>
          ))}
        </div>

        <div className="modal-body">
          {tab === "sensors" ? (
            <>
              <p className="muted" style={{ fontSize: 14, margin: "0 0 18px", lineHeight: 1.5 }}>
                Pick the sensors from <b style={{ color: "var(--text)" }}>{roomName}</b> to show with this camera,
                then drag them into order. Shared with everyone in your organization.
              </p>
              <div className="pick-cols">
                <div>
                  <div className="eyebrow" style={{ marginBottom: 10 }}>Available in {roomName}</div>
                  <input
                    className="field"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Search by name, module or type"
                    aria-label="Search sensors"
                    style={{ marginBottom: 10 }}
                  />
                  <div className="listbox">
                    {roomSensors == null ? (
                      <Empty>Loading sensors from Growlink…</Empty>
                    ) : roomSensors.length === 0 ? (
                      <Empty>Growlink reports no sensors in this room.</Empty>
                    ) : groups.length === 0 ? (
                      <Empty>No sensors match “{filter}”.</Empty>
                    ) : (
                      groups.map(([metric, list]) => (
                        <div key={metric}>
                          <div className="group">{metric}</div>
                          {list.map((s) => {
                            const on = picked.includes(s.id.toLowerCase());
                            const full = !on && picked.length >= MAX;
                            return (
                              <label key={s.id} className={`pick${on ? " on" : ""}`} style={{ opacity: full ? 0.4 : 1, position: "relative" }}>
                                <input type="checkbox" checked={on} disabled={full} onChange={() => toggle(s.id)} />
                                <span className="check" aria-hidden>{on ? "✓" : ""}</span>
                                <span style={{ flex: 1, minWidth: 0 }}>
                                  <div className="pick-name">{s.name}</div>
                                  {s.moduleName && <div className="pick-sub">{s.moduleName}</div>}
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
                  <div className="eyebrow" style={{ marginBottom: 10 }}>
                    Shown with this camera <span style={{ color: "var(--dim)" }}>· drag to reorder</span>
                  </div>
                  <div className="listbox" style={{ height: 392 }}>
                    {picked.length === 0 ? (
                      <Empty>Tick sensors on the left and they’ll appear here.</Empty>
                    ) : (
                      <DndContext sensors={dnd} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
                        <SortableContext items={picked} strategy={verticalListSortingStrategy}>
                          <ol className="sortable">
                            {picked.map((id) => {
                              const s = byId(id);
                              return (
                                <SortableRow
                                  key={id}
                                  id={id}
                                  name={s?.name ?? "Removed from Growlink"}
                                  detail={s ? [METRIC_LABELS[s.metric], s.moduleName].filter(Boolean).join(" · ") : ""}
                                  averaged={!!s && average && (perMetric.get(s.metric) ?? 0) > 1}
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
                </div>
              </div>

              <label className="switch-row" onClick={(e) => { e.preventDefault(); setAverage((a) => !a); }}>
                <span className={`switch${average ? " on" : ""}`} role="switch" aria-checked={average} />
                <span style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>Average sensors of the same type</div>
                  <div className="small muted" style={{ marginTop: 2, lineHeight: 1.45 }}>
                    {averagedTypes.length
                      ? `Shows ${averagedTypes
                          .map(([m, n]) => `${n} ${(METRIC_LABELS[m] ?? "sensor").toLowerCase()} sensors`)
                          .join(", ")} as one room average, with the spread between them.`
                      : "When you pick more than one sensor of a type, show them as one room average."}
                  </div>
                </span>
              </label>
            </>
          ) : (
            <>
              <p className="muted" style={{ fontSize: 14, margin: "0 0 18px" }}>
                Your preference, saved in this browser. Applies to every camera.
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 16 }}>
                {UOM_OPTIONS.map((o) => (
                  <div key={o.key} className="label">
                    <span>{o.label}</span>
                    <div className="seg" role="group" aria-label={o.label}>
                      {o.options.map((x) => (
                        <button
                          key={x.value}
                          aria-pressed={units[o.key] === x.value}
                          onClick={() => setUnits({ ...units, [o.key]: x.value } as Uom)}
                        >
                          {x.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="modal-foot">
          <div style={{ flex: 1, minWidth: 0, fontSize: 13, color: err ? "var(--alarm)" : dirty ? "var(--warn)" : "var(--dim)" }}>
            {err ?? (dirty ? `Unsaved changes to ${changes}` : "No changes")}
          </div>
          <button onClick={cancel} className="btn ghost">Cancel</button>
          <button onClick={save} disabled={!dirty || busy} className="btn solid">
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: 28, color: "var(--muted)", fontSize: 13, textAlign: "center" }}>{children}</div>;
}

function SortableRow({
  id,
  name,
  detail,
  averaged,
  missing,
  onRemove,
}: {
  id: string;
  name: string;
  detail: string;
  averaged: boolean;
  missing: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      className={`sort-item${isDragging ? " dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition, position: "relative", zIndex: isDragging ? 1 : 0 }}
    >
      <button ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Drag to reorder ${name}`} className="handle">
        ⠿
      </button>
      <span style={{ flex: 1, minWidth: 0 }}>
        <div className="pick-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: missing ? "var(--warn)" : undefined }}>
          {name}
        </div>
        {detail && <div className="pick-sub">{detail}</div>}
      </span>
      {averaged && <span className="avg-badge">Avg</span>}
      <button onClick={onRemove} aria-label={`Remove ${name}`} className="btn icon ghost" style={{ width: 32, minHeight: 32 }}>✕</button>
    </li>
  );
}
