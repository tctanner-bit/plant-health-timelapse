"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AdminError, FleetCamera, adminAuth, adminFetch, expectedPerDay, fleetState } from "../../lib/admin-client";
import { ago } from "../../lib/status";
import { Brand, Centered } from "../ui";

// Growlink's camera fleet dashboard: every camera across every customer, with
// the tools support needs on a call. Staff-only (Supabase Auth + fleet_admins).

type Tab = "fleet" | "usage" | "audit" | "admins";

export default function AdminApp() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<string | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("fleet");
  const [pwOpen, setPwOpen] = useState(false);

  useEffect(() => {
    let auth;
    try {
      auth = adminAuth();
    } catch (e: any) {
      setDenied(e.message);
      setSession(null);
      return;
    }
    auth.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = auth.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setMe(null);
    setDenied(null);
    if (!session) return;
    adminFetch<{ email: string }>("/api/admin/me")
      .then((r) => setMe(r.email))
      .catch((e: AdminError) => setDenied(e.message));
  }, [session]);

  const signOut = () => adminAuth().auth.signOut();

  if (session === undefined) return <Centered><span className="eyebrow">Loading…</span></Centered>;
  if (!session) return <SignIn configError={denied} />;
  if (denied)
    return (
      <Centered>
        <div className="card" style={{ maxWidth: 420, textAlign: "left" }}>
          <Brand />
          <h1 className="title" style={{ marginTop: 12, fontSize: 24 }}>No access</h1>
          <p className="muted" style={{ lineHeight: 1.5 }}>{denied}</p>
          <button className="btn" onClick={signOut}>Sign out</button>
        </div>
      </Centered>
    );
  if (!me) return <Centered><span className="eyebrow">Checking access…</span></Centered>;

  return (
    <div className="page wide">
      <header className="row" style={{ flexWrap: "wrap", alignItems: "flex-end", gap: 16, marginBottom: 24 }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <Brand />
          <h1 className="title" style={{ marginTop: 10 }}>Camera fleet</h1>
          <div className="subtitle">Growlink support · {me}</div>
        </div>
        <button className="btn ghost" onClick={() => setPwOpen(true)}>Change password</button>
        <button className="btn ghost" onClick={signOut}>Sign out</button>
      </header>

      <div role="tablist" className="tabs" style={{ padding: 0, marginBottom: 24 }}>
        {(
          [
            ["fleet", "Cameras"],
            ["usage", "Nova usage"],
            ["audit", "Audit log"],
            ["admins", "Admins"],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button key={t} role="tab" aria-selected={tab === t} className="tab" onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "fleet" && <FleetTab />}
      {tab === "usage" && <UsageTab />}
      {tab === "audit" && <AuditTab />}
      {tab === "admins" && <AdminsTab me={me} />}
      {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}
    </div>
  );
}

// -------------------------------------------------------------------- sign in

function SignIn({ configError }: { configError: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(configError);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const { error } = await adminAuth().auth.signInWithPassword({ email: email.trim(), password });
    if (error) setErr(error.message === "Invalid login credentials" ? "Wrong email or password" : error.message);
    setBusy(false);
  };

  return (
    <Centered>
      <form onSubmit={submit} className="card" style={{ width: "min(420px, 100%)", textAlign: "left", padding: 28 }}>
        <Brand />
        <h1 className="title" style={{ marginTop: 14 }}>Fleet sign-in</h1>
        <p className="muted" style={{ fontSize: 14, margin: "8px 0 20px" }}>Growlink staff only.</p>
        <label className="label">
          <span>Email</span>
          <input className="field" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
        </label>
        <label className="label" style={{ marginTop: 12 }}>
          <span>Password</span>
          <input className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <div className="error-text" style={{ marginTop: 10 }}>{err}</div>}
        <button type="submit" className="btn solid" style={{ marginTop: 18, width: "100%" }} disabled={busy || !email || !password}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </Centered>
  );
}

function ChangePassword({ onClose }: { onClose: () => void }) {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await adminAuth().auth.updateUser({ password: pw });
    setMsg(error ? error.message : "Password changed.");
    setBusy(false);
    if (!error) setPw("");
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: "min(420px, 100%)" }} role="dialog" aria-label="Change password">
        <div className="modal-head">
          <h2 className="title" style={{ fontSize: 20, flex: 1 }}>Change password</h2>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <label className="label">
            <span>New password (at least 12 characters)</span>
            <input className="field" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </label>
          {msg && <div className="small" style={{ marginTop: 10 }}>{msg}</div>}
        </div>
        <div className="modal-foot">
          <div style={{ flex: 1 }} />
          <button className="btn ghost" onClick={onClose}>Close</button>
          <button className="btn solid" disabled={busy || pw.length < 12} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- fleet

