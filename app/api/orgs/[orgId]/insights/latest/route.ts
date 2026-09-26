import { NextResponse } from "next/server";
import { requireOrg, isResponse } from "../../../../../../lib/server/auth";
import { db } from "../../../../../../lib/server/supabase";

export const dynamic = "force-dynamic";

// GET → { latest: { [cameraId]: { id, kind, concern, headline, createdAt } } }
// Newest finished Nova insight per camera, for the facility view's badges.
export async function GET(req: Request, { params }: { params: { orgId: string } }) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;

  const { data, error } = await db().rpc("latest_insights", { p_org: ctx.orgId });
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });

  const latest: Record<string, { id: string; kind: string; concern: string | null; headline: string | null; createdAt: string }> = {};
  for (const r of (data ?? []) as { camera_id: string; insight_id: string; kind: string; concern: string | null; headline: string | null; created_at: string }[]) {
    latest[r.camera_id] = { id: r.insight_id, kind: r.kind, concern: r.concern, headline: r.headline, createdAt: r.created_at };
  }
  return NextResponse.json({ latest });
}
