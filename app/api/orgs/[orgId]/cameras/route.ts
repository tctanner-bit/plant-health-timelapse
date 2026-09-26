import { NextResponse } from "next/server";
import { requireOrg, isResponse } from "../../../../../lib/server/auth";
import { db } from "../../../../../lib/server/supabase";
import { CAMERA_COLUMNS, CameraRow, toCamera } from "../../../../../lib/server/cameras";
import { getRooms, sameId } from "../../../../../lib/growlink";

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
  const rows = data as (CameraRow & { org_name: string | null; room_name: string | null })[];

  // Keep the names support sees in the fleet dashboard current. Growlink is
  // the source of truth; this request already holds a key that can read them.
  const stale = rows.filter((r) => r.org_name !== ctx.orgName || !r.room_name);
  if (stale.length) {
    const rooms = await getRooms(ctx.apiKey, ctx.orgId).catch(() => []);
    await Promise.all(
      stale.map((r) =>
        db()
          .from("cameras")
          .update({
            org_name: ctx.orgName,
            room_name: rooms.find((x) => sameId(x.id, r.room_id))?.name ?? r.room_name,
          })
          .eq("id", r.id)
      )
    );
  }
  return NextResponse.json({ cameras: rows.map(toCamera) });
}