type Filter = "all" | "attention" | "offline" | "gaps" | "unclaimed" | "revoked";

function FleetTab() {
  const [cams, setCams] = useState<FleetCamera[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("attention");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [lookupErr, setLookupErr] = useState<string | null>(null);

  const load = useCallback(() => {
    adminFetch<{ cameras: FleetCamera[] }>("/api/admin/cameras")
      .then((r) => { setCams(r.cameras); setErr(null); })
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    load();
    const t = window.setInterval(() => document.visibilityState === "visible" && load(), 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const withState = useMemo(() => (cams ?? []).map((c) => ({ c, s: fleetState(c) })), [cams]);
  const count = (f: Filter) => withState.filter(({ s }) => matches(f, s.state)).length;
  const needle = q.trim().toLowerCase();
  const shown = withState
    .filter(({ s }) => matches(filter, s.state))
    .filter(({ c }) =>
      !needle || [c.serial, c.org_name, c.room_name, c.name, c.id, c.org_id].some((v) => (v ?? "").toLowerCase().includes(needle))
    )
    .sort((a, b) => a.s.rank - b.s.rank || (a.c.org_name ?? "~").localeCompare(b.c.org_name ?? "~") || (a.c.room_name ?? "").localeCompare(b.c.room_name ?? ""));

  const looksLikeCode = /^[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}$/.test(q.trim());
  const lookupCode = async () => {
    setLookupErr(null);
    try {
      const r = await adminFetch<{ cameraId: string }>(`/api/admin/lookup?code=${encodeURIComponent(q.trim())}`);
      setOpen(r.cameraId);
    } catch (e: any) {
      setLookupErr(e.message);
    }
  };

  if (err) return <div className="error-text">{err}</div>;
  if (!cams) return <div className="eyebrow">Loading cameras…</div>;

  const FILTERS: [Filter, string][] = [
    ["attention", "Needs attention"],
    ["offline", "Offline"],
    ["gaps", "Missing frames"],
    ["unclaimed", "Unclaimed"],
    ["revoked", "Revoked"],
    ["all", "All"],
  ];

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        {FILTERS.map(([f, label]) => (
          <button key={f} className={`chip${filter === f ? " on" : ""}`} onClick={() => setFilter(f)} aria-pressed={filter === f}>
            {label} · {count(f)}
          </button>
        ))}
        <div className="spacer" />
        <input
          className="field"
          style={{ width: 300 }}
          placeholder="Serial, customer, room, or setup code"
          value={q}
          onChange={(e) => { setQ(e.target.value); setLookupErr(null); }}
          aria-label="Search cameras"
        />
        {looksLikeCode && <button className="btn" onClick={lookupCode}>Find setup code</button>}
      </div>
      {lookupErr && <div className="error-text">{lookupErr}</div>}

      {shown.length === 0 ? (
        <div className="card muted" style={{ textAlign: "center", padding: 40 }}>
          {filter === "attention" && !needle ? "Nothing needs attention right now." : "No cameras match."}
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Customer · Room</th>
                <th>Camera</th>
                <th>Serial</th>
                <th>Last frame</th>
                <th>Frames 24h</th>
                <th>Nova 30d</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(({ c, s }) => {
                const exp = expectedPerDay(c);
                const pct = Math.min(1, Number(c.frames_24h) / exp);
                return (
                  <tr key={c.id} onClick={() => setOpen(c.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(c.id)}>
                    <td><span className={`status ${s.tone}`}>{s.label}</span></td>
                    <td>
                      <div style={{ fontWeight: 700 }}>{c.org_name ?? (c.org_id ? "Unknown org" : "—")}</div>
                      <div className="small muted">{c.room_name ?? ""}</div>
                    </td>
                    <td>{c.name}</td>
                    <td className="mono">{c.serial ?? "—"}</td>
                    <td>{ago(c.last_frame_at)}</td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <div className="meter"><div style={{ width: `${pct * 100}%`, background: pct >= 0.8 ? "var(--ok)" : pct > 0 ? "var(--warn)" : "var(--alarm)" }} /></div>
                        <span className="small">{c.frames_24h}/{exp}</span>
                      </div>
                    </td>
                    <td>{Number(c.nova_insights_30d)} · ${Number(c.nova_cost_30d).toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && <CameraDrawer id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </div>
  );
}

function matches(f: Filter, s: string) {
  if (f === "all") return true;
  if (f === "attention") return s === "offline" || s === "gaps" || s === "waiting";
  return f === s || (f === "offline" && s === "waiting");
}

// -------------------------------------------------------------- camera detail

type Detail = {
  camera: FleetCamera & { ftp_username: string | null; token_hint: string; sensors: string[] };
  hourly: { hour: string; frames: number }[];
  frames: { id: number; ts: number; bytes: number; url: string | null }[];
  insights: { id: string; kind: string; status: string; concern: string | null; headline: string | null; error: string | null; day_label: string | null; cost_usd: string | null; created_at: string }[];
  audit: { id: number; at: string; admin_email: string; action: string; detail: Record<string, unknown> }[];
};

function CameraDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ setupCode?: string; camera?: { host: string; port: number; username: string; password: string } } | null>(null);

  const load = useCallback(() => {
    adminFetch<Detail>(`/api/admin/cameras/${id}`)
      .then((r) => { setD(r); setNotes(r.camera.notes ?? ""); })
      .catch((e) => setErr(e.message));
  }, [id]);
  useEffect(load, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const act = async (action: string, confirmText?: string, extra?: Record<string, unknown>) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(action);
    setErr(null);
    try {
      const r = await adminFetch<{ setupCode?: string; camera?: any }>(`/api/admin/cameras/${id}/actions`, { method: "POST", body: { action, ...extra } });
      if (r.setupCode || r.camera) setResult(r);
      load();
      onChanged();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const c = d?.camera;
  const st = c ? fleetState(c) : null;

  return (
    <>
      <div className="nova-scrim" data-open="true" onClick={onClose} />
      <aside className="nova-panel admin-drawer" data-open="true" aria-label="Camera detail">
        <div className="nova-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">{c?.org_name ?? (c && !c.org_id ? "Unclaimed" : "")}{c?.room_name ? ` · ${c.room_name}` : ""}</div>
            <div style={{ fontWeight: 800, fontSize: 18, marginTop: 4 }}>{c?.name ?? "Camera"}</div>
          </div>
          {st && <span className={`status ${st.tone}`}>{st.label}</span>}
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="nova-scroll">
          {err && <div className="error-text">{err}</div>}
          {!d ? (
            <div className="eyebrow">Loading…</div>
          ) : (
            <>
              <div className="facts">
                <Fact k="Serial" v={c!.serial ?? "—"} mono />
                <Fact k="FTP user" v={c!.ftp_username ?? "—"} mono />
                <Fact k="Password" v={`…${c!.token_hint}`} mono />
                <Fact k="Interval" v={`${Math.round(c!.interval_sec / 60)} min`} />
                <Fact k="Provisioned" v={new Date(c!.provisioned_at).toLocaleDateString()} />
                <Fact k="Claimed" v={c!.claimed_at ? new Date(c!.claimed_at).toLocaleString() : "—"} />
                <Fact k="Last seen" v={ago(c!.last_seen_at)} />
                <Fact k="Last frame" v={ago(c!.last_frame_at)} />
                <Fact k="Frames 24h" v={`${c!.frames_24h} of ${expectedPerDay(c!)}`} />
                <Fact k="Sensors" v={`${c!.sensors?.length ?? 0} chosen`} />
              </div>
              {c!.last_error && (
                <div className="callout warn">
                  <span className="callout-label">Last error</span>
                  <span className="callout-text">{c!.last_error} · {ago(c!.last_error_at)}</span>
                </div>
              )}

              <section>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Uploads · last 7 days (per hour)</div>
                <Uptime hourly={d.hourly} perHour={3600 / c!.interval_sec} since={c!.claimed_at ?? c!.provisioned_at} />
              </section>

              {d.frames.length > 0 && (
                <section>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>Latest frames</div>
                  <div className="thumbs">
                    {d.frames.map((f) => (
                      <a key={f.id} href={f.url ?? undefined} target="_blank" rel="noreferrer" title={new Date(f.ts).toLocaleString()}>
                        {f.url ? <img src={f.url} alt="" loading="lazy" /> : null}
                        <span>{new Date(f.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>
                      </a>
                    ))}
                  </div>
                </section>
              )}

              <section className="card" style={{ padding: 14 }}>
                <div className="eyebrow" style={{ marginBottom: 10 }}>Support actions</div>
                <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
                  {c!.org_id ? (
                    <button className="btn" disabled={!!busy} onClick={() => act("unclaim", "Unclaim this camera? It leaves this customer's account and gets a new setup code. Their past frames stay with them.")}>
                      Unclaim / transfer
                    </button>
                  ) : (
                    <button className="btn" disabled={!!busy} onClick={() => act("new_setup_code", "Issue a new setup code? The old one stops working.")}>
                      New setup code
                    </button>
                  )}
                  {c!.revoked_at ? (
                    <button className="btn accent" disabled={!!busy} onClick={() => act("reactivate", "Reactivate with a new camera password? It must be entered on the camera's FTP page.")}>
                      Reactivate
                    </button>
                  ) : (
                    <>
                      <button className="btn" disabled={!!busy} onClick={() => act("reactivate", "Issue a new camera password? The camera stops uploading until the new one is entered on its FTP page.")}>
                        New camera password
                      </button>
                      <button className="btn danger" disabled={!!busy} onClick={() => act("revoke", "Revoke this camera? Uploads stop immediately.")}>
                        Revoke
                      </button>
                    </>
                  )}
                </div>
                {result?.setupCode && (
                  <div className="secret">
                    <div className="small muted">New setup code — give this to the customer. Shown once.</div>
                    <div className="mono" style={{ fontSize: 22, letterSpacing: 3, marginTop: 6 }}>{result.setupCode}</div>
                  </div>
                )}
                {result?.camera && (
                  <div className="secret">
                    <div className="small muted">Enter on the camera: Surveillance → FTP (FTPS on, PASV). Shown once.</div>
                    <div className="facts" style={{ marginTop: 8 }}>
                      <Fact k="Server" v={result.camera.host} mono />
                      <Fact k="Port" v={String(result.camera.port)} mono />
                      <Fact k="Username" v={result.camera.username} mono />
                      <Fact k="Password" v={result.camera.password} mono />
                    </div>
                  </div>
                )}
              </section>

              <section>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Notes</div>
                <textarea className="field" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Site contact, install details, history…" />
                <button className="btn" style={{ marginTop: 8 }} disabled={!!busy || notes === (c!.notes ?? "")} onClick={() => act("notes", undefined, { notes })}>
                  Save notes
                </button>
              </section>

              <section>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Nova · recent</div>
                {d.insights.length === 0 ? (
                  <div className="small muted">No insights yet.</div>
                ) : (
                  <div className="stack" style={{ gap: 6 }}>
                    {d.insights.map((i) => (
                      <div key={i.id} className="row small" style={{ alignItems: "flex-start", gap: 10 }}>
                        <span className={`status ${i.concern === "action" ? "alarm" : i.concern === "watch" ? "warn" : i.status === "failed" ? "alarm" : "ok"}`} style={{ minWidth: 70 }}>
                          {i.status === "ready" ? i.concern ?? "none" : i.status}
                        </span>
                        <span style={{ flex: 1 }}>{i.headline ?? i.error ?? "—"}</span>
                        <span className="muted" style={{ whiteSpace: "nowrap" }}>
                          {i.kind === "daily" ? i.day_label : "frame"} · {i.cost_usd != null ? `$${Number(i.cost_usd).toFixed(4)}` : "—"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section>
                <div className="eyebrow" style={{ marginBottom: 8 }}>Support history</div>
                {d.audit.length === 0 ? (
                  <div className="small muted">No support actions yet.</div>
                ) : (
                  d.audit.map((a) => (
                    <div key={a.id} className="small" style={{ padding: "4px 0", borderBottom: "1px solid var(--line)" }}>
                      <b>{a.action.replace(/_/g, " ")}</b> · {a.admin_email} · {new Date(a.at).toLocaleString()}
                    </div>
                  ))
                )}
              </section>
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function Fact({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="fact">
      <div className="fact-k">{k}</div>
      <div className={`fact-v${mono ? " mono" : ""}`}>{v}</div>
    </div>
  );
}

// 168 hourly bars: height = frames received vs expected. Hours before the
// camera was claimed/provisioned are left blank rather than shown as outages.
function Uptime({ hourly, perHour, since }: { hourly: { hour: string; frames: number }[]; perHour: number; since: string }) {
  const H = 3600_000;
  const end = Math.floor(Date.now() / H) * H;
  const start = end - 167 * H;
  const byHour = new Map(hourly.map((h) => [Math.floor(Date.parse(h.hour) / H) * H, Number(h.frames)]));
  const sinceMs = Date.parse(since);
  const bars = Array.from({ length: 168 }, (_, i) => {
    const t = start + i * H;
    const n = byHour.get(t) ?? 0;
    const before = t + H < sinceMs;
    return { t, n, ratio: Math.min(1, n / perHour), before };
  });
  const inWindow = bars.filter((b) => !b.before && b.t < end);
  const got = inWindow.reduce((a, b) => a + b.n, 0);
  const exp = Math.max(1, inWindow.length * perHour);
  return (
    <div>
      <div className="uptime" aria-label={`Uptime ${Math.round((got / exp) * 100)}%`}>
        {bars.map((b) => (
          <div
            key={b.t}
            title={`${new Date(b.t).toLocaleString([], { weekday: "short", hour: "numeric" })}: ${b.n} frames`}
            style={{
              height: b.before ? 2 : `${Math.max(6, b.ratio * 100)}%`,
              background: b.before ? "var(--line)" : b.ratio >= 0.8 ? "var(--ok)" : b.ratio > 0 ? "var(--warn)" : "var(--alarm)",
            }}
          />
        ))}
      </div>
      <div className="row small muted" style={{ justifyContent: "space-between", marginTop: 6 }}>
        <span>7 days ago</span>
        <span>{Math.round((got / exp) * 100)}% of expected frames</span>
        <span>now</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- usage

type UsageRow = { day: string; org_id: string | null; org_name: string | null; insights: number; daily_reviews: number; moments: number; failed: number; cost_usd: string };

function UsageTab() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setRows(null);
    adminFetch<{ rows: UsageRow[] }>(`/api/admin/usage?days=${days}`)
      .then((r) => setRows(r.rows))
      .catch((e) => setErr(e.message));
  }, [days]);

  if (err) return <div className="error-text">{err}</div>;
  if (!rows) return <div className="eyebrow">Loading usage…</div>;

  const total = rows.reduce((a, r) => a + Number(r.cost_usd), 0);
  const insights = rows.reduce((a, r) => a + Number(r.insights), 0);
  const failed = rows.reduce((a, r) => a + Number(r.failed), 0);
  const byOrg = new Map<string, { name: string; insights: number; daily: number; moments: number; cost: number }>();
  for (const r of rows) {
    const k = r.org_id ?? "none";
    const o = byOrg.get(k) ?? { name: r.org_name ?? (r.org_id ? "Unknown org" : "Unclaimed"), insights: 0, daily: 0, moments: 0, cost: 0 };
    o.insights += Number(r.insights);
    o.daily += Number(r.daily_reviews);
    o.moments += Number(r.moments);
    o.cost += Number(r.cost_usd);
    byOrg.set(k, o);
  }
  const perDay = new Map<string, number>();
  for (const r of rows) perDay.set(r.day, (perDay.get(r.day) ?? 0) + Number(r.cost_usd));
  const dayList = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 86400_000).toISOString().slice(0, 10);
    return { d, v: perDay.get(d) ?? 0 };
  });
  const maxDay = Math.max(0.0001, ...dayList.map((x) => x.v));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 8 }}>
        {[7, 30, 90].map((n) => (
          <button key={n} className={`chip${days === n ? " on" : ""}`} onClick={() => setDays(n)}>{n} days</button>
        ))}
      </div>
      <div className="metrics">
        <div className="metric"><div className="metric-label">Nova cost</div><div className="metric-value">${total.toFixed(2)}</div><div className="metric-detail">last {days} days</div></div>
        <div className="metric"><div className="metric-label">Insights</div><div className="metric-value">{insights}</div><div className="metric-detail">{failed} failed</div></div>
        <div className="metric"><div className="metric-label">Avg per insight</div><div className="metric-value">${insights ? (total / insights).toFixed(4) : "0"}</div><div className="metric-detail">gpt-4o-mini</div></div>
        <div className="metric"><div className="metric-label">Customers using Nova</div><div className="metric-value">{Array.from(byOrg.keys()).filter((k) => k !== "none").length}</div><div className="metric-detail">&nbsp;</div></div>
      </div>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 10 }}>Cost per day</div>
        <div className="uptime" style={{ height: 80 }}>
          {dayList.map((x) => (
            <div key={x.d} title={`${x.d}: $${x.v.toFixed(4)}`} style={{ height: `${Math.max(2, (x.v / maxDay) * 100)}%`, background: x.v ? "var(--ok)" : "var(--line)" }} />
          ))}
        </div>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Customer</th><th>Insights</th><th>Daily reviews</th><th>Frame questions</th><th>Cost</th></tr></thead>
          <tbody>
            {Array.from(byOrg.values()).sort((a, b) => b.cost - a.cost).map((o) => (
              <tr key={o.name}><td style={{ fontWeight: 700 }}>{o.name}</td><td>{o.insights}</td><td>{o.daily}</td><td>{o.moments}</td><td>${o.cost.toFixed(4)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="small muted">
        From each Nova insight&apos;s recorded cost. The display-fleet AI proxy keeps the full ledger for every product (ai_usage).
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------- audit

function AuditTab() {
  const [entries, setEntries] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    adminFetch<{ entries: any[] }>("/api/admin/audit").then((r) => setEntries(r.entries)).catch((e) => setErr(e.message));
  }, []);
  if (err) return <div className="error-text">{err}</div>;
  if (!entries) return <div className="eyebrow">Loading…</div>;
  if (entries.length === 0) return <div className="card muted">No support actions yet.</div>;
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Camera</th><th>Detail</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.at).toLocaleString()}</td>
              <td>{e.admin_email}</td>
              <td style={{ fontWeight: 700 }}>{String(e.action).replace(/_/g, " ")}</td>
              <td>{e.cameras ? `${e.cameras.serial ?? ""} ${e.cameras.org_name ? "· " + e.cameras.org_name : ""}` : "—"}</td>
              <td className="small muted">{Object.keys(e.detail ?? {}).length ? JSON.stringify(e.detail) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --------------------------------------------------------------------- admins

function AdminsTab({ me }: { me: string }) {
  const [admins, setAdmins] = useState<{ email: string; added_at: string; added_by: string | null }[] | null>(null);
  const [email, setEmail] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const load = () => adminFetch<{ admins: any[] }>("/api/admin/admins").then((r) => setAdmins(r.admins)).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  const add = async () => {
    setMsg(null);
    setTemp(null);
    try {
      const r = await adminFetch<{ email: string; temporaryPassword?: string }>("/api/admin/admins", { method: "POST", body: { email } });
      if (r.temporaryPassword) setTemp({ email: r.email, password: r.temporaryPassword });
      else setMsg(`${r.email} already had an account and can now open the dashboard.`);
      setEmail("");
      load();
    } catch (e: any) {
      setMsg(e.message);
    }
  };
  const remove = async (e: string) => {
    if (!confirm(`Remove ${e} from fleet admins?`)) return;
    try {
      await adminFetch(`/api/admin/admins?email=${encodeURIComponent(e)}`, { method: "DELETE" });
      load();
    } catch (err: any) {
      setMsg(err.message);
    }
  };

  return (
    <div className="stack" style={{ gap: 16, maxWidth: 720 }}>
      <div className="card">
        <div className="eyebrow" style={{ marginBottom: 10 }}>Add a Growlink staff member</div>
        <div className="row">
          <input className="field" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@growlink.com" />
          <button className="btn accent" onClick={add} disabled={!email}>Add</button>
        </div>
        {temp && (
          <div className="secret">
            <div className="small muted">Account created. Send {temp.email} this temporary password privately; they should change it after signing in. Shown once.</div>
            <div className="mono" style={{ fontSize: 18, marginTop: 6 }}>{temp.password}</div>
          </div>
        )}
        {msg && <div className="small" style={{ marginTop: 10 }}>{msg}</div>}
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead><tr><th>Email</th><th>Added</th><th>By</th><th /></tr></thead>
          <tbody>
            {(admins ?? []).map((a) => (
              <tr key={a.email}>
                <td style={{ fontWeight: 700 }}>{a.email}</td>
                <td>{new Date(a.added_at).toLocaleDateString()}</td>
                <td className="muted">{a.added_by ?? "—"}</td>
                <td style={{ textAlign: "right" }}>{a.email !== me && <button className="btn ghost danger" onClick={() => remove(a.email)}>Remove</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
