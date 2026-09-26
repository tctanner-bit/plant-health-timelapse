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
      <p className="small" style={{ color: "var(--dim)", lineHeight: 1.5 }}>
        Refunds, credits and cancellations are done in the Stripe dashboard; changes show here within seconds.
        A complimentary org with a paid subscription is still billed by Stripe — cancel it there.
      </p>
    </div>
  );
}
