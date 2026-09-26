import { NextResponse } from "next/server";
import { requireOrg, isResponse } from "../../../../../../../lib/server/auth";
import { db } from "../../../../../../../lib/server/supabase";
import { loadCamera } from "../../../../../../../lib/server/cameras";
import { INSIGHT_COLUMNS, InsightRow, toInsight } from "../../../../../../../lib/server/insights";
import { NovaError, NovaResult, analyzeDay, analyzeMoment } from "../../../../../../../lib/server/nova";
import type { Uom } from "../../../../../../../lib/growlink";

export const dynamic = "force-dynamic";
// Vision calls with several frames take 10–30s.
export const maxDuration = 60;

type Ctx = { params: { orgId: string; cameraId: string } };

const MOMENTS_PER_ORG_PER_HOUR = 20;
const RUNNING_STALE_MS = 3 * 60_000;
const FAILED_RETRY_MS = 60 * 60_000;

// GET → { insights: [...] } newest first (daily and moment).
export async function GET(req: Request, { params }: Ctx) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;
  const cam = await loadCamera(ctx, params.cameraId);
  if (cam instanceof NextResponse) return cam;

  const { data, error } = await db()
    .from("camera_insights")
    .select(INSIGHT_COLUMNS)
    .eq("camera_id", cam.id)
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(40);
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });
  return NextResponse.json({ insights: (data as InsightRow[]).map(toInsight) });
}

// POST { kind: "daily", day, start, end, tz?, uom? }
//    | { kind: "moment", at, question?, tz?, uom? }
// Runs the analysis and returns { insight }. Daily insights are made once per
// camera per day and shared; a concurrent request gets the one in progress.
export async function POST(req: Request, { params }: Ctx) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;
  const cam = await loadCamera(ctx, params.cameraId);
  if (cam instanceof NextResponse) return cam;

  const body = await req.json().catch(() => ({}));
  const tz = typeof body.tz === "string" ? body.tz.slice(0, 64) : undefined;
  const uom = body.uom && typeof body.uom === "object" ? (body.uom as Uom) : undefined;
  const now = Date.now();

  if (body.kind === "daily") {
    const start = Number(body.start);
    const end = Number(body.end);
    const day = typeof body.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : null;
    if (!day || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 26 * 3600_000 || end - start < 20 * 3600_000 || end > now + 60_000)
      return NextResponse.json({ error: "Give a completed local day: day (yyyy-mm-dd), start and end" }, { status: 400 });

    const row = await claimDaily(cam.id, ctx.orgId, day, start, end);
    if ("done" in row) return NextResponse.json({ insight: toInsight(row.done) });

    return runAndStore(row.id, () => analyzeDay(ctx, cam, { start, end, tz, uom }));
  }

  if (body.kind === "moment") {
    const at = Number(body.at);
    if (!Number.isFinite(at) || at > now + 60_000)
      return NextResponse.json({ error: "Give the moment as a timestamp (at)" }, { status: 400 });
    const question = typeof body.question === "string" ? body.question.trim().slice(0, 500) : "";

    const { count } = await db()
      .from("camera_insights")
      .select("id", { count: "exact", head: true })
      .eq("org_id", ctx.orgId)
      .eq("kind", "moment")
      .gte("created_at", new Date(now - 3600_000).toISOString());
    if ((count ?? 0) >= MOMENTS_PER_ORG_PER_HOUR)
      return NextResponse.json({ error: "Nova has done a lot of on-demand analysis this hour — try again shortly" }, { status: 429 });

    const { data, error } = await db()
      .from("camera_insights")
      .insert({
        camera_id: cam.id,
        org_id: ctx.orgId,
        kind: "moment",
        period_start: new Date(at - 6 * 3600_000).toISOString(),
        period_end: new Date(at).toISOString(),
        question: question || null,
      })
      .select("id")
      .single();
    if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });

    return runAndStore(data.id, () => analyzeMoment(ctx, cam, { at, question, tz, uom }));
  }

  return NextResponse.json({ error: 'kind must be "daily" or "moment"' }, { status: 400 });
}

// Reserve the day's row. Returns an existing finished (or recently failed /
// in-progress) insight instead of starting a duplicate.
async function claimDaily(cameraId: string, orgId: string, day: string, start: number, end: number): Promise<{ id: string } | { done: InsightRow }> {
  const ins = await db()
    .from("camera_insights")
    .insert({
      camera_id: cameraId,
      org_id: orgId,
      kind: "daily",
      day_label: day,
      period_start: new Date(start).toISOString(),
      period_end: new Date(end).toISOString(),
    })
    .select("id")
    .single();
  if (!ins.error) return { id: ins.data.id };

  const { data: existing } = await db()
    .from("camera_insights")
    .select(INSIGHT_COLUMNS)
    .eq("camera_id", cameraId)
    .eq("kind", "daily")
    .eq("day_label", day)
    .maybeSingle();
  if (!existing) throw new Error(ins.error.message);
  const row = existing as InsightRow;
  const age = Date.now() - new Date(row.created_at).getTime();
  if (row.status === "ready") return { done: row };
  if (row.status === "running" && age < RUNNING_STALE_MS) return { done: row };
  if (row.status === "failed" && age < FAILED_RETRY_MS) return { done: row };

  await db()
    .from("camera_insights")
    .update({ status: "running", error: null, created_at: new Date().toISOString() })
    .eq("id", row.id);
  return { id: row.id };
}

async function runAndStore(id: string, work: () => Promise<NovaResult & { periodStart?: number; periodEnd?: number }>) {
  try {
    const r = await work();
    const { data, error } = await db()
      .from("camera_insights")
      .update({
        status: "ready",
        headline: r.headline,
        concern: r.concern,
        observations: r.observations,
        suggestions: r.suggestions,
        frames: r.frames,
        sensor_summary: { confidence: r.confidence, sensors: r.sensorSummary },
        model: r.model,
        completed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(INSIGHT_COLUMNS)
      .single();
    if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });
    return NextResponse.json({ insight: toInsight(data as InsightRow) });
  } catch (e) {
    const message = e instanceof NovaError ? e.message : "Nova hit an unexpected error";
    const status = e instanceof NovaError ? e.status : 500;
    if (status === 503) {
      // Configuration problem, not this day's data: don't block a retry.
      await db().from("camera_insights").delete().eq("id", id);
    } else {
      await db()
        .from("camera_insights")
        .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
        .eq("id", id);
    }
    return NextResponse.json({ error: message }, { status });
  }
}
