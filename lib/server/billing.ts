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
  if (!orgId || !isOurs(sub.metadata)) return;
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

// Growlink's Stripe account also bills Growlink's own subscriptions, often on
// the same customers. Only objects tagged with this app are ours to touch.
export const isOurs = (meta: Stripe.Metadata | null | undefined) => meta?.app === APP;

// ------------------------------------------------ existing Growlink customers

export const ORG_META = "growlink_org_id";

export type Card = { brand: string; last4: string; expMonth: number; expYear: number; paymentMethodId: string };

const cardCache = new Map<string, { card: Card | null; at: number }>();
/** The card an existing customer already pays Growlink with, if any (cached 10 min). */
export async function cardOnFile(customerId: string, fresh = false): Promise<Card | null> {
  const hit = cardCache.get(customerId);
  if (!fresh && hit && Date.now() - hit.at < 10 * 60_000) return hit.card;
  const c = await stripe().customers.retrieve(customerId, { expand: ["invoice_settings.default_payment_method"] });
  let pm: Stripe.PaymentMethod | null = null;
  if (!("deleted" in c && c.deleted)) {
    const d = (c as Stripe.Customer).invoice_settings?.default_payment_method;
    if (d && typeof d !== "string" && d.type === "card") pm = d;
    if (!pm) pm = (await stripe().paymentMethods.list({ customer: customerId, type: "card", limit: 1 })).data[0] ?? null;
  }
  const card = pm?.card
    ? { brand: pm.card.brand, last4: pm.card.last4, expMonth: pm.card.exp_month, expYear: pm.card.exp_year, paymentMethodId: pm.id }
    : null;
  cardCache.set(customerId, { card, at: Date.now() });
  return card;
}

/**
 * Point the org at an existing Stripe customer (its Growlink billing record)
 * and tag that customer with the org id, so it's found automatically later.
 * Metadata updates merge: Growlink's own keys on the customer are kept.
 */
export async function linkCustomer(orgId: string, customerId: string): Promise<void> {
  const c = await stripe().customers.retrieve(customerId);
  if ("deleted" in c && c.deleted) throw new BillingError("That Stripe customer was deleted", 404);
  const other = (c as Stripe.Customer).metadata?.[ORG_META];
  if (other && other !== orgId) throw new BillingError("That Stripe customer is already linked to another organization", 409);
  const { error } = await db()
    .from("org_billing")
    .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("app", APP);
  if (error) {
    if (error.code === "23505") throw new BillingError("That Stripe customer is already linked to another organization", 409);
    throw new BillingError("Database error", 500);
  }
  await stripe().customers.update(customerId, { metadata: { [ORG_META]: orgId } });
  cardCache.delete(customerId);
}

const searched = new Map<string, number>();
/**
 * An org with no customer yet: look for a Growlink customer already tagged
 * with its id (by support, or by Growlink's admin system) and link it.
 * Searches at most every 10 minutes per org.
 */
export async function autoLinkCustomer(b: BillingRow): Promise<BillingRow> {
  if (b.stripe_customer_id || !billingConfigured()) return b;
  const last = searched.get(b.org_id) ?? 0;
  if (Date.now() - last < 10 * 60_000) return b;
  searched.set(b.org_id, Date.now());
  try {
    const found = await stripe().customers.search({ query: `metadata['${ORG_META}']:'${b.org_id}'`, limit: 1 });
    const c = found.data[0];
    if (!c) return b;
    await linkCustomer(b.org_id, c.id);
    return { ...b, stripe_customer_id: c.id };
  } catch (e) {
    console.error("billing: customer auto-link failed", b.org_id, e instanceof Error ? e.message : e);
    return b;
  }
}
