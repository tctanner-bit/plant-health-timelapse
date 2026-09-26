import { NextResponse } from "next/server";
import Stripe from "stripe";
import { isAdminResponse, requireAdmin } from "../../../../../lib/server/admin";
import { ORG_META, billingConfigured, stripe } from "../../../../../lib/server/billing";

export const dynamic = "force-dynamic";

// GET ?q=<name, email, or cus_ id> → { customers: [...] }
// Finds existing Growlink customers in Stripe so support can link an org to
// the record (and card) it already pays Growlink with. Growlink's admin
// system names customers in metadata "Growlink-Customer-Name".
export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (isAdminResponse(ctx)) return ctx;
  if (!billingConfigured()) return NextResponse.json({ error: "Stripe isn't configured" }, { status: 503 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  if (q.length < 2) return NextResponse.json({ customers: [] });

  try {
    let found: Stripe.Customer[];
    if (/^cus_[A-Za-z0-9]+$/.test(q)) {
      const c = await stripe().customers.retrieve(q);
      found = "deleted" in c && c.deleted ? [] : [c as Stripe.Customer];
    } else {
      const v = q.replace(/["'\\]/g, "");
      const query = [`name~"${v}"`, `email~"${v}"`, `metadata['Growlink-Customer-Name']:'${v}'`].join(" OR ");
      found = (await stripe().customers.search({ query, limit: 20 })).data;
    }
    return NextResponse.json({
      customers: found.map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        growlinkName: c.metadata?.["Growlink-Customer-Name"] ?? null,
        linkedOrg: c.metadata?.[ORG_META] ?? null,
        hasCard: !!c.invoice_settings?.default_payment_method || !!c.default_source,
        created: c.created * 1000,
      })),
    });
  } catch (e) {
    console.error("admin: customer search failed", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Stripe search failed" }, { status: 502 });
  }
}
