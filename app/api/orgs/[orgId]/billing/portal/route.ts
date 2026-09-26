import { NextResponse } from "next/server";
import { requireOrg, isResponse } from "../../../../../../lib/server/auth";
import { BillingError, getBilling, stripe } from "../../../../../../lib/server/billing";

export const dynamic = "force-dynamic";

// Our own portal settings (made by scripts/stripe-setup.mjs), not the
// account default, which other Growlink products may rely on.
let cachedConfig: { id: string | null; at: number } | null = null;
async function portalConfiguration(): Promise<string | null> {
  if (cachedConfig && Date.now() - cachedConfig.at < 10 * 60_000) return cachedConfig.id;
  const list = await stripe().billingPortal.configurations.list({ active: true, limit: 100 });
  const id = list.data.find((c) => c.metadata?.app === "plant-health")?.id ?? null;
  cachedConfig = { id, at: Date.now() };
  return id;
}

// POST → { url } of Stripe's billing portal: card, invoices, cancel.
export async function POST(req: Request, { params }: { params: { orgId: string } }) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;
  try {
    const b = await getBilling(ctx.orgId, ctx.orgName);
    if (!b.stripe_customer_id)
      return NextResponse.json({ error: "No billing account yet — add a payment method first" }, { status: 409 });
    const configuration = await portalConfiguration();
    const session = await stripe().billingPortal.sessions.create({
      customer: b.stripe_customer_id,
      ...(configuration ? { configuration } : {}),
      return_url: `${new URL(req.url).origin}/billing/done?status=portal`,
    });
    return NextResponse.json({ url: session.url });
  } catch (e) {
    if (e instanceof BillingError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("billing: portal failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Couldn't open billing — try again" }, { status: 502 });
  }
}
