import { NextResponse } from "next/server";
import { requireOrg, isResponse } from "../../../../../../lib/server/auth";
import { db } from "../../../../../../lib/server/supabase";
import {
  APP,
  BillingError,
  activeCameraCount,
  cameraPrice,
  getBilling,
  hasLiveSubscription,
  stripe,
} from "../../../../../../lib/server/billing";

export const dynamic = "force-dynamic";

// Stripe requires a subscription trial to end at least 48 hours out.
const MIN_TRIAL_MS = 49 * 3600_000;

// POST → { url } of a Stripe Checkout page for the per-camera subscription.
// Opened in a new tab (Checkout can't run inside the Growlink frame). If the
// org's no-card trial still has time left, the card is saved now and first
// charged when the trial ends.
export async function POST(req: Request, { params }: { params: { orgId: string } }) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;

  try {
    const b = await getBilling(ctx.orgId, ctx.orgName);
    if (hasLiveSubscription(b))
      return NextResponse.json(
        { error: "This organization already has a subscription — use Manage billing", manage: true },
        { status: 409 }
      );

    const s = stripe();
    let customer = b.stripe_customer_id;
    const created = !customer;
    if (!customer) {
      const c = await s.customers.create(
        {
          name: ctx.orgName ?? undefined,
          metadata: { org_id: ctx.orgId, growlink_org_id: ctx.orgId, org_name: ctx.orgName ?? "", app: APP },
        },
        { idempotencyKey: `customer:${APP}:${ctx.orgId}` }
      );
      customer = c.id;
      await db().from("org_billing").update({ stripe_customer_id: customer }).eq("org_id", ctx.orgId).eq("app", APP);
    }

    const price = await cameraPrice();
    const quantity = Math.max(1, await activeCameraCount(ctx.orgId));
    const trialEnd = Date.parse(b.trial_ends_at);
    const origin = new URL(req.url).origin;
    const meta = { org_id: ctx.orgId, org_name: ctx.orgName ?? "", app: APP };

    const session = await s.checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: ctx.orgId,
      line_items: [{ price: price.id, quantity }],
      payment_method_collection: "always",
      allow_promotion_codes: true,
      billing_address_collection: "auto",
      // Only for customers we just made: never overwrite an existing Growlink
      // customer's billing name or address from this checkout.
      ...(created ? { customer_update: { name: "auto" as const, address: "auto" as const } } : {}),
      subscription_data: {
        metadata: meta,
        ...(trialEnd - Date.now() > MIN_TRIAL_MS ? { trial_end: Math.floor(trialEnd / 1000) } : {}),
      },
      metadata: meta,
      success_url: `${origin}/billing/done?status=success`,
      cancel_url: `${origin}/billing/done?status=cancelled`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    if (e instanceof BillingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("billing: checkout failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't start checkout — try again" }, { status: 502 });
  }
}
