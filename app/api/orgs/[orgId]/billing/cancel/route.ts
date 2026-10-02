import { NextResponse } from "next/server";
import { requireOrg, requireOwner, isResponse } from "../../../../../../lib/server/auth";
import { BillingError, getBilling, hasLiveSubscription, isOurs, saveSubscription, stripe } from "../../../../../../lib/server/billing";

export const dynamic = "force-dynamic";

// POST { resume?: boolean } → { ok }
// Cancels the Plant Health AI subscription at the end of the period (or
// undoes that). Done here rather than in Stripe's portal, because the portal
// would also offer to cancel the customer's other Growlink subscriptions.
export async function POST(req: Request, { params }: { params: { orgId: string } }) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;
  const notOwner = requireOwner(ctx);
  if (notOwner) return notOwner;
  const body = await req.json().catch(() => ({}));
  try {
    const b = await getBilling(ctx.orgId, ctx.orgName);
    if (!hasLiveSubscription(b) || !b.stripe_subscription_id)
      return NextResponse.json({ error: "No active subscription" }, { status: 409 });
    const current = await stripe().subscriptions.retrieve(b.stripe_subscription_id);
    if (!isOurs(current.metadata) || current.metadata.org_id !== ctx.orgId)
      return NextResponse.json({ error: "No active subscription" }, { status: 409 });
    const sub = await stripe().subscriptions.update(current.id, { cancel_at_period_end: !body.resume });
    await saveSubscription(sub);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof BillingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("billing: cancel failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't update the subscription — try again" }, { status: 502 });
  }
}
