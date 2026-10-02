"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BILLING_REQUIRED_EVENT,
  Billing,
  Camera,
  SIGN_IN_REQUIRED_EVENT,
  SiteSummary,
  getBilling,
  getRooms,
  listCameras,
  listSites,
} from "../lib/api";
import type { Room } from "../lib/growlink";
import { APP_URL, appPath } from "../lib/labs";
import { goToLabsAccount, labs, onLabsOrigin, onSessionChange } from "../lib/labs-client";
import BillingView from "./BillingView";
import CameraHome from "./CameraHome";
import ConnectSite from "./ConnectSite";
import FacilityView from "./FacilityView";
import Player from "./Player";
import SiteSettings from "./SiteSettings";
import { Brand, Centered } from "./ui";

// Top-level flow, inside Growlink LABS: LABS sign-in → site (a connected
// Growlink organization) → home (Facility, Cameras, Settings) → player. The
// site, tab and camera live in the URL (?org=…&view=…&camera=…) so a link can
// go straight to the facility view or one room's timelapse.

type HomeView = "facility" | "cameras" | "settings" | "billing";
const VIEWS: HomeView[] = ["facility", "cameras", "settings", "billing"];

// Screens stay open for days. When a newer deployment is live, reload onto
// it (URL state and the LABS session survive a reload).
const BUILD = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? null;
let lastBuildCheck = 0;
async function checkForNewBuild() {
  if (!BUILD || Date.now() - lastBuildCheck < 5 * 60_000) return;
  lastBuildCheck = Date.now();
  try {
    const r = await fetch(appPath("/api/version"), { cache: "no-store" });
    const { version } = await r.json();
    if (version && version !== BUILD) window.location.reload();
  } catch {}
}

