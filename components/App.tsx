"use client";

import { useEffect, useState } from "react";
import { Camera, listCameras, loadApiKey, saveApiKey } from "../lib/api";
import { Org, Room, getOrganizations, getRooms } from "../lib/growlink";
import CameraHome from "./CameraHome";
import Player from "./Player";
import { btn, Centered, inputStyle } from "./ui";

// Top-level flow: API key → organization → cameras (grouped by room) → player.
// The selected org and camera live in the URL (?org=…&camera=…) so a Builder
// page or a display cast can deep-link straight to one room's timelapse.

export default function App() {
  const [apiKey, setApiKey] = useState<string | null | undefined>(undefined);
  const [orgs, setOrgs] = useState<Org[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [cameras, setCameras] = useState<Camera[] | null>(null);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setOrgId(q.get("org"));
    setCameraId(q.get("camera"));
    setApiKey(loadApiKey());
  }, []);

  useEffect(() => {
    if (apiKey === undefined) return;
    const q = new URLSearchParams(window.location.search);
    orgId ? q.set("org", orgId) : q.delete("org");
    cameraId ? q.set("camera", cameraId) : q.delete("camera");
    const s = q.toString();
    window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
  }, [apiKey, orgId, cameraId]);

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
        <div>Error: {error}</div>
        <button style={{ ...btn, marginTop: 12 }} onClick={reload}>Retry</button>
      </Centered>
    );
  if (!orgs || !rooms || !cameras || !orgId) return <Centered>Loading…</Centered>;
  if (orgs.length === 0) return <Centered>This API key isn't linked to any organization.</Centered>;

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

  return (
    <CameraHome
      apiKey={apiKey}
      orgs={orgs}
      orgId={orgId}
      onOrgChange={(id) => { setCameraId(null); setOrgId(id); }}
      rooms={rooms}
      cameras={cameras}
      onCamerasChange={setCameras}
      onOpen={(id) => setCameraId(id)}
      onSignOut={signOut}
    />
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
      <form onSubmit={submit} style={{ width: "min(420px, 100%)", padding: 16 }}>
        <h1 style={{ fontSize: 18, fontWeight: 500, margin: "0 0 4px" }}>Plant Health AI</h1>
        <p style={{ fontSize: 13, color: "#888", margin: "0 0 16px" }}>
          Enter your Growlink API key (portal → Builder → Authentication). It stays in this browser tab
          and is forgotten when the tab closes.
        </p>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Growlink API key"
          autoFocus
          style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
        />
        {err && <div style={{ color: "#e24b4a", fontSize: 13, marginTop: 8 }}>{err}</div>}
        <button type="submit" disabled={busy || !key.trim()} style={{ ...btn, marginTop: 12, width: "100%" }}>
          {busy ? "Checking…" : "Continue"}
        </button>
      </form>
    </Centered>
  );
}
