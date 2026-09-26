import { NextResponse } from "next/server";
import { requireAdmin, isAdminResponse } from "../../../../../lib/server/admin";
import { db, FRAMES_BUCKET } from "../../../../../lib/server/supabase";

export const dynamic = "force-dynamic";

const GUID = /^[0-9a-f-]{36}$/i;

// GET → { camera, hourly, frames, insights, audit } for the support detail view.
export async function GET(req: Request, { params }: { params: { cameraId: string } }) {
  const ctx = await requireAdmin(req);
  if (isAdminResponse(ctx)) return ctx;
  if (!GUID.test(params.cameraId)) return NextResponse.json({ error: "Camera not found" }, { status: 404 });
  const id = params.cameraId.toLowerCase();

  const { data: all, error } = await db().rpc("fleet_overview");
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });
  const camera = (all ?? []).find((c: { id: string }) => c.id === id);
  if (!camera) return NextResponse.json({ error: "Camera not found" }, { status: 404 });

  const [hourly, recent, insights, audit, extra] = await Promise.all([
    db().rpc("camera_hourly", { p_camera: id, p_days: 7 }),
    db().from("camera_frames").select("id, captured_at, storage_path, bytes").eq("camera_id", id).order("captured_at", { ascending: false }).limit(8),
    db()
      .from("camera_insights")
      .select("id, kind, status, concern, headline, error, day_label, cost_usd, input_tokens, output_tokens, created_at")
      .eq("camera_id", id)
      .order("created_at", { ascending: false })
      .limit(15),
    db().from("fleet_audit").select("id, at, admin_email, action, detail").eq("camera_id", id).order("at", { ascending: false }).limit(25),
    db().from("cameras").select("ftp_username, token_hint, sensors, average_same_type").eq("id", id).single(),
  ]);

  const frameRows = recent.data ?? [];
  let signed = new Map<string, string | null>();
  if (frameRows.length) {
    const { data } = await db().storage.from(FRAMES_BUCKET).createSignedUrls(frameRows.map((f) => f.storage_path), 900);
    signed = new Map((data ?? []).map((d) => [d.path ?? "", d.signedUrl]));
  }

  return NextResponse.json({
    camera: { ...camera, ...(extra.data ?? {}) },
    hourly: hourly.data ?? [],
    frames: frameRows.map((f) => ({ id: f.id, ts: new Date(f.captured_at).getTime(), bytes: f.bytes, url: signed.get(f.storage_path) ?? null })),
    insights: insights.data ?? [],
    audit: audit.data ?? [],
  });
}
