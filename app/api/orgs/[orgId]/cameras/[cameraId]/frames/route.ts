import { NextResponse } from "next/server";
import { requireOrg, isResponse } from "../../../../../../../lib/server/auth";
import { db } from "../../../../../../../lib/server/supabase";
import { loadCamera } from "../../../../../../../lib/server/cameras";

export const dynamic = "force-dynamic";

const PAGE = 1000;          // PostgREST's default max-rows
const MAX_FRAMES = 20000;   // ~70 days at 5-minute intervals

// GET ?start=<ms>&end=<ms>
// → { frames: [{ id, ts }], first, last }  (first/last = the camera's whole history)
export async function GET(req: Request, { params }: { params: { orgId: string; cameraId: string } }) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;
  const cam = await loadCamera(ctx, params.cameraId);
  if (cam instanceof NextResponse) return cam;

  const q = new URL(req.url).searchParams;
  const end = Number(q.get("end")) || Date.now();
  const start = Number(q.get("start")) || end - 7 * 24 * 3600 * 1000;

  const bound = async (ascending: boolean) => {
    const { data } = await db()
      .from("camera_frames")
      .select("captured_at")
      .eq("camera_id", cam.id)
      .eq("org_id", ctx.orgId)
      .order("captured_at", { ascending })
      .limit(1)
      .maybeSingle();
    return data ? new Date(data.captured_at).getTime() : null;
  };

  const frames: { id: number; ts: number }[] = [];
  for (let from = 0; from < MAX_FRAMES; from += PAGE) {
    const { data, error } = await db()
      .from("camera_frames")
      .select("id, captured_at")
      .eq("camera_id", cam.id)
      .eq("org_id", ctx.orgId)
      .gte("captured_at", new Date(start).toISOString())
      .lte("captured_at", new Date(end).toISOString())
      .order("captured_at")
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });
    for (const r of data) frames.push({ id: r.id, ts: new Date(r.captured_at).getTime() });
    if (data.length < PAGE) break;
  }

  const [first, last] = await Promise.all([bound(true), bound(false)]);
  return NextResponse.json({ frames, first, last, truncated: frames.length >= MAX_FRAMES });
}
