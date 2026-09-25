import { NextResponse } from "next/server";
import { requireOrg, isResponse } from "../../../../../../lib/server/auth";
import { db } from "../../../../../../lib/server/supabase";
import {
  CAMERA_COLUMNS,
  CameraRow,
  loadCamera,
  parseName,
  parseSensors,
  roomInOrg,
  toCamera,
} from "../../../../../../lib/server/cameras";

export const dynamic = "force-dynamic";

type Ctx = { params: { orgId: string; cameraId: string } };

// Rename, move to another room, or choose which Growlink sensors appear with
// the timelapse (shared by everyone in the org). The capture interval is
// configured on the camera itself at provisioning, so it isn't editable here.
export async function PATCH(req: Request, { params }: Ctx) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;
  const cam = await loadCamera(ctx, params.cameraId);
  if (cam instanceof NextResponse) return cam;

  const body = await req.json().catch(() => ({}));
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) {
    const name = parseName(body.name);
    if (!name) return NextResponse.json({ error: "Name is required (max 80 chars)" }, { status: 400 });
    patch.name = name;
  }
  let roomId = cam.room_id;
  if (body.roomId !== undefined && String(body.roomId).toLowerCase() !== cam.room_id) {
    if (!(await roomInOrg(ctx, body.roomId)))
      return NextResponse.json({ error: "Room not found in this organization" }, { status: 400 });
    roomId = String(body.roomId).toLowerCase();
    patch.room_id = roomId;
    // The old room's sensors don't belong to the new room.
    patch.sensors = [];
  }
  if (body.sensors !== undefined) {
    const sensors = await parseSensors(ctx, roomId, body.sensors);
    if (typeof sensors === "string") return NextResponse.json({ error: sensors }, { status: 400 });
    patch.sensors = sensors;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ camera: toCamera(cam) });

  const { data, error } = await db()
    .from("cameras")
    .update(patch)
    .eq("id", cam.id)
    .eq("org_id", ctx.orgId)
    .select(CAMERA_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });
  return NextResponse.json({ camera: toCamera(data as CameraRow) });
}

// Revoke: the camera's FTP login stops working immediately (use for a stolen
// or decommissioned unit). Frames are kept. Reactivating means reprovisioning
// the camera with a new login, which Growlink support does.
export async function DELETE(req: Request, { params }: Ctx) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;
  const cam = await loadCamera(ctx, params.cameraId);
  if (cam instanceof NextResponse) return cam;

  const { data, error } = await db()
    .from("cameras")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", cam.id)
    .eq("org_id", ctx.orgId)
    .select(CAMERA_COLUMNS)
    .single();
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });
  return NextResponse.json({ camera: toCamera(data as CameraRow) });
}
