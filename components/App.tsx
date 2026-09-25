"use client";

import { useCallback, useEffect, useState } from "react";
import { Camera, listCameras, loadApiKey, saveApiKey } from "../lib/api";
import { Org, Room, getOrganizations, getRooms } from "../lib/growlink";
import CameraHome from "./CameraHome";
import FacilityView from "./FacilityView";
import Player from "./Player";
import { Brand, Centered } from "./ui";

// Top-level flow: API key → organization → home (Facility view or Cameras
// management) → player. The org, home tab and camera live in the URL
// (?org=…&view=…&camera=…) so a Builder page or a display cast can deep-link
// straight to the facility view or one room's timelapse.

type HomeView = "facility" | "cameras";

export default function App() {
  const [apiKey, setApiKey] = useState<string | null | undefined>(undefined);
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [cameras, setCameras] = useState<Camera[] | null>(null);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<HomeView>("facility");
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setOrgId(q.get("org"));
    setCameraId(q.get("camera"));
    if (q.get("view") === "cameras") setView("cameras");
    setApiKey(loadApiKey());
  }, []);

  useEffect(() => {
    if (apiKey === undefined) return;
    const q = new URLSearchParams(window.location.search);
    orgId ? q.set("org", orgId) : q.delete("org");
    cameraId ? q.set("camera", cameraId) : q.delete("camera");
    view === "cameras" ? q.set("view", "cameras") : q.delete("view");
    const s = q.toString();
    window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
  }, [apiKey, orgId, cameraId, view]);

  useEffect(() => {
    if (!apiKey) return;
    getOrganizations(apiKey)
      .then((list) => {
        setOrgs(list);
        setOrgId((cur) => (cur && list.some((o) => o.id.toLowerCase() === cur.toLowerCase()) ? cur : list[0]?.id ?? null));
      })
      .catch((e) => {
        if (/invalid api key/i.test(e.message)) signOut();
        else setError(e.message);
      });
  }, [apiKey]);

  const reload = async () => {
    if (!apiKey || !orgId) return;
    setError(null);
    try {
      const [r, c] = await Promise.all([getRooms(apiKey, orgId), listCameras(apiKey, orgId)]);
      setRooms(r);
      setCameras(c);
    } catch (e: any) {
      setError(e.message);
    }
  };

  // Background refresh for the facility view: keeps status current without
  // replacing the screen with an error if one poll fails.
  const refreshCameras = useCallback(async () => {
    if (!apiKey || !orgId) return;
    try {
      setCameras(await listCameras(apiKey, orgId));
    } catch {}
  }, [apiKey, orgId]);

  useEffect(() => {
    setRooms(null);
    setCameras(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, orgId]);

  function signOut() {
    saveApiKey(null);
    setApiKey(null);
    setOrgs(null);
    setCameras(null);
    setRooms(null);
  }

  if (apiKey === undefined) return null;
  if (!apiKey) return <KeyGate onKey={(k) => { saveApiKey(k); setApiKey(k); }} />;
  if (error)
    return (
      <Centered>
        <div className="error-text">{error}</div>
        <button className="btn" style={{ marginTop: 16 }} onClick={reload}>Retry</button>
      </Centered>
    );
  if (!orgs || !rooms || !cameras || !orgId) return <Centered><span className="eyebrow">Loading…</span></Centered>;
  if (orgs.length === 0) return <Centered><span className="muted">This API key isn&apos;t linked to any organization.</span></Centered>;

  const camera = cameras.find((c) => c.id === cameraId);
  if (camera) {
    return (
      <Player
        key={camera.id}
        apiKey={apiKey}
        orgId={orgId}
        camera={camera}
        roomName={rooms.find((r) => r.id.toLowerCase() === camera.roomId)?.name ?? "Unknown room"}
        onBack={() => { setCameraId(null); reload(); }}
        onCameraChange={(c) => setCameras((list) => list?.map((x) => (x.id === c.id ? c : x)) ?? list)}
      />
    );
  }

  const org = orgs.find((o) => o.id.toLowerCase() === orgId.toLowerCase());
  return (
    <div className={`page${view === "facility" ? " wide" : ""}`}>
      <header className="row" style={{ flexWrap: "wrap", alignItems: "flex-end", marginBottom: 24, gap: 16 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <Brand />
          <h1 className="title" style={{ marginTop: 10 }}>{org?.name ?? "Facility"}</h1>
        </div>
        {orgs.length > 1 && (
          <select className="field" value={orgId} onChange={(e) => { setCameraId(null); setOrgId(e.target.value); }} style={{ width: "auto", minWidth: 200 }} aria-label="Organization">
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        )}
        <button className="btn accent" onClick={() => { setView("cameras"); setClaiming(true); }}>+ Add camera</button>
        <button className="btn ghost" onClick={signOut}>Sign out</button>
      </header>

      <div role="tablist" className="tabs" style={{ padding: 0, marginBottom: 24 }}>
        {(["facility", "cameras"] as HomeView[]).map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className="tab" onClick={() => setView(v)}>
            {v === "facility" ? "Facility" : `Cameras · ${cameras.length}`}
          </button>
        ))}
      </div>

      {view === "facility" ? (
        <FacilityView
          apiKey={apiKey}
          orgId={orgId}
          rooms={rooms}
          cameras={cameras}
          onOpen={(id) => setCameraId(id)}
          onRefreshCameras={refreshCameras}
          onAddCamera={() => { setView("cameras"); setClaiming(true); }}
        />
      ) : (
        <CameraHome
          apiKey={apiKey}
          orgId={orgId}
          rooms={rooms}
          cameras={cameras}
          claiming={claiming}
          onClaimingChange={setClaiming}
          onCamerasChange={setCameras}
          onOpen={(id) => setCameraId(id)}
        />
      )}
    </div>
  );
}

function KeyGate({ onKey }: { onKey: (k: string) => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const k = key.trim();
    if (!k) return;
    setBusy(true);
    setErr(null);
    try {
      await getOrganizations(k);
      onKey(k);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Centered>
      <form onSubmit={submit} className="card" style={{ width: "min(440px, 100%)", textAlign: "left", padding: 28 }}>
        <Brand />
        <h1 className="title" style={{ marginTop: 14 }}>Sign in</h1>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, margin: "8px 0 22px" }}>
          Use your Growlink API key (portal → Builder → Authentication). It stays in this browser tab and is
          forgotten when the tab closes.
        </p>
        <label className="label">
          <span>API key</span>
          <input
            className="field"
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Paste your key"
            autoFocus
          />
        </label>
        {err && <div className="error-text" style={{ marginTop: 10 }}>{err}</div>}
        <button type="submit" className="btn solid" disabled={busy || !key.trim()} style={{ marginTop: 18, width: "100%" }}>
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    </Centered>
  );
}
