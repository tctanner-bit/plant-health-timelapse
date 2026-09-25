import { NextResponse } from "next/server";
import { requireOrg, isResponse } from "../../../../../lib/server/auth";
import { db, FRAMES_BUCKET } from "../../../../../lib/server/supabase";

export const dynamic = "force-dynamic";

const TTL_SEC = 60 * 60;

// GET → { frames: { [cameraId]: { id, ts, url } } }
// Each camera's newest frame with a signed URL: one query and one signing
// call for the whole org, however many cameras it has.
export async function GET(req: Request, { params }: { params: { orgId: string } }) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;

  const { data: rows, error } = await db().rpc("latest_frames", { p_org: ctx.orgId });
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });
  const list = (rows ?? []) as { camera_id: string; frame_id: number; captured_at: string; storage_path: string }[];
  if (list.length === 0) return NextResponse.json({ frames: {} });

  const { data: signed, error: signErr } = await db()
    .storage.from(FRAMES_BUCKET)
    .createSignedUrls(list.map((r) => r.storage_path), TTL_SEC);
  if (signErr) return NextResponse.json({ error: "Could not sign URLs" }, { status: 500 });

  const byPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
  const frames: Record<string, { id: number; ts: number; url: string }> = {};
  for (const r of list) {
    const url = byPath.get(r.storage_path);
    if (url) frames[r.camera_id] = { id: r.frame_id, ts: new Date(r.captured_at).getTime(), url };
  }
  return NextResponse.json({ frames });
}
