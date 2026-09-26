import { NextResponse } from "next/server";
import { requireAdmin, isAdminResponse } from "../../../../lib/server/admin";
import { db } from "../../../../lib/server/supabase";

export const dynamic = "force-dynamic";

// GET → { entries: [...] } the 200 most recent support actions.
export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (isAdminResponse(ctx)) return ctx;
  const { data, error } = await db()
    .from("fleet_audit")
    .select("id, at, admin_email, action, detail, camera_id, cameras(serial, org_name, room_name)")
    .order("at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}
