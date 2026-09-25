"use client";

import { useState } from "react";
import { Camera, claimCamera, revokeCamera, updateCamera } from "../lib/api";
import { Org, Room, ROOM_TYPE_LABELS } from "../lib/growlink";
import { btn, inputStyle } from "./ui";

export default function CameraHome({
  apiKey,
  orgs,
  orgId,
  onOrgChange,
  rooms,
  cameras,
  onCamerasChange,
  onOpen,
  onSignOut,
}: {
  apiKey: string;
  orgs: Org[];
  orgId: string;
  onOrgChange: (id: string) => void;
  rooms: Room[];
  cameras: Camera[];
  onCamerasChange: (c: Camera[]) => void;
  onOpen: (cameraId: string) => void;
  onSignOut: () => void;
}) {
  const [claiming, setClaiming] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const replace = (c: Camera) => onCamerasChange(cameras.map((x) => (x.id === c.id ? c : x)));

  // Group cameras by room, keeping Growlink's room order; rooms without cameras are omitted.
  const groups = rooms
    .map((r) => ({ room: r, cams: cameras.filter((c) => c.roomId === r.id.toLowerCase()) }))
    .filter((g) => g.cams.length > 0);
  const orphans = cameras.filter((c) => !rooms.some((r) => r.id.toLowerCase() === c.roomId));

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, margin: 0, fontWeight: 500, flex: 1 }}>Plant Health Timelapse</h1>
        {orgs.length > 1 && (
          <select value={orgId} onChange={(e) => onOrgChange(e.target.value)} style={inputStyle}>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        <button style={btn} onClick={() => setClaiming(true)}>+ Add camera</button>
        <button style={{ ...btn, color: "#888" }} onClick={onSignOut}>Sign out</button>
      </div>

      {claiming && (
        <ClaimCamera
          rooms={rooms}
          onCancel={() => setClaiming(false)}
          onClaim={async (body) => {
            const cam = await claimCamera(apiKey, orgId, body);
            onCamerasChange([...cameras, cam]);
            setClaiming(false);
          }}
        />
      )}

      {cameras.length === 0 && !claiming && (
        <div style={{ padding: "48px 0", textAlign: "center", color: "#888", lineHeight: 1.6 }}>
          No cameras yet.
          <br />
          Plug a Growlink camera into a PoE port, then choose <b>Add camera</b> and enter its Growlink setup code.
        </div>
      )}

      {[...groups, ...(orphans.length ? [{ room: null as Room | null, cams: orphans }] : [])].map((g) => (
        <section key={g.room?.id ?? "orphans"} style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: 13, color: "#888", fontWeight: 500, letterSpacing: 0.3, textTransform: "uppercase", margin: "0 0 8px" }}>
            {g.room ? `${g.room.name} · ${ROOM_TYPE_LABELS[g.room.roomType] ?? ""}` : "Room no longer in Growlink"}
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
            {g.cams.map((c) => (
              <CameraCard
                key={c.id}
                camera={c}
                editing={editing === c.id}
                rooms={rooms}
                onOpen={() => onOpen(c.id)}
                onEdit={() => setEditing(editing === c.id ? null : c.id)}
                onSave={async (patch) => { replace(await updateCamera(apiKey, orgId, c.id, patch)); setEditing(null); }}
                onRevoke={async () => { replace(await revokeCamera(apiKey, orgId, c.id)); setEditing(null); }}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function status(c: Camera): { label: string; color: string } {
  if (c.revoked) return { label: "Revoked", color: "#666" };
  const seenAge = c.lastSeenAt ? Date.now() - new Date(c.lastSeenAt).getTime() : Infinity;
  const online = seenAge <= c.intervalSec * 3 * 1000;
  if (!c.lastFrameAt)
    return online
      ? { label: "Connected, first frame soon", color: "#ef9f27" }
      : { label: "Waiting for camera", color: "#ef9f27" };
  return online ? { label: "Capturing", color: "#1d9e75" } : { label: "Offline", color: "#e24b4a" };
}

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};

function CameraCard({
  camera: c,
  editing,
  rooms,
  onOpen,
  onEdit,
  onSave,
  onRevoke,
}: {
  camera: Camera;
  editing: boolean;
  rooms: Room[];
  onOpen: () => void;
  onEdit: () => void;
  onSave: (p: { name: string; roomId: string }) => Promise<void>;
  onRevoke: () => Promise<void>;
}) {
  const st = status(c);
  const [name, setName] = useState(c.name);
  const [roomId, setRoomId] = useState(c.roomId);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    setErr(null);
    try { await fn(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div style={{ background: "#161616", border: "1px solid #242424", borderRadius: 8, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 99, background: st.color, flex: "none" }} />
        <div style={{ fontWeight: 500, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</div>
        <span style={{ fontSize: 12, color: st.color }}>{st.label}</span>
      </div>
      <div style={{ fontSize: 12, color: "#888", marginTop: 6, lineHeight: 1.6 }}>
        Last frame {ago(c.lastFrameAt)}
        {c.serial && <><br />Serial {c.serial}</>}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button style={{ ...btn, flex: 1 }} onClick={onOpen} disabled={!c.lastFrameAt}>View timelapse</button>
        <button style={btn} onClick={onEdit} aria-expanded={editing}>Settings</button>
      </div>

      {editing && (
        <div style={{ borderTop: "1px solid #242424", marginTop: 12, paddingTop: 12, display: "grid", gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} aria-label="Camera name" />
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={inputStyle} aria-label="Room">
            {rooms.map((r) => <option key={r.id} value={r.id.toLowerCase()}>{r.name}</option>)}
          </select>
          <button style={btn} disabled={busy} onClick={run(() => onSave({ name, roomId }))}>Save</button>
          {!c.revoked && (
            <button
              style={{ ...btn, color: "#e24b4a" }}
              disabled={busy}
              onClick={run(async () => {
                if (confirm("Revoke this camera? It stops uploading immediately. Existing frames are kept. Reactivating it needs Growlink support."))
                  await onRevoke();
              })}
            >
              Revoke camera
            </button>
          )}
          {err && <div style={{ color: "#e24b4a", fontSize: 12 }}>{err}</div>}
        </div>
      )}
    </div>
  );
}

function ClaimCamera({
  rooms,
  onCancel,
  onClaim,
}: {
  rooms: Room[];
  onCancel: () => void;
  onClaim: (b: { code: string; roomId: string; name: string }) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await onClaim({ code, roomId, name: name.trim() });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} style={{ background: "#161616", border: "1px solid #242424", borderRadius: 8, padding: 16, marginBottom: 20, display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 500 }}>Add a camera</div>
      <div style={{ fontSize: 13, color: "#888" }}>
        Plug the camera into a PoE port on a network with internet access, then enter its Growlink setup code: 8 characters like 7K3M-Q9XW, on the Growlink label or setup sheet. This is not the camera&apos;s 16-character UID.
      </div>
      <label style={labelStyle}>
        Growlink setup code
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="XXXX-XXXX"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
          style={{ ...inputStyle, fontFamily: "ui-monospace, monospace", letterSpacing: 2 }}
        />
      </label>
      <label style={labelStyle}>
        Room
        <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={inputStyle}>
          {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <label style={labelStyle}>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Canopy camera" maxLength={80} style={inputStyle} />
      </label>
      {err && <div style={{ color: "#e24b4a", fontSize: 13 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="submit" style={btn} disabled={busy || !roomId || code.replace(/[\s-]/g, "").length < 8}>
          {busy ? "Adding…" : "Add camera"}
        </button>
        <button type="button" style={{ ...btn, color: "#888" }} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

const labelStyle: React.CSSProperties = { display: "grid", gap: 4, fontSize: 12, color: "#888" };
