// Billing for Plant Health AI: $19 per active camera per month through
// Stripe, after a 30-day trial that needs no card. Nova is included (free
// during beta).
//
// org_billing is the app's copy of each org's state. The webhook keeps it in
// step with Stripe; everything else reads it, so page loads and entitlement
// checks never wait on Stripe. Cameras upload regardless of billing.

import Stripe from "stripe";
import { NextResponse } from "next/server";
import { db } from "./supabase";

export const APP = "plant-health";
export const TRIAL_DAYS = 30;
export const PRICE_LOOKUP_KEY = process.env.STRIPE_PRICE_LOOKUP_KEY ?? "plant_health_camera_monthly";

// Subscription statuses that keep an org entitled. past_due stays open while
// Stripe retries the card (Smart Retries); after that Stripe moves it to
// unpaid or canceled.
const ENTITLED_STATUSES = new Set(["trialing", "active", "past_due"]);
// A subscription in one of these already exists; send the org to the portal
// instead of a second checkout.
const LIVE_STATUSES = new Set(["trialing", "active", "past_due", "unpaid", "incomplete"]);

let stripeClient: Stripe | null = null;
export function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new BillingError("Billing isn't configured on this server yet", 503);
  if (!stripeClient) stripeClient = new Stripe(key, { appInfo: { name: "Plant Health AI" } });
  return stripeClient;
}

export const billingConfigured = () => !!process.env.STRIPE_SECRET_KEY;

export class BillingError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export type BillingRow = {
  org_id: string;
  app: string;
  org_name: string | null;
  trial_ends_at: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  status: string | null;
  quantity: number | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  comp: boolean;
  comp_note: string | null;
  created_at: string;
  updated_at: string;
};

export type Access = {
  entitled: boolean;
  // What the org is on right now, for the UI.
  state: "comp" | "trial" | "subscribed" | "past_due" | "expired";
  trialEndsAt: number;
  daysLeft: number | null; // trial only
};

export function access(b: BillingRow, now = Date.now()): Access {
  const trialEndsAt = Date.parse(b.trial_ends_at);
  const daysLeft = Math.max(0, Math.ceil((trialEndsAt - now) / 86_400_000));
  if (b.comp) return { entitled: true, state: "comp", trialEndsAt, daysLeft: null };
  if (b.status === "past_due") return { entitled: true, state: "past_due", trialEndsAt, daysLeft: null };
  if (b.status && ENTITLED_STATUSES.has(b.status)) return { entitled: true, state: "subscribed", trialEndsAt, daysLeft: null };
  if (trialEndsAt > now) return { entitled: true, state: "trial", trialEndsAt, daysLeft };
  return { entitled: false, state: "expired", trialEndsAt, daysLeft: 0 };
}

/** The org's billing row, created (starting its trial) on first use. */
export async function getBilling(orgId: string, orgName: string | null): Promise<BillingRow> {
  const { data } = await db().from("org_billing").select("*").eq("org_id", orgId).eq("app", APP).maybeSingle();
  if (data) {
    if (orgName && data.org_name !== orgName) {
      await db().from("org_billing").update({ org_name: orgName }).eq("org_id", orgId).eq("app", APP);
    }
    return data as BillingRow;
  }
  // Concurrent first requests: the loser's insert is ignored, then both read.
  await db()
    .from("org_billing")
    .upsert(
      { org_id: orgId, app: APP, org_name: orgName, trial_ends_at: new Date(Date.now() + TRIAL_DAYS * 86_400_000).toISOString() },
      { onConflict: "org_id,app", ignoreDuplicates: true }
    );
  const again = await db().from("org_billing").select("*").eq("org_id", orgId).eq("app", APP).single();
  if (again.error) throw new BillingError("Database error", 500);
  return again.data as BillingRow;
}

/**
 * Route guard for the paid parts of the app (claiming cameras, viewing
 * frames, Nova). Returns a 402 response when the org's trial has ended with
 * no subscription, else null.
 */
