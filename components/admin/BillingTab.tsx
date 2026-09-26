"use client";

import { useCallback, useEffect, useState } from "react";
import { adminFetch } from "../../lib/admin-client";

// Every org's Plant Health AI billing: trial, subscription, camera count.
// Support can make an org complimentary (pilots, partners) or extend its
// no-card trial. Subscriptions themselves are managed in Stripe.

type OrgBilling = {
  orgId: string;
  orgName: string | null;
  entitled: boolean;
  state: "comp" | "trial" | "subscribed" | "past_due" | "expired";
  trialEndsAt: number;
  daysLeft: number | null;
  cameras: number;
  status: string | null;
  quantity: number | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  comp: boolean;
  compNote: string | null;
  stripeCustomerId: string | null;
  createdAt: string;
};

const TONE: Record<OrgBilling["state"], string> = {
  subscribed: "ok",
  comp: "ok",
  trial: "idle",
  past_due: "alarm",
  expired: "alarm",
};
const d = (t: number | string) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });

export default function BillingTab() {
  const [orgs, setOrgs] = useState<OrgBilling[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [linking, setLinking] = useState<OrgBilling | null>(null);

  const load = useCallback(() => {
    adminFetch<{ orgs: OrgBilling[] }>("/api/admin/billing")
      .then((r) => setOrgs(r.orgs))
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const act = async (o: OrgBilling, body: Record<string, unknown>) => {
    setBusy(o.orgId);
    setErr(null);
    try {
      await adminFetch("/api/admin/billing", { method: "POST", body: { orgId: o.orgId, ...body } });
      load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };
  const comp = (o: OrgBilling) => {
    const note = window.prompt(`Make ${o.orgName ?? "this organization"} complimentary. Reason (shown to support):`);
    if (note?.trim()) act(o, { action: "comp", note });
  };
  const extend = (o: OrgBilling) => {
    const days = Number(window.prompt("Extend the no-card trial by how many days? (1–90)", "14"));
    if (Number.isInteger(days) && days > 0) act(o, { action: "extend_trial", days });
  };

  if (!orgs) return err ? <div className="error-text">{err}</div> : <div className="eyebrow">Loading…</div>;
  if (orgs.length === 0) return <div className="card muted">No organizations have used Plant Health AI yet.</div>;

  const paying = orgs.filter((o) => o.state === "subscribed" || o.state === "past_due");
  const mrrCameras = paying.reduce((n, o) => n + (o.quantity ?? 0), 0);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
        <span className="eyebrow" style={{ color: "var(--text)" }}>{orgs.length} organizations</span>
        <span className="small muted">{paying.length} subscribed · {mrrCameras} billed cameras</span>
        <span className="small muted">{orgs.filter((o) => o.state === "trial").length} in trial</span>
        <span className="small muted">{orgs.filter((o) => o.state === "expired").length} expired</span>
      </div>
      {err && <div className="error-text">{err}</div>}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Organization</th><th>State</th><th>Cameras</th><th>Billed</th><th>Trial / renewal</th><th>Stripe</th><th></th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.orgId}>
                <td>
                  <div style={{ fontWeight: 700 }}>{o.orgName ?? "—"}</div>
                  <div className="small muted">{o.orgId}</div>
                  {o.comp && o.compNote && <div className="small muted">Comp: {o.compNote}</div>}
                </td>
                <td>
                  <span className={`status ${TONE[o.state]}`}>
                    {o.state === "past_due" ? "past due" : o.state}
                  </span>
                  {o.cancelAtPeriodEnd && <div className="small" style={{ color: "var(--warn)" }}>cancels at period end</div>}
                </td>
                <td>{o.cameras}</td>
                <td>{o.quantity ?? "—"}</td>
                <td className="small">
                  {o.state === "trial"
                    ? `Trial ends ${d(o.trialEndsAt)} (${o.daysLeft}d)`
                    : o.currentPeriodEnd
                    ? `${o.cancelAtPeriodEnd ? "Ends" : "Renews"} ${d(o.currentPeriodEnd)}`
                    : o.state === "expired"
                    ? `Trial ended ${d(o.trialEndsAt)}`
                    : "—"}
                </td>
                <td className="small">
                  {o.stripeCustomerId && <div className="small muted">{o.stripeCustomerId}</div>}
                  {o.stripeCustomerId ? (
                    <a href={`https://dashboard.stripe.com/customers/${o.stripeCustomerId}`} target="_blank" rel="noopener noreferrer">
                      {o.status ?? "customer"} ↗
                    </a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                <td>
                  <div className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                    {!o.status && !o.comp && (
                      <button className="btn" disabled={busy === o.orgId} onClick={() => extend(o)}>Extend trial</button>
                    )}
                    {!o.status || ["canceled", "incomplete_expired"].includes(o.status) ? (
                      <button className="btn" disabled={busy === o.orgId} onClick={() => setLinking(o)}>
                        {o.stripeCustomerId ? "Change customer" : "Link customer"}
                      </button>
                    ) : null}
                    {o.comp ? (
                      <button className="btn" disabled={busy === o.orgId} onClick={() => act(o, { action: "uncomp" })}>End comp</button>
                    ) : (
                      <button className="btn" disabled={busy === o.orgId} onClick={() => comp(o)}>Make free</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {linking && (
        <LinkCustomer
          org={linking}
          onClose={() => setLinking(null)}
          onLink={async (customerId) => {
            await adminFetch("/api/admin/billing", { method: "POST", body: { orgId: linking.orgId, action: "link_customer", customerId } });
            setLinking(null);
            load();
          }}
          onUnlink={async () => {
            await adminFetch("/api/admin/billing", { method: "POST", body: { orgId: linking.orgId, action: "unlink_customer" } });
            setLinking(null);
            load();
          }}
        />
      )}
      <p className="small" style={{ color: "var(--dim)", lineHeight: 1.5 }}>
        Link each organization to the Stripe customer it already pays Growlink with; it can then subscribe with that
        card in one click, on its own Plant Health AI invoice. Refunds, credits and cancellations are done in the Stripe dashboard; changes show here within seconds.
        A complimentary org with a paid subscription is still billed by Stripe — cancel it there.
      </p>
    </div>
  );
}

type FoundCustomer = {
  id: string;
  name: string | null;
  email: string | null;
  growlinkName: string | null;
  linkedOrg: string | null;
  hasCard: boolean;
  created: number;
};

// Search Growlink's Stripe customers by name, email or cus_ id and link one.
function LinkCustomer({
  org,
  onClose,
  onLink,
  onUnlink,
}: {
  org: OrgBilling;
  onClose: () => void;
  onLink: (customerId: string) => Promise<void>;
  onUnlink: () => Promise<void>;
}) {
  const [q, setQ] = useState(org.orgName ?? "");
  const [found, setFound] = useState<FoundCustomer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const search = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await adminFetch<{ customers: FoundCustomer[] }>(`/api/admin/billing/customers?q=${encodeURIComponent(q)}`);
      setFound(r.customers);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  };
  useEffect(() => {
    if (q.trim().length >= 2) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label="Link Stripe customer" style={{ maxWidth: 640, padding: 22 }}>
        <div className="row" style={{ marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="eyebrow">Link Stripe customer</div>
            <div style={{ fontWeight: 800, fontSize: 18, marginTop: 4 }}>{org.orgName ?? org.orgId}</div>
          </div>
          <button className="btn icon ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <form onSubmit={search} className="row" style={{ gap: 8 }}>
          <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer name, email, or cus_…" autoFocus />
          <button className="btn" disabled={busy || q.trim().length < 2}>Search</button>
        </form>
        {err && <div className="error-text" style={{ marginTop: 10 }}>{err}</div>}
        <div className="stack" style={{ gap: 8, marginTop: 14, maxHeight: 380, overflow: "auto" }}>
          {found?.length === 0 && <div className="muted small">No customers match. Try part of the name, the billing email, or paste the cus_ id.</div>}
          {found?.map((c) => {
            const elsewhere = c.linkedOrg && c.linkedOrg !== org.orgId;
            const current = c.id === org.stripeCustomerId;
            return (
              <div key={c.id} className="row" style={{ gap: 10, padding: "10px 12px", border: "1px solid var(--line)", borderRadius: "var(--radius)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{c.name ?? c.growlinkName ?? "(no name)"}</div>
                  <div className="small muted">
                    {[c.growlinkName && c.growlinkName !== c.name ? c.growlinkName : null, c.email, c.id].filter(Boolean).join(" · ")}
                  </div>
                  <div className="small" style={{ color: c.hasCard ? "var(--ok)" : "var(--muted)" }}>
                    {c.hasCard ? "Card on file" : "No card on file"}
                    {elsewhere && <span style={{ color: "var(--warn)" }}> · linked to another organization</span>}
                  </div>
                </div>
                {current ? (
                  <span className="status ok">Linked</span>
                ) : (
                  <button className="btn" disabled={busy || !!elsewhere} onClick={() => run(() => onLink(c.id))}>Link</button>
                )}
              </div>
            );
          })}
        </div>
        {org.stripeCustomerId && (
          <div className="row" style={{ marginTop: 14, justifyContent: "flex-end" }}>
            <button className="btn ghost" disabled={busy} onClick={() => run(onUnlink)}>Unlink current customer</button>
          </div>
        )}
      </div>
    </div>
  );
}
