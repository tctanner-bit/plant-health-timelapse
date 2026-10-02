"use client";

import { useState } from "react";
import { connectSite } from "../lib/api";
import { Brand, Centered } from "./ui";

// First step after signing in to LABS: connect a Growlink organization with an
// org-admin API key. The key is checked with Growlink, kept in the server's
// vault for this site, and never shown again. Teammates are invited later
// from Settings and never need the key.
export default function ConnectSite({
  email,
  onConnected,
  onCancel,
  onSignOut,
}: {
  email: string | null;
  onConnected: (orgId: string) => void;
  onCancel?: () => void;
  onSignOut: () => void;
}) {
  const [key, setKey] = useState("");
  const [choose, setChoose] = useState<{ id: string; name: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const connect = async (orgId?: string) => {
    setBusy(true);
    setErr(null);
    try {
      const r = await connectSite(key.trim(), orgId);
      if (r.choose) setChoose(r.choose);
      else if (r.site) onConnected(r.site.orgId);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Centered>
      <div className="card" style={{ width: "min(480px, 100%)", textAlign: "left", padding: 28 }}>
        <Brand />
        <h1 className="title" style={{ marginTop: 14 }}>Connect your Growlink organization</h1>
        <p className="muted" style={{ fontSize: 14, lineHeight: 1.5, margin: "8px 0 18px" }}>
          Paste an org-admin API key from the Growlink portal (Builder → Authentication). Plant Health AI uses it on
          the server to read your rooms and sensors — it&apos;s stored encrypted and never shown in the browser
          again. Teammates you invite later don&apos;t need it.
        </p>
        <p className="small muted" style={{ margin: "0 0 18px" }}>
          Waiting for an invitation instead? Ask a site owner to invite {email ?? "your LABS email"}, then reload.
        </p>

        {!choose ? (
          <form onSubmit={(e) => { e.preventDefault(); if (key.trim()) connect(); }}>
            <label className="label">
              <span>Growlink API key</span>
              <input
                className="field"
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Paste the key"
                autoComplete="off"
                autoFocus
              />
            </label>
            <button type="submit" className="btn solid" disabled={busy || !key.trim()} style={{ marginTop: 16, width: "100%" }}>
              {busy ? "Checking with Growlink…" : "Connect"}
            </button>
          </form>
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <div className="eyebrow">This key can see several organizations — pick one</div>
            {choose.map((o) => (
              <button key={o.id} className="btn" disabled={busy} onClick={() => connect(o.id)} style={{ justifyContent: "flex-start" }}>
                {o.name}
              </button>
            ))}
          </div>
        )}

        {err && <div className="error-text" style={{ marginTop: 12 }}>{err}</div>}
        <div className="row" style={{ marginTop: 20, gap: 10, justifyContent: "flex-end" }}>
          {onCancel && <button className="btn ghost" onClick={onCancel}>Cancel</button>}
          <button className="btn ghost" onClick={onSignOut} title={email ?? undefined}>Sign out</button>
        </div>
      </div>
    </Centered>
  );
}