export default function App() {
  const [signedIn, setSignedIn] = useState<boolean | undefined>(undefined);
  const [email, setEmail] = useState<string | null>(null);
  const [sites, setSites] = useState<SiteSummary[] | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [rooms, setRooms] = useState<Room[] | null>(null);
  const [cameras, setCameras] = useState<Camera[] | null>(null);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<HomeView>("facility");
  const [claiming, setClaiming] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [billing, setBilling] = useState<Billing | null>(null);

  // The LABS session lives on labs.growlink.io; the bare Vercel URL has none.
  useEffect(() => {
    if (!onLabsOrigin()) window.location.replace(APP_URL + window.location.search);
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setOrgId(q.get("org"));
    setCameraId(q.get("camera"));
    const v = q.get("view") as HomeView | null;
    if (v && VIEWS.includes(v)) setView(v);
    labs().auth.getSession().then(({ data }) => setSignedIn(!!data.session));
    return onSessionChange((s) => setSignedIn(!!s));
  }, []);

  // Requests refused for an expired session go back to the LABS sign-in.
  useEffect(() => {
    const onSignIn = () => setSignedIn(false);
    window.addEventListener(SIGN_IN_REQUIRED_EVENT, onSignIn);
    return () => window.removeEventListener(SIGN_IN_REQUIRED_EVENT, onSignIn);
  }, []);

  useEffect(() => {
    if (signedIn === undefined) return;
    const q = new URLSearchParams(window.location.search);
    orgId ? q.set("org", orgId) : q.delete("org");
    cameraId ? q.set("camera", cameraId) : q.delete("camera");
    view !== "facility" ? q.set("view", view) : q.delete("view");
    const s = q.toString();
    window.history.replaceState(null, "", s ? `?${s}` : window.location.pathname);
  }, [signedIn, orgId, cameraId, view]);

  const loadSites = useCallback(async (prefer?: string) => {
    try {
      const r = await listSites();
      setEmail(r.user.email);
      setSites(r.sites);
      setOrgId((cur) => {
        const want = prefer ?? cur;
        return want && r.sites.some((s) => s.orgId === want.toLowerCase()) ? want.toLowerCase() : r.sites[0]?.orgId ?? null;
      });
    } catch (e: any) {
      if (e.status !== 401) setError(e.message);
    }
  }, []);

  useEffect(() => {
    if (signedIn) loadSites();
    else if (signedIn === false) setSites(null);
  }, [signedIn, loadSites]);

  const reload = async () => {
    if (!orgId) return;
    setError(null);
    try {
      const [r, c] = await Promise.all([getRooms(orgId).catch(() => [] as Room[]), listCameras(orgId)]);
      setRooms(r);
      setCameras(c);
    } catch (e: any) {
      if (e.status !== 401) setError(e.message);
    }
  };

  // Background refresh: keeps status current without replacing the screen
  // with an error if one poll fails.
  const refreshCameras = useCallback(async () => {
    if (!orgId) return;
    try {
      setCameras(await listCameras(orgId));
    } catch {}
  }, [orgId]);

  const refreshBilling = useCallback(async () => {
    if (!orgId) return;
    try {
      setBilling(await getBilling(orgId));
    } catch {}
  }, [orgId]);

  useEffect(() => {
    setBilling(null);
    refreshBilling();
  }, [refreshBilling]);

  // Any request refused for billing (trial over) lands on the Billing tab.
  useEffect(() => {
    const onRequired = () => {
      setCameraId(null);
      setView("billing");
      refreshBilling();
    };
    window.addEventListener(BILLING_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(BILLING_REQUIRED_EVENT, onRequired);
  }, [refreshBilling]);

  // Keep camera status (online/offline, last frame) current on every screen:
  // once a minute while visible.
  useEffect(() => {
    if (!orgId) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      refreshCameras();
      refreshBilling();
      checkForNewBuild();
    };
    const t = window.setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [orgId, refreshCameras, refreshBilling]);

  useEffect(() => {
    setRooms(null);
    setCameras(null);
    if (orgId) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  async function signOut() {
    await labs().auth.signOut();
    setSites(null);
    setCameras(null);
    setRooms(null);
  }

  if (signedIn === undefined) return null;
  if (!signedIn) return <SignInGate />;
  if (error)
    return (
      <Centered>
        <div className="error-text">{error}</div>
        <button className="btn" style={{ marginTop: 16 }} onClick={() => { setError(null); loadSites(); reload(); }}>Retry</button>
      </Centered>
    );
  if (!sites) return <Centered><span className="eyebrow">Loading…</span></Centered>;
  if (sites.length === 0 || connecting)
    return (
      <ConnectSite
        email={email}
        onCancel={sites.length ? () => setConnecting(false) : undefined}
        onConnected={(id) => { setConnecting(false); setView("facility"); loadSites(id); }}
        onSignOut={signOut}
      />
    );
  if (!orgId || !rooms || !cameras) return <Centered><span className="eyebrow">Loading…</span></Centered>;

  const site = sites.find((s) => s.orgId === orgId);
  const owner = site?.role === "owner";
  const billingTab = !!billing?.configured;

  const camera = cameras.find((c) => c.id === cameraId);
  if (camera) {
    return (
      <Player
        key={camera.id}
        orgId={orgId}
        camera={camera}
        canEdit={owner}
        roomName={rooms.find((r) => r.id.toLowerCase() === camera.roomId)?.name ?? "Unknown room"}
        onBack={() => { setCameraId(null); reload(); }}
        onCameraChange={(c) => setCameras((list) => list?.map((x) => (x.id === c.id ? c : x)) ?? list)}
      />
    );
  }

  const tabs = VIEWS.filter((v) => v !== "billing" || billingTab);
  return (
    <div className={`page${view === "facility" ? " wide" : ""}`}>
      <header className="row" style={{ flexWrap: "wrap", alignItems: "flex-end", marginBottom: 24, gap: 16 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <Brand />
          <h1 className="title" style={{ marginTop: 10 }}>{site?.name ?? "Facility"}</h1>
        </div>
        <select
          className="field"
          value={orgId}
          onChange={(e) => {
            if (e.target.value === "__connect") return setConnecting(true);
            setCameraId(null);
            setOrgId(e.target.value);
          }}
          style={{ width: "auto", minWidth: 200 }}
          aria-label="Site"
        >
          {sites.map((s) => <option key={s.orgId} value={s.orgId}>{s.name}{s.role === "viewer" ? " (view only)" : ""}</option>)}
          <option value="__connect">+ Connect another organization…</option>
        </select>
        {owner && <button className="btn accent" onClick={() => { setView("cameras"); setClaiming(true); }}>+ Add camera</button>}
        <button className="btn ghost" onClick={signOut} title={email ?? undefined}>Sign out</button>
      </header>

      {site && site.keyStatus !== "ok" && (
        <div className="billing-banner alarm" role="status">
          <span style={{ flex: 1, minWidth: 220 }}>
            {site.keyStatus === "rejected"
              ? "Growlink rejected this site's API key, so sensor data and room names can't load."
              : "This site has no Growlink API key, so sensor data and room names can't load."}
            {owner ? " Reconnect it in Settings." : " Ask a site owner to reconnect it."}
          </span>
          {owner && <button className="btn" onClick={() => setView("settings")}>Settings</button>}
        </div>
      )}

      <div role="tablist" className="tabs" style={{ padding: 0, marginBottom: 24 }}>
        {tabs.map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className="tab" onClick={() => setView(v)}>
            {v === "facility" ? "Facility" : v === "cameras" ? `Cameras · ${cameras.length}` : v === "settings" ? "Settings" : "Billing"}
          </button>
        ))}
      </div>

      {view !== "billing" && <BillingBanner billing={billing} onOpen={() => setView("billing")} />}

      {view === "settings" ? (
        <SiteSettings orgId={orgId} onChanged={() => loadSites(orgId)} onLeft={() => { setOrgId(null); loadSites(); setView("facility"); }} />
      ) : billingTab && (view === "billing" || (billing && !billing.entitled)) ? (
        <BillingView orgId={orgId} billing={billing} onRefresh={refreshBilling} />
      ) : view === "facility" || view === "billing" ? (
        <FacilityView
          orgId={orgId}
          rooms={rooms}
          cameras={cameras}
          onOpen={(id) => setCameraId(id)}
          onAddCamera={owner ? () => { setView("cameras"); setClaiming(true); } : undefined}
        />
      ) : (
        <CameraHome
          orgId={orgId}
          rooms={rooms}
          cameras={cameras}
          canEdit={owner}
          claiming={claiming}
          onClaimingChange={setClaiming}
          onCamerasChange={setCameras}
          onOpen={(id) => setCameraId(id)}
        />
      )}
    </div>
  );
}

// Trial ending soon or a failed payment, above every home screen.
function BillingBanner({ billing: b, onOpen }: { billing: Billing | null; onOpen: () => void }) {
  if (!b || !b.configured) return null;
  const live = b.subscription?.status && !["canceled", "incomplete_expired"].includes(b.subscription.status);
  let tone: "warn" | "alarm" | null = null;
  let text = "";
  if (b.state === "past_due") {
    tone = "alarm";
    text = "Your last payment didn't go through. Update your card to keep Plant Health AI running.";
  } else if (b.state === "trial" && !live && (b.daysLeft ?? 99) <= 7) {
    tone = "warn";
    text =
      b.daysLeft === 0
        ? "Your free trial ends today."
        : `Your free trial ends in ${b.daysLeft} day${b.daysLeft === 1 ? "" : "s"}.`;
    text += " Add a payment method to keep going — you won't be charged until it ends.";
  }
  if (!tone) return null;
  return (
    <div className={`billing-banner ${tone}`} role="status">
      <span style={{ flex: 1, minWidth: 220 }}>{text}</span>
      <button className="btn" onClick={onOpen}>Billing</button>
    </div>
  );
}

function SignInGate() {
  return (
    <Centered>
      <div className="card" style={{ width: "min(440px, 100%)", textAlign: "left", padding: 28 }}>
        <Brand />
        <h1 className="title" style={{ marginTop: 14 }}>Sign in</h1>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, margin: "8px 0 22px" }}>
          Plant Health AI uses your Growlink LABS account — the same sign-in as every LABS app. New to LABS? You can
          create an account on the next page.
        </p>
        <button className="btn solid" style={{ width: "100%" }} onClick={goToLabsAccount}>
          Sign in with Growlink LABS
        </button>
      </div>
    </Centered>
  );
}
