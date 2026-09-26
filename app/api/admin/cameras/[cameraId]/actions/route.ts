import { NextResponse } from "next/server";
import {
  GATEWAY_HOST,
  audit,
  isAdminResponse,
  newCameraToken,
  newSetupCode,
  requireAdmin,
} from "../../../../../../lib/server/admin";
import { db } from "../../../../../../lib/server/supabase";

export const dynamic = "force-dynamic";

const GUID = /^[0-9a-f-]{36}$/i;

// POST { action, notes? } → { ok, setupCode?, camera? (FTP settings) }
//   unclaim         back to unclaimed (wrong customer, return, replacement);
//                   issues a new setup code; the old org keeps its frames
//   new_setup_code  lost sticker, for an unclaimed camera
//   revoke          FTP login stops working now; frames kept
//   reactivate      new FTP password (shown once) and un-revoke
//   notes           support notes on the camera
export async function POST(req: Request, { params }: { params: { cameraId: string } }) {
  const ctx = await requireAdmin(req);
  if (isAdminResponse(ctx)) return ctx;
  if (!GUID.test(params.cameraId)) return NextResponse.json({ error: "Camera not found" }, { status: 404 });
  const id = params.cameraId.toLowerCase();

  const { data: cam } = await db()
    .from("cameras")
    .select("id, serial, org_id, org_name, room_name, claimed_at, revoked_at, ftp_username")
    .eq("id", id)
    .maybeSingle();
  if (!cam) return NextResponse.json({ error: "Camera not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const update = async (patch: Record<string, unknown>) => {
    const { error } = await db().from("cameras").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
  };

  try {
    switch (action) {
      case "unclaim": {
        if (!cam.org_id) return NextResponse.json({ error: "Camera is already unclaimed" }, { status: 409 });
        const setup = newSetupCode();
        await update({
          org_id: null,
          room_id: null,
          claimed_at: null,
          org_name: null,
          room_name: null,
          sensors: [],
          claim_code_hash: setup.hash,
        });
        await audit(ctx, "unclaim", id, { fromOrg: cam.org_id, fromOrgName: cam.org_name, fromRoom: cam.room_name });
        return NextResponse.json({ ok: true, setupCode: setup.code });
      }
      case "new_setup_code": {
        if (cam.org_id) return NextResponse.json({ error: "Camera is claimed — unclaim it first" }, { status: 409 });
        const setup = newSetupCode();
        await update({ claim_code_hash: setup.hash });
        await audit(ctx, "new_setup_code", id);
        return NextResponse.json({ ok: true, setupCode: setup.code });
      }
      case "revoke": {
        if (cam.revoked_at) return NextResponse.json({ error: "Already revoked" }, { status: 409 });
        await update({ revoked_at: new Date().toISOString() });
        await audit(ctx, "revoke", id);
        return NextResponse.json({ ok: true });
      }
      case "reactivate": {
        const t = newCameraToken();
        await update({ ingest_token_hash: t.hash, token_hint: t.hint, revoked_at: null });
        await audit(ctx, "reactivate", id, { tokenHint: t.hint });
        return NextResponse.json({
          ok: true,
          camera: { host: GATEWAY_HOST, port: 21, username: cam.ftp_username ?? `cam-${String(cam.serial ?? "").toLowerCase()}`, password: t.token },
        });
      }
      case "notes": {
        const notes = typeof body.notes === "string" ? body.notes.slice(0, 4000) : "";
        await update({ notes: notes || null });
        await audit(ctx, "notes", id, { length: notes.length });
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Action failed" }, { status: 500 });
  }
}
