import { NextResponse } from "next/server";
import { requireOrg, requireOwner, isResponse } from "../../../../../../lib/server/auth";
import {
  APP,
  BillingError,
  activeCameraCount,
  cameraPrice,
  cardOnFile,
  getBilling,
  hasLiveSubscription,
  saveSubscription,
  stripe,
} from "../../../../../../lib/server/billing";

export const dynamic = "force-dynamic";

// Stripe requires a subscription trial to end at least 48 hours out.
const MIN_TRIAL_MS = 49 * 3600_000;

// POST → { ok } subscribes the org using the card already on its Growlink
// Stripe customer — no Checkout page. Its own subscription (and invoice),
// separate from the org's Growlink plan; the rest of the trial carries over.
export async function POST(req: Request, { params }: { params: { orgId: string } }) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;
  const notOwner = requireOwner(ctx);
  if (notOwner) return notOwner;

  try {
    const b = await getBilling(ctx.orgId, ctx.orgName);
    if (hasLiveSubscription(b))
      return NextResponse.json({ error: "This organization is already subscribed" }, { status: 409 });
    if (!b.stripe_customer_id)
      return NextResponse.json({ error: "No card on file — add a payment method instead" }, { status: 409 });
    const card = await cardOnFile(b.stripe_customer_id, true);
    if (!card) return NextResponse.json({ error: "No card on file — add a payment method instead" }, { status: 409 });

    const price = await cameraPrice();
    const quantity = Math.max(1, await activeCameraCount(ctx.orgId));
    const trialEnd = Date.parse(b.trial_ends_at);
    const sub = await stripe().subscriptions.create(
      {
        customer: b.stripe_customer_id,
        items: [{ price: price.id, quantity }],
        default_payment_method: card.paymentMethodId,
        // No trial left: charge now, and fail here (not later) if the card declines.
        payment_behavior: "error_if_incomplete",
        ...(trialEnd - Date.now() > MIN_TRIAL_MS ? { trial_end: Math.floor(trialEnd / 1000) } : {}),
        metadata: { org_id: ctx.orgId, org_name: ctx.orgName ?? "", app: APP },
      },
      // One attempt per org per hour, whatever the double-clicks.
      { idempotencyKey: `subscribe:${APP}:${ctx.orgId}:${Math.floor(Date.now() / 3600_000)}` }
    );
    await saveSubscription(sub);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    if (e instanceof BillingError) return NextResponse.json({ error: e.message }, { status: e.status });
    if (e?.type === "StripeCardError")
      return NextResponse.json({ error: `The card on file was declined: ${e.message}. Add a different payment method.` }, { status: 402 });
    console.error("billing: subscribe failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't start the subscription — try again" }, { status: 502 });
  }
}
