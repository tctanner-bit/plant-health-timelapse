import Stripe from "stripe";
import { NextResponse } from "next/server";
import { db } from "../../../../lib/server/supabase";
import { saveSubscription, stripe, syncQuantity } from "../../../../lib/server/billing";

export const dynamic = "force-dynamic";

// Stripe → us. Verifies the signature, then re-reads the subscription from
// Stripe rather than trusting event order, and copies it onto the org's row.
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

  // Seen before? Acknowledge without redoing the work.
  const { error: dup } = await db().from("stripe_events").insert({ id: event.id, type: event.type });
  if (dup) {
    if (dup.code === "23505") return NextResponse.json({ received: true, duplicate: true });
    return NextResponse.json({ error: "Database error" }, { status: 500 }); // Stripe retries
  }

  try {
    let subId: string | null = null;
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.mode === "subscription" && s.subscription)
          subId = typeof s.subscription === "string" ? s.subscription : s.subscription.id;
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
        subId = (event.data.object as Stripe.Subscription).id;
        break;
      case "invoice.paid":
      case "invoice.payment_failed": {
        // The subscription moved under invoice.parent in API 2025-03-31.
        const inv = event.data.object as any;
        const s = inv.parent?.subscription_details?.subscription ?? inv.subscription ?? null;
        subId = typeof s === "string" ? s : s?.id ?? null;
        break;
      }
    }
    if (subId) {
      const sub = await stripe().subscriptions.retrieve(subId);
      await saveSubscription(sub);
      // Cameras may have changed between opening checkout and paying.
      if (event.type === "checkout.session.completed" && sub.metadata?.org_id) await syncQuantity(sub.metadata.org_id);
    }
  } catch (e) {
    // Let Stripe retry: forget the event so the retry isn't treated as a duplicate.
    await db().from("stripe_events").delete().eq("id", event.id);
    console.error("stripe webhook failed", event.type, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
