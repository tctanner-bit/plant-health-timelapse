"use client";

import { useState } from "react";
import { Billing, openBillingPortal, setCancelAtPeriodEnd, startCheckout, subscribeWithCardOnFile } from "../lib/api";

// Plan, trial and subscription for the org. Checkout and the billing portal
// are Stripe-hosted and open in a new tab (they can't run inside the Growlink
// frame); this screen refreshes when the person comes back to it.

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat([], { style: "currency", currency: currency.toUpperCase(), minimumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
const date = (t: number) => new Date(t).toLocaleDateString([], { month: "long", day: "numeric", year: "numeric" });

const STATE_LABEL: Record<Billing["state"], [string, "ok" | "warn" | "alarm" | "idle"]> = {
  trial: ["Free trial", "ok"],
  subscribed: ["Active", "ok"],
  past_due: ["Payment failed", "alarm"],
  expired: ["Trial ended", "alarm"],
  comp: ["Complimentary", "ok"],
};

export default function BillingView({
  orgId,
  billing,
  onRefresh,
}: {
  orgId: string;
  billing: Billing | null;
  onRefresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [link, setLink] = useState<string | null>(null); // when the frame blocks new tabs

  if (!billing) return <div className="muted" style={{ padding: 32, textAlign: "center" }}>Loading billing…</div>;
  const b = billing;
  const [label, tone] = STATE_LABEL[b.state];
  const unit = b.price ? money(b.price.unitAmount, b.price.currency) : "$19";
  const qty = b.subscription?.quantity ?? b.cameras;
  const monthly = b.price ? money(b.price.unitAmount * qty, b.price.currency) : null;
  const sub = b.subscription;
  const live = sub && sub.status && !["canceled", "incomplete_expired"].includes(sub.status);

  // Open the tab synchronously (popup blockers), then point it at Stripe.
  const go = async (fn: () => Promise<string>) => {
    setBusy(true);
    setErr(null);
    const tab = window.open("", "_blank");
    try {
      const url = await fn();
      // Stripe won't load inside a frame, so never navigate this one. If the
      // host frame blocked the new tab, offer a link to click instead.
      if (tab) tab.location.href = url;
      else setLink(url);
      setOpened(true);
    } catch (e: any) {
      tab?.close();
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const checkout = () => go(() => startCheckout(orgId));
  const portal = () => go(() => openBillingPortal(orgId));
  // Actions that finish here, without Stripe's pages.
  const inPlace = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onRefresh();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const card = b.card;
  const cardLabel = card ? `${card.brand.charAt(0).toUpperCase() + card.brand.slice(1)} •••• ${card.last4}` : "";
  const subscribeOnFile = () => {
    const when = b.state === "trial" && b.daysLeft ? `on ${date(b.trialEndsAt)}` : "today";
    if (window.confirm(`Subscribe to Plant Health AI for ${qty} camera${qty === 1 ? "" : "s"} (${monthly ?? unit + " each"}/month) using ${cardLabel}? First charge ${when}.`))
      inPlace(() => subscribeWithCardOnFile(orgId));
  };
  const cancel = () => {
    if (window.confirm("Cancel Plant Health AI at the end of this billing period? Your cameras keep recording; viewing and Nova stop when it ends."))
      inPlace(() => setCancelAtPeriodEnd(orgId, true));
  };
  const resume = () => inPlace(() => setCancelAtPeriodEnd(orgId, false));

  return (
    <div className="stack" style={{ gap: 18, maxWidth: 720 }}>
      {!b.entitled && (
        <div className="card billing-alert" role="alert">
          <strong>Your free trial has ended.</strong> Add a payment method to keep viewing your rooms and using Nova.
          Your cameras are still recording — nothing has been lost.
        </div>
      )}

      <div className="card" style={{ padding: 24 }}>
        <div className="row" style={{ alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div className="eyebrow">Plan</div>
            <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>Plant Health AI</div>
            <div className="muted" style={{ marginTop: 4 }}>{unit} per camera per month</div>
          </div>
          <span className={`status ${tone}`}>{label}</span>
        </div>

        <div className="billing-grid">
          <div>
            <div className="eyebrow">Cameras</div>
            <div className="billing-num">{qty}</div>
          </div>
          <div>
            <div className="eyebrow">Monthly total</div>
            <div className="billing-num">{b.state === "comp" ? "—" : monthly ?? "—"}</div>
          </div>
          <div>
            <div className="eyebrow">
              {b.state === "trial" ? "Trial ends" : sub?.cancelAtPeriodEnd ? "Ends" : live && sub?.status === "trialing" ? "First charge" : "Renews"}
            </div>
            <div className="billing-num" style={{ fontSize: 18 }}>
              {b.state === "comp"
                ? "—"
                : b.state === "trial" && !live
                ? date(b.trialEndsAt)
                : sub?.currentPeriodEnd
                ? date(sub.currentPeriodEnd)
                : "—"}
            </div>
          </div>
        </div>

        <ul className="billing-points">
          <li>Time-lapse, facility view and sensor overlays for every camera</li>
          <li>
            Nova AI insights: unlimited <span className="beta-chip">Free during beta</span>
          </li>
          <li>The camera count updates on its own as you add or remove cameras; changes are prorated</li>
          <li>Camera hardware is billed separately</li>
        </ul>

        {b.state === "trial" && !live && (
          <p className="small muted" style={{ lineHeight: 1.5 }}>
            {b.daysLeft === 0 ? "Your trial ends today." : `${b.daysLeft} day${b.daysLeft === 1 ? "" : "s"} left in your ${b.trialDays}-day trial.`}{" "}
            {card
              ? <>Subscribe with the card Growlink already has on file and you won&apos;t be charged until the trial ends.</>
              : <>Add a payment method now and you won&apos;t be charged until the trial ends.</>}
          </p>
        )}
        {b.state === "past_due" && (
          <p className="small" style={{ color: "var(--alarm)", lineHeight: 1.5 }}>
            Your last payment didn&apos;t go through. Update your card to keep your subscription active.
          </p>
        )}
        {sub?.cancelAtPeriodEnd && sub.currentPeriodEnd && (
          <p className="small" style={{ color: "var(--warn)", lineHeight: 1.5 }}>
            Your subscription is set to end on {date(sub.currentPeriodEnd)}.
          </p>
        )}
        {b.state === "comp" && (
          <p className="small muted">Growlink has made this organization complimentary. No payment method is needed.</p>
        )}

        <div className="row" style={{ gap: 10, marginTop: 18, flexWrap: "wrap" }}>
          {!b.configured ? (
            <span className="small muted">Online billing isn&apos;t set up yet. Contact Growlink to subscribe.</span>
          ) : (
            <>
              {!live && b.state !== "comp" && card && (
                <button className="btn accent" disabled={busy} onClick={subscribeOnFile}>
                  {busy ? "Working…" : `Subscribe with ${cardLabel}`}
                </button>
              )}
              {!live && b.state !== "comp" && (
                <button className={`btn${card ? "" : " accent"}`} disabled={busy} onClick={checkout}>
                  {busy && !card ? "Opening…" : card ? "Use a different card" : b.entitled ? "Add payment method" : "Subscribe"}
                </button>
              )}
              {b.canManage && (
                <button className="btn" disabled={busy} onClick={portal}>
                  Cards &amp; invoices
                </button>
              )}
              {live && !sub?.cancelAtPeriodEnd && (
                <button className="btn ghost" disabled={busy} onClick={cancel}>Cancel subscription</button>
              )}
              {live && sub?.cancelAtPeriodEnd && (
                <button className="btn accent" disabled={busy} onClick={resume}>Keep my subscription</button>
              )}
            </>
          )}
          {opened && (
            <button className="btn ghost" onClick={onRefresh}>I&apos;m done — refresh</button>
          )}
        </div>
        {link && (
          <p style={{ marginTop: 12 }}>
            <a className="btn accent" href={link} target="_blank" rel="noopener noreferrer" onClick={() => setLink(null)}>
              Continue to Stripe ↗
            </a>
          </p>
        )}
        {opened && !link && (
          <p className="small muted" style={{ marginTop: 10 }}>
            Stripe opened in a new tab. Finish there, then come back — this page updates automatically.
          </p>
        )}
        {err && <div className="error-text" style={{ marginTop: 10 }}>{err}</div>}
      </div>

      <p className="small" style={{ color: "var(--dim)", lineHeight: 1.5 }}>
        Payments are processed by Stripe. Card details never reach Growlink.
      </p>
    </div>
  );
}
