import type { Metadata } from "next";
import { Brand } from "../../../components/ui";

export const metadata: Metadata = { title: "Billing · Plant Health AI", robots: { index: false } };

// Where Stripe Checkout and the billing portal send people back to. It runs
// in its own tab without the Growlink key, so it only says what happened;
// the app's tab refreshes its billing status when it's shown again.
export default function BillingDone({ searchParams }: { searchParams: { status?: string } }) {
  const status = searchParams.status;
  const [title, body] =
    status === "success"
      ? ["You're all set", "Your payment method is saved. Plant Health AI keeps running after your trial with no interruption."]
      : status === "cancelled"
      ? ["Checkout cancelled", "Nothing was charged. You can add a payment method any time from the Billing tab."]
      : ["Billing updated", "Your changes are saved."];
  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div className="card" style={{ maxWidth: 440, textAlign: "center", padding: "40px 28px" }}>
        <Brand />
        <h1 style={{ fontSize: 24, margin: "20px 0 10px" }}>{title}</h1>
        <p className="muted" style={{ lineHeight: 1.5 }}>{body}</p>
        <p className="small" style={{ color: "var(--dim)", marginTop: 20 }}>You can close this tab and return to Growlink.</p>
      </div>
    </main>
  );
}
