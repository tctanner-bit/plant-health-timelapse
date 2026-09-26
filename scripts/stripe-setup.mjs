#!/usr/bin/env node
// One-time Stripe setup for Plant Health AI billing. Safe to re-run: it
// reuses what already exists.
//
//   STRIPE_SECRET_KEY=sk_test_... node scripts/stripe-setup.mjs [--webhook-url https://…/api/stripe/webhook]
//
// Creates, in whichever mode the key belongs to (test first, then live):
//   - product "Plant Health AI" and its $19 / camera / month price, found by
//     the app through lookup key plant_health_camera_monthly
//   - a billing portal configuration of its own (Growlink's account may have
//     other products; its default portal settings are left alone)
//   - the webhook endpoint, printing its signing secret once — put it in
//     Vercel as STRIPE_WEBHOOK_SECRET
//
// Run it in your own terminal. Never paste keys or secrets into chat.

import Stripe from "stripe";

const APP = "plant-health";
const LOOKUP_KEY = "plant_health_camera_monthly";
const UNIT_AMOUNT = 1900; // $19.00
const EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
];

const args = process.argv.slice(2);
const arg = (n) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const webhookUrl = arg("webhook-url") ?? "https://timelapse-web-six.vercel.app/api/stripe/webhook";
const appUrl = new URL(webhookUrl).origin;

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Set STRIPE_SECRET_KEY (start with the sk_test_ key).");
  process.exit(1);
}
const live = key.startsWith("sk_live_") || key.startsWith("rk_live_");
const stripe = new Stripe(key);
console.log(`\nStripe setup for Plant Health AI — ${live ? "LIVE MODE" : "test mode"}\n`);

// 1. Product + price
let price = (await stripe.prices.list({ lookup_keys: [LOOKUP_KEY], active: true, limit: 1, expand: ["data.product"] })).data[0];
if (price && price.unit_amount !== UNIT_AMOUNT) {
  console.log(`Existing price ${price.id} is ${price.unit_amount / 100} — creating a new $${UNIT_AMOUNT / 100} price and moving the lookup key to it.`);
  price = null;
}
if (!price) {
  const existing = (await stripe.products.search({ query: `metadata['app']:'${APP}' AND active:'true'` })).data[0];
  const product =
    existing ??
    (await stripe.products.create({
      name: "Plant Health AI",
      description: "Canopy time-lapse, facility view and Nova AI insights, per camera.",
      unit_label: "camera",
      metadata: { app: APP },
    }));
  price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: UNIT_AMOUNT,
    recurring: { interval: "month", usage_type: "licensed" },
    lookup_key: LOOKUP_KEY,
    transfer_lookup_key: true,
    nickname: "Per camera, monthly",
    metadata: { app: APP },
  });
  console.log(`✓ Price created: ${price.id} ($${UNIT_AMOUNT / 100} / camera / month) on product ${product.id}`);
} else {
  console.log(`✓ Price exists: ${price.id} ($${price.unit_amount / 100} / camera / month)`);
}
const productId = typeof price.product === "string" ? price.product : price.product.id;

// 2. Billing portal configuration (our own, not the account default)
const configs = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
let portal = configs.data.find((c) => c.metadata?.app === APP);
const portalSettings = {
  business_profile: { headline: "Plant Health AI — manage your subscription" },
  default_return_url: `${appUrl}/billing/done?status=portal`,
  features: {
    payment_method_update: { enabled: true },
    invoice_history: { enabled: true },
    customer_update: { enabled: true, allowed_updates: ["email", "address", "name", "tax_id"] },
    subscription_cancel: { enabled: true, mode: "at_period_end", cancellation_reason: { enabled: true, options: ["too_expensive", "unused", "missing_features", "switched_service", "other"] } },
    // Camera count follows the cameras in the app; customers don't edit it here.
    subscription_update: { enabled: false },
  },
  metadata: { app: APP },
};
if (portal) {
  portal = await stripe.billingPortal.configurations.update(portal.id, portalSettings);
  console.log(`✓ Billing portal configuration updated: ${portal.id}`);
} else {
  portal = await stripe.billingPortal.configurations.create(portalSettings);
  console.log(`✓ Billing portal configuration created: ${portal.id}`);
}

// 3. Webhook
const hooks = await stripe.webhookEndpoints.list({ limit: 100 });
const hook = hooks.data.find((h) => h.url === webhookUrl);
if (hook) {
  await stripe.webhookEndpoints.update(hook.id, { enabled_events: EVENTS, disabled: false });
  console.log(`✓ Webhook exists: ${hook.id} → ${webhookUrl} (events updated)`);
  console.log("  Its signing secret is only shown at creation. If Vercel doesn't have it,");
  console.log("  reveal or roll it in the Stripe dashboard → Developers → Webhooks.");
} else {
  const created = await stripe.webhookEndpoints.create({
    url: webhookUrl,
    enabled_events: EVENTS,
    description: "Plant Health AI billing",
    metadata: { app: APP },
  });
  console.log(`✓ Webhook created: ${created.id} → ${webhookUrl}`);
  console.log(`\n  STRIPE_WEBHOOK_SECRET = ${created.secret}\n`);
  console.log("  Add that to Vercel now (it isn't shown again). Don't paste it into chat.");
}

console.log(`
Next, in Vercel → timelapse-web → Settings → Environment Variables (Production):
  STRIPE_SECRET_KEY       the same key you ran this with
  STRIPE_WEBHOOK_SECRET   from above
Then redeploy. Product: ${productId} · Portal: ${portal.id}
`);
