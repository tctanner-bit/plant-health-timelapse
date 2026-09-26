import { NextResponse } from "next/server";
import { requireAdmin, isAdminResponse } from "../../../../lib/server/admin";
import { db } from "../../../../lib/server/supabase";

export const dynamic = "force-dynamic";

// GET ?days=30 → { rows: [{ day, org_id, org_name, insights, daily_reviews, moments, failed, cost_usd }] }
export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (isAdminResponse(ctx)) return ctx;
  const days = Math.min(366, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 30));
  const { data, error } = await db().rpc("nova_usage_daily", { p_days: days });
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });
  return NextResponse.json({ rows: data ?? [] });
}
