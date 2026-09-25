import { NextResponse } from "next/server";
import { requireOrg, isResponse } from "../../../../../../lib/server/auth";
import { db } from "../../../../../../lib/server/supabase";
import {
  CAMERA_COLUMNS,
  CameraRow,
  hashClaimCode,
  normalizeClaimCode,
  parseName,
  roomInOrg,
  toCamera,
} from "../../../../../../lib/server/cameras";

export const dynamic = "force-dynamic";

// POST { code, roomId, name? } → { camera }
//
// Claims a provisioned camera by the code on its sticker. The update only
// matches an unclaimed, unrevoked camera, and clears the code in the same
// statement, so a code works exactly once even under concurrent claims.
export async function POST(req: Request, { params }: { params: { orgId: string } }) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;

  const body = await req.json().catch(() => ({}));
  const code = typeof body.code === "string" ? normalizeClaimCode(body.code) : null;
  if (!code)
    return NextResponse.json({ error: "Enter the 8-character Growlink setup code (like 7K3M-Q9XW), not the camera's UID" }, { status: 400 });
  const name = body.name === undefined || body.name === "" ? "Canopy camera" : parseName(body.name);
  if (!name) return NextResponse.json({ error: "Name must be 1–80 characters" }, { status: 400 });
  if (!(await roomInOrg(ctx, body.roomId)))
    return NextResponse.json({ error: "Room not found in this organization" }, { status: 400 });

  const { data, error } = await db()
    .from("cameras")
    .update({
      org_id: ctx.orgId,
      room_id: String(body.roomId).toLowerCase(),
      name,
      claimed_at: new Date().toISOString(),
      claim_code_hash: null,
    })
    .eq("claim_code_hash", hashClaimCode(code))
    .is("org_id", null)
    .is("revoked_at", null)
    .select(CAMERA_COLUMNS)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });
  if (!data)
    return NextResponse.json(
      { error: "That code doesn't match an unclaimed camera. Check the Growlink setup code, or contact Growlink support." },
      { status: 404 }
    );

  return NextResponse.json({ camera: toCamera(data as CameraRow) }, { status: 201 });
}
