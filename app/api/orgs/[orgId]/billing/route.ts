import { NextResponse } from "next/server";
import { requireOrg, isResponse } from "../../../../../lib/server/auth";
import {
  BillingError,
  TRIAL_DAYS,
  access,
  activeCameraCount,
  billingConfigured,
  cameraPrice,
  getBilling,
} from "../../../../../lib/server/billing";

export const dynamic = "force-dynamic";

// GET → the org's plan, trial, subscription and what it will cost.
export async function GET(req: Request, { params }: { params: { orgId: string } }) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;

  const b = await getBilling(ctx.orgId, ctx.orgName).catch(() => null);
  if (!b) return NextResponse.json({ error: "Database error" }, { status: 500 });
  const cameras = await activeCameraCount(ctx.orgId);

  let price: { unitAmount: number; currency: string } | null = null;
  if (billingConfigured()) {
    try {
      const p = await cameraPrice();
      price = { unitAmount: p.unitAmount, currency: p.currency };
    } catch (e) {
      // Missing price or a bad key: show billing as not set up rather than fail.
      if (!(e instanceof BillingError)) console.error("billing: price lookup failed", e instanceof Error ? e.message : e);
    }
  }

  const a = access(b);
  // Without Stripe there's no way to pay, so never show the paywall.
  if (!price) a.entitled = true;
  return NextResponse.json({
    ...a,
    configured: !!price,
    trialDays: TRIAL_DAYS,
    cameras,
    price, // per camera per month, in the currency's minor unit
    subscription: b.stripe_subscription_id
      ? {
          status: b.status,
          quantity: b.quantity,
          currentPeriodEnd: b.current_period_end ? Date.parse(b.current_period_end) : null,
          cancelAtPeriodEnd: b.cancel_at_period_end,
        }
      : null,
    canManage: !!b.stripe_customer_id,
  });
}
