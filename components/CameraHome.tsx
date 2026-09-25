"use client";

import { useEffect, useState } from "react";
import { Camera, claimCamera, listFrames, revokeCamera, signFrames, updateCamera } from "../lib/api";
import { Org, Room, ROOM_TYPE_LABELS } from "../lib/growlink";
import { Brand } from "./ui";

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
  const org = orgs.find((o) => o.id.toLowerCase() === orgId.toLowerCase());

  return (
    <div className="page">
      <header className="row" style={{ flexWrap: "wrap", alignItems: "flex-end", marginBottom: 28, gap: 16 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <Brand />
          <h1 className="title" style={{ marginTop: 10 }}>Cameras</h1>
          {orgs.length === 1 && <div className="subtitle">{org?.name}</div>}
        </div>
        {orgs.length > 1 && (
          <select className="field" value={orgId} onChange={(e) => onOrgChange(e.target.value)} style={{ width: "auto", minWidth: 200 }} aria-label="Organization">
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        <button className="btn accent" onClick={() => setClaiming(true)}>+ Add camera</button>
        <button className="btn ghost" onClick={onSignOut}>Sign out</button>
      </header>

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
        <div className="card" style={{ textAlign: "center", padding: "56px 24px" }}>
          <div className="eyebrow">No cameras yet</div>
          <p className="muted" style={{ maxWidth: 440, margin: "12px auto 20px", lineHeight: 1.5 }}>
            Plug a Growlink camera into a PoE port, then add it here with its Growlink setup code.
          </p>
          <button className="btn accent" onClick={() => setClaiming(true)}>+ Add camera</button>
        </div>
      )}

      {[...groups, ...(orphans.length ? [{ room: null as Room | null, cams: orphans }] : [])].map((g) => (
        <section key={g.room?.id ?? "orphans"}>
          <div className="section-head">
            <span className="eyebrow" style={{ color: "var(--text)" }}>
              {g.room ? g.room.name : "Room no longer in Growlink"}
            </span>
            {g.room && <span className="eyebrow">{ROOM_TYPE_LABELS[g.room.roomType] ?? ""}</span>}
          </div>
          <div className="cams">
            {g.cams.map((c) => (
              <CameraCard
                key={c.id}
                apiKey={apiKey}
                orgId={orgId}
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

function status(c: Camera): { label: string; tone: "ok" | "warn" | "alarm" | "idle" } {
  if (c.revoked) return { label: "Revoked", tone: "idle" };
  const seenAge = c.lastSeenAt ? Date.now() - new Date(c.lastSeenAt).getTime() : Infinity;
  const online = seenAge <= c.intervalSec * 3 * 1000;
  if (!c.lastFrameAt) return online ? { label: "First frame soon", tone: "warn" } : { label: "Waiting", tone: "warn" };
  return online ? { label: "Capturing", tone: "ok" } : { label: "Offline", tone: "alarm" };
}

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
};

// Latest frame as a thumbnail. One frames call and one signing call per card.
function useLatestFrame(apiKey: string, orgId: string, c: Camera) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!c.lastFrameAt) return;
    let dead = false;
    const t = new Date(c.lastFrameAt).getTime();
    listFrames(apiKey, orgId, c.id, t - 15 * 60_000, t + 60_000)
      .then((r) => {
        const last = r.frames[r.frames.length - 1];
        return last ? signFrames(apiKey, orgId, c.id, [last.id]).then((u) => u[last.id]) : undefined;
      })
      .then((u) => !dead && u && setUrl(u))
      .catch(() => {});
    return () => { dead = true; };
  }, [apiKey, orgId, c.id, c.lastFrameAt]);
  return url;
}

function CameraCard({
  apiKey,
  orgId,
  camera: c,
  editing,
  rooms,
  onOpen,
  onEdit,
  onSave,
  onRevoke,
}: {
  apiKey: string;
  orgId: string;
  camera: Camera;
  editing: boolean;
  rooms: Room[];
  onOpen: () => void;
  onEdit: () => void;
  onSave: (p: { name: string; roomId: string }) => Promise<void>;
  onRevoke: () => Promise<void>;
}) {
  const st = status(c);
  const thumb = useLatestFrame(apiKey, orgId, c);
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
    <div className="card">
      <button
        className="cam-thumb"
        onClick={onOpen}
        disabled={!c.lastFrameAt}
        aria-label={`Open ${c.name} timelapse`}
        style={{ border: "none", padding: 0, width: "calc(100% + 8px)", cursor: c.lastFrameAt ? "pointer" : "default" }}
      >
        {thumb ? <img src={thumb} alt="" /> : c.lastFrameAt ? "Loading…" : "No frames yet"}
      </button>

      <div className="row" style={{ alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.01em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {c.name}
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            Last frame {ago(c.lastFrameAt)}
            {c.serial && <> · {c.serial}</>}
          </div>
        </div>
        <span className={`status ${st.tone}`}>{st.label}</span>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn accent" style={{ flex: 1 }} onClick={onOpen} disabled={!c.lastFrameAt}>View timelapse</button>
        <button className="btn" onClick={onEdit} aria-expanded={editing}>Manage</button>
      </div>

      {editing && (
        <div className="stack" style={{ borderTop: "1px solid var(--line)", marginTop: 16, paddingTop: 16, gap: 12 }}>
          <label className="label">
            <span>Name</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="label">
            <span>Room</span>
            <select className="field" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {rooms.map((r) => <option key={r.id} value={r.id.toLowerCase()}>{r.name}</option>)}
            </select>
          </label>
          {roomId !== c.roomId && (
            <div className="small" style={{ color: "var(--warn)" }}>
              Moving rooms clears this camera&apos;s sensor selection.
            </div>
          )}
          <div className="row">
            <button className="btn solid" style={{ flex: 1 }} disabled={busy} onClick={run(() => onSave({ name, roomId }))}>Save</button>
            {!c.revoked && (
              <button
                className="btn danger"
                disabled={busy}
                onClick={run(async () => {
                  if (confirm("Revoke this camera? It stops uploading immediately. Existing frames are kept. Reactivating it needs Growlink support."))
                    await onRevoke();
                })}
              >
                Revoke
              </button>
            )}
          </div>
          {err && <div className="error-text">{err}</div>}
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
    <form onSubmit={submit} className="card" style={{ marginBottom: 28, borderColor: "var(--line-hi)" }}>
      <div className="eyebrow ok">Add a camera</div>
      <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, margin: "8px 0 18px", maxWidth: 640 }}>
        Plug the camera into a PoE port on a network with internet access, then enter its Growlink setup code:
        8 characters like 7K3M-Q9XW, from the Growlink label or setup sheet. Not the camera&apos;s 16-character UID.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
        <label className="label">
          <span>Growlink setup code</span>
          <input
            className="field mono"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="XXXX-XXXX"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            maxLength={12}
          />
        </label>
        <label className="label">
          <span>Room</span>
          <select className="field" value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
        <label className="label">
          <span>Name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Canopy camera" maxLength={80} />
        </label>
      </div>
      {err && <div className="error-text" style={{ marginTop: 12 }}>{err}</div>}
      <div className="row" style={{ marginTop: 18 }}>
        <button type="submit" className="btn solid" disabled={busy || !roomId || code.replace(/[\s-]/g, "").length < 8}>
          {busy ? "Adding…" : "Add camera"}
        </button>
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
