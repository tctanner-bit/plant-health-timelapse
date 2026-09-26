import { NextResponse } from "next/server";
import { requireAdmin, isAdminResponse } from "../../../../lib/server/admin";
import { db } from "../../../../lib/server/supabase";

export const dynamic = "force-dynamic";

// GET → { cameras: [...] } every camera across all customers, with health numbers.
export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (isAdminResponse(ctx)) return ctx;
  const { data, error } = await db().rpc("fleet_overview");
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });
  return NextResponse.json({ cameras: data ?? [] });
}
