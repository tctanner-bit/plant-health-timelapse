import Stripe from "stripe";
import { NextResponse } from "next/server";
import { db } from "../../../../lib/server/supabase";
import { isOurs, saveSubscription, stripe, syncQuantity } from "../../../../lib/server/billing";

export const dynamic = "force-dynamic";

// Stripe → us. Verifies the signature, then re-reads the subscription from
// Stripe rather than trusting event order, and copies it onto the org's row.
//
// Growlink's account sends events for Growlink's own subscriptions too
// (often on the same customers); anything not tagged app=plant-health is
// acknowledged and ignored.

function ourSubscriptionId(event: Stripe.Event): string | null {
  const o = event.data.object as any;
  switch (event.type) {
    case "checkout.session.completed":
      if (o.mode !== "subscription" || !o.subscription || !isOurs(o.metadata)) return null;
      return typeof o.subscription === "string" ? o.subscription : o.subscription.id;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      return isOurs(o.metadata) ? o.id : null;
    case "invoice.paid":
    case "invoice.payment_failed": {
      // Since API 2025-03-31 the subscription (and its metadata) is under invoice.parent.
      const d = o.parent?.subscription_details;
      if (!d || !isOurs(d.metadata)) return null;
      return typeof d.subscription === "string" ? d.subscription : d.subscription?.id ?? null;
    }
  }
  return null;
}

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  const subId = ourSubscriptionId(event);
  if (!subId) return NextResponse.json({ received: true, ignored: true });

  // Seen before? Acknowledge without redoing the work.
  const { error: dup } = await db().from("stripe_events").insert({ id: event.id, type: event.type });
  if (dup) {
    if (dup.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    return NextResponse.json({ error: "Database error" }, { status: 500 }); // Stripe retries
  }

  try {
    const sub = await stripe().subscriptions.retrieve(subId);
    await saveSubscription(sub);
    // Cameras may have changed between opening checkout and paying.
    if (event.type === "checkout.session.completed" && sub.metadata?.org_id) await syncQuantity(sub.metadata.org_id);
  } catch (e) {
    // Let Stripe retry: forget the event so the retry isn't treated as a duplicate.
    await db().from("stripe_events").delete().eq("id", event.id);
    console.error("stripe webhook failed", event.type, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
