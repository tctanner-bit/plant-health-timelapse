import { NextResponse } from "next/server";
import { requireOrg, isResponse } from "../../../../../lib/server/auth";
import { db } from "../../../../../lib/server/supabase";
import { CAMERA_COLUMNS, CameraRow, toCamera } from "../../../../../lib/server/cameras";

export const dynamic = "force-dynamic";

// Cameras claimed by this org. Unclaimed cameras have no org and never appear.
// Cameras are added by claiming a provisioned unit (POST …/cameras/claim).
export async function GET(req: Request, { params }: { params: { orgId: string } }) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;

  const { data, error } = await db()
    .from("cameras")
    .select(CAMERA_COLUMNS)
    .eq("org_id", ctx.orgId)
    .order("claimed_at");
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });
  return NextResponse.json({ cameras: (data as CameraRow[]).map(toCamera) });
}
