import { NextResponse } from "next/server";
import { requireOrg, isResponse } from "../../../../../../../lib/server/auth";
import { db, FRAMES_BUCKET } from "../../../../../../../lib/server/supabase";
import { loadCamera } from "../../../../../../../lib/server/cameras";

export const dynamic = "force-dynamic";

const TTL_SEC = 60 * 60;
const MAX_IDS = 100;

// POST { ids: number[] } → { urls: { [id]: signedUrl } }
// Paths are looked up server-side from ids that belong to this camera, so a
// caller can't sign arbitrary objects in the bucket.
export async function POST(req: Request, { params }: { params: { orgId: string; cameraId: string } }) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;
  const cam = await loadCamera(ctx, params.cameraId);
  if (cam instanceof NextResponse) return cam;

  const body = await req.json().catch(() => ({}));
  const ids: number[] = Array.isArray(body.ids)
    ? body.ids.filter((n: unknown) => Number.isInteger(n)).slice(0, MAX_IDS)
    : [];
  if (ids.length === 0) return NextResponse.json({ urls: {} });

  const { data: rows, error } = await db()
    .from("camera_frames")
    .select("id, storage_path")
    .eq("camera_id", cam.id)
    .eq("org_id", ctx.orgId)
    .in("id", ids);
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });
  if (rows.length === 0) return NextResponse.json({ urls: {} });

  const { data: signed, error: signErr } = await db()
    .storage.from(FRAMES_BUCKET)
    .createSignedUrls(rows.map((r) => r.storage_path), TTL_SEC);
  if (signErr) return NextResponse.json({ error: "Could not sign URLs" }, { status: 500 });

  const byPath = new Map(signed.map((s) => [s.path, s.signedUrl]));
  const urls: Record<number, string> = {};
  for (const r of rows) {
    const u = byPath.get(r.storage_path);
    if (u) urls[r.id] = u;
  }
  return NextResponse.json({ urls });
}
