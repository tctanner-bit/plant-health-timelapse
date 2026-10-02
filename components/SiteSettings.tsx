"use client";

import { useCallback, useEffect, useState } from "react";
import { SiteSettings as Settings, getSite, siteAction } from "../lib/api";

// Settings for a site: who has access, the Growlink API key it runs on, and
// Nova background monitoring. Owners change things; viewers can see them and
// leave the site.
export default function SiteSettings({
  orgId,
  onChanged,
  onLeft,
}: {
  orgId: string;
  onChanged: () => void;
  onLeft: () => void;
}) {
  const [s, setS] = useState<Settings | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"viewer" | "owner">("viewer");
  const [newKey, setNewKey] = useState("");

  const load = useCallback(() => {
    getSite(orgId).then(setS).catch((e) => setErr(e.message));
  }, [orgId]);
  useEffect(load, [load]);

  const act = async (body: Record<string, unknown>, after?: () => void) => {
    setBusy(true);
    setErr(null);
    try {
      await siteAction(orgId, body);
      after?.();
      load();
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!s) return err ? <div className="error-text">{err}</div> : <div className="muted">Loading settings…</div>;
  const owner = s.role === "owner";
  const keyLabel =
    s.key.status === "ok" ? `Connected (…${s.key.hint})` : s.key.status === "rejected" ? "Rejected by Growlink" : "Not connected";

  return (
    <div className="stack" style={{ gap: 18, maxWidth: 760 }}>
      {err && <div className="error-text">{err}</div>}

      <section className="card" style={{ padding: 22 }}>
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="eyebrow">Growlink API key</div>
            <div style={{ fontWeight: 700, marginTop: 6 }}>{keyLabel}</div>
            <p className="small muted" style={{ margin: "6px 0 0", lineHeight: 1.5 }}>
              Used on the server to read this organization&apos;s rooms and sensors, and by Nova in the background.
              It&apos;s stored encrypted and never sent to anyone&apos;s browser.
              {s.key.status === "rejected" && " Growlink stopped accepting it — paste a current org-admin key."}
            </p>
          </div>
          <span className={`status ${s.key.status === "ok" ? "ok" : "alarm"}`}>{s.key.status === "ok" ? "OK" : "Needs attention"}</span>
        </div>
        {owner && (
          <form
            className="row"
            style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}
            onSubmit={(e) => {
              e.preventDefault();
              act({ action: "set_key", apiKey: newKey.trim() }, () => setNewKey(""));
            }}
          >
            <input
              className="field"
              type="password"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder={s.key.status === "ok" ? "Replace with a new key" : "Paste an org-admin API key"}
              autoComplete="off"
              style={{ flex: 1, minWidth: 220 }}
            />
            <button className="btn" disabled={busy || newKey.trim().length < 10}>{s.key.status === "ok" ? "Replace" : "Connect"}</button>
          </form>
        )}
      </section>

      <section className="card" style={{ padding: 22 }}>
        <div className="row" style={{ gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="row" style={{ gap: 10 }}>
              <span className="eyebrow" style={{ color: "var(--text)" }}>Nova background monitoring</span>
              <span className={`status ${s.monitoring.enabled ? "ok" : "idle"}`}>{s.monitoring.enabled ? "On" : "Off"}</span>
            </div>
            <p className="small muted" style={{ margin: "8px 0 0", lineHeight: 1.5 }}>
              {s.monitoring.enabled
                ? `Every 5 minutes Nova checks each room's newest picture and sensors for lights out of schedule, sudden changes and readings out of range, and reviews what it finds (up to ${s.monitoring.alertsPerDay} alerts per camera a day), plus a review of each day.`
                : "Nova only looks when someone asks."}
            </p>
          </div>
          {owner && (
            <button
              className={`btn${s.monitoring.enabled ? " ghost" : " accent"}`}
              disabled={busy}
              onClick={() => act({ action: "monitoring", enabled: !s.monitoring.enabled })}
            >
              {s.monitoring.enabled ? "Turn off" : "Turn on"}
            </button>
          )}
        </div>
      </section>

      <section className="card" style={{ padding: 22 }}>
        <div className="eyebrow">People with access</div>
        <div className="stack" style={{ gap: 6, marginTop: 12 }}>
          {s.members.map((m) => (
            <div key={m.userId} className="row" style={{ gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                {m.email ?? "LABS user"} {m.userId === s.me && <span className="small muted">(you)</span>}
              </div>
              {owner && m.userId !== s.me ? (
                <>
                  <select
                    className="field"
                    value={m.role}
                    disabled={busy}
                    onChange={(e) => act({ action: "set_role", userId: m.userId, role: e.target.value })}
                    style={{ width: "auto" }}
                    aria-label={`Role for ${m.email ?? "member"}`}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="owner">Owner</option>
                  </select>
                  <button
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => window.confirm(`Remove ${m.email ?? "this person"} from this site?`) && act({ action: "remove", userId: m.userId })}
                  >
                    Remove
                  </button>
                </>
              ) : (
                <span className="small muted" style={{ textTransform: "capitalize" }}>{m.role}</span>
              )}
            </div>
          ))}
          {s.invites.map((i) => (
            <div key={i.id} className="row" style={{ gap: 10, padding: "8px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                {i.email} <span className="small muted">· invited as {i.role}, joins on their next LABS sign-in</span>
              </div>
              <button className="btn ghost" disabled={busy} onClick={() => act({ action: "cancel_invite", id: i.id })}>Cancel</button>
            </div>
          ))}
        </div>

        {owner && (
          <form
            className="row"
            style={{ gap: 8, marginTop: 16, flexWrap: "wrap" }}
            onSubmit={(e) => {
              e.preventDefault();
              act({ action: "invite", email, role }, () => setEmail(""));
            }}
          >
            <input
              className="field"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              style={{ flex: 1, minWidth: 220 }}
            />
            <select className="field" value={role} onChange={(e) => setRole(e.target.value as "viewer" | "owner")} style={{ width: "auto" }} aria-label="Role">
              <option value="viewer">Viewer</option>
              <option value="owner">Owner</option>
            </select>
            <button className="btn accent" disabled={busy || !email.trim()}>Invite</button>
          </form>
        )}
        <p className="small muted" style={{ margin: "12px 0 0", lineHeight: 1.5 }}>
          Invited people sign in to Growlink LABS with that email (or create a LABS account with it) and the site
          appears for them. Viewers see cameras, readings and Nova; owners can also add cameras, change settings and
          invite people. Send them the link: labs.growlink.io/plant-health/
        </p>
      </section>

      <div>
        <button
          className="btn ghost"
          disabled={busy}
          onClick={() => window.confirm("Leave this site? You'll lose access until someone invites you again.") && act({ action: "leave" }, onLeft)}
        >
          Leave this site
        </button>
      </div>
    </div>
  );
}