export async function requireEntitled(ctx: { orgId: string; orgName: string | null }): Promise<NextResponse | null> {
  // Until Stripe is set up nobody can pay, so nobody is locked out.
  if (!billingConfigured()) return null;
  let b: BillingRow;
  try {
    b = await getBilling(ctx.orgId, ctx.orgName);
  } catch {
    return null; // never lock customers out over our own database hiccup
  }
  if (access(b).entitled) return null;
  return NextResponse.json(
    { error: "Your Plant Health AI trial has ended. Add a payment method on the Billing tab to keep using it.", billing: "expired" },
    { status: 402 }
  );
}

export async function activeCameraCount(orgId: string): Promise<number> {
  const { count } = await db()
    .from("cameras")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .is("revoked_at", null);
  return count ?? 0;
}

let priceCache: { id: string; unitAmount: number; currency: string; at: number } | null = null;
export async function cameraPrice() {
  if (priceCache && Date.now() - priceCache.at < 10 * 60_000) return priceCache;
  const { data } = await stripe().prices.list({ lookup_keys: [PRICE_LOOKUP_KEY], active: true, limit: 1 });
  const p = data[0];
  if (!p) throw new BillingError(`No active Stripe price with lookup key ${PRICE_LOOKUP_KEY} — run scripts/stripe-setup.mjs`, 503);
  priceCache = { id: p.id, unitAmount: p.unit_amount ?? 0, currency: p.currency, at: Date.now() };
  return priceCache;
}

/** Copy a Stripe subscription onto its org's row. Used by the webhook. */
export async function saveSubscription(sub: Stripe.Subscription) {
  const orgId = sub.metadata?.org_id;
  if (!orgId) return;
  const item = sub.items.data[0];
  // Since API 2025-03-31 the billing period lives on the item.
  const periodEnd = (item as any)?.current_period_end ?? (sub as any).current_period_end ?? null;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const row = {
    stripe_customer_id: customer,
    stripe_subscription_id: sub.id,
    status: sub.status,
    quantity: item?.quantity ?? null,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  };
  const { data } = await db().from("org_billing").update(row).eq("org_id", orgId).eq("app", APP).select("org_id");
  if (!data?.length) {
    await db().from("org_billing").insert({
      org_id: orgId,
      app: APP,
      org_name: sub.metadata?.org_name ?? null,
      trial_ends_at: new Date().toISOString(),
      ...row,
    });
  }
}

/**
 * Make the subscription's camera count match the org's active cameras.
 * Called after claims and revokes; changes mid-period are prorated onto the
 * next invoice. No subscription yet (trial) → nothing to do.
 */
export async function syncQuantity(orgId: string): Promise<void> {
  if (!billingConfigured()) return;
  try {
    const { data: b } = await db()
      .from("org_billing")
      .select("stripe_subscription_id, status")
      .eq("org_id", orgId)
      .eq("app", APP)
      .maybeSingle();
    if (!b?.stripe_subscription_id || !b.status || !LIVE_STATUSES.has(b.status)) return;
    const count = await activeCameraCount(orgId);
    const sub = await stripe().subscriptions.retrieve(b.stripe_subscription_id);
    const item = sub.items.data[0];
    if (!item || item.quantity === count) return;
    const updated = await stripe().subscriptions.update(sub.id, {
      items: [{ id: item.id, quantity: count }],
      proration_behavior: "create_prorations",
    });
    await saveSubscription(updated);
  } catch (e) {
    // The camera change itself succeeded; the webhook and the next change
    // will reconcile. Log for support.
    console.error("billing: quantity sync failed", orgId, e instanceof Error ? e.message : e);
  }
}

export const hasLiveSubscription = (b: BillingRow) => !!b.stripe_subscription_id && !!b.status && LIVE_STATUSES.has(b.status);
