import { NextResponse } from "next/server";
import { audit, isAdminResponse, requireAdmin } from "../../../../lib/server/admin";
import { db } from "../../../../lib/server/supabase";
import { APP, BillingRow, access } from "../../../../lib/server/billing";

export const dynamic = "force-dynamic";

const GUID = /^[0-9a-f-]{36}$/i;

// GET → { orgs: [...] } every org's billing state with its active camera count.
export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (isAdminResponse(ctx)) return ctx;

  const [{ data: rows, error }, { data: cams }] = await Promise.all([
    db().from("org_billing").select("*").eq("app", APP).order("org_name"),
    db().from("cameras").select("org_id").not("org_id", "is", null).is("revoked_at", null),
  ]);
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });
  const counts = new Map<string, number>();
  for (const c of cams ?? []) counts.set(c.org_id, (counts.get(c.org_id) ?? 0) + 1);

  return NextResponse.json({
    orgs: (rows as BillingRow[]).map((b) => ({
      orgId: b.org_id,
      orgName: b.org_name,
      ...access(b),
      cameras: counts.get(b.org_id) ?? 0,
      status: b.status,
      quantity: b.quantity,
      currentPeriodEnd: b.current_period_end,
      cancelAtPeriodEnd: b.cancel_at_period_end,
      comp: b.comp,
      compNote: b.comp_note,
      stripeCustomerId: b.stripe_customer_id,
      createdAt: b.created_at,
    })),
  });
}

// POST { orgId, action: "comp" | "uncomp" | "extend_trial", note?, days? }
export async function POST(req: Request) {
  const ctx = await requireAdmin(req);
  if (isAdminResponse(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const orgId = String(body.orgId ?? "").toLowerCase();
  if (!GUID.test(orgId)) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  const { data: b } = await db().from("org_billing").select("*").eq("org_id", orgId).eq("app", APP).maybeSingle();
  if (!b) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  const row = b as BillingRow;
  const set = async (patch: Record<string, unknown>) => {
    const { error } = await db()
      .from("org_billing")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("org_id", orgId)
      .eq("app", APP);
    if (error) throw new Error(error.message);
  };

  switch (body.action) {
    case "comp": {
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 200) : "";
      if (!note) return NextResponse.json({ error: "Say why (e.g. pilot through March)" }, { status: 400 });
      await set({ comp: true, comp_note: note });
      await audit(ctx, "billing_comp", null, { orgId, orgName: row.org_name, note });
      return NextResponse.json({ ok: true });
    }
    case "uncomp": {
      await set({ comp: false, comp_note: null });
      await audit(ctx, "billing_uncomp", null, { orgId, orgName: row.org_name });
      return NextResponse.json({ ok: true });
    }
    case "extend_trial": {
      const days = Number(body.days);
      if (!Number.isInteger(days) || days < 1 || days > 90)
        return NextResponse.json({ error: "Extend by 1–90 days" }, { status: 400 });
      // From today if the trial already ended, else from its current end.
      const from = Math.max(Date.now(), Date.parse(row.trial_ends_at));
      const until = new Date(from + days * 86_400_000).toISOString();
      await set({ trial_ends_at: until });
      await audit(ctx, "billing_extend_trial", null, { orgId, orgName: row.org_name, days, until });
      return NextResponse.json({ ok: true, trialEndsAt: until });
    }
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
