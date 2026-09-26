// Storage and API shape for Nova insights (camera_insights).

import { db } from "./supabase";
import { NovaError, NovaResult } from "./nova";

export const INSIGHT_COLUMNS =
  "id, camera_id, kind, period_start, period_end, day_label, question, status, headline, concern, observations, suggestions, frames, sensor_summary, model, error, created_at, completed_at, trigger";

export type InsightRow = {
  id: string;
  camera_id: string;
  kind: "daily" | "moment" | "range" | "alert";
  period_start: string;
  period_end: string;
  day_label: string | null;
  question: string | null;
  status: "queued" | "running" | "ready" | "failed";
  headline: string | null;
  concern: "none" | "watch" | "action" | null;
  observations: unknown[];
  suggestions: string[];
  frames: unknown[];
  sensor_summary: { confidence?: string } | null;
  model: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
  trigger: { kind: string; label: string; detail?: string } | null;
};

export const toInsight = (r: InsightRow) => ({
  id: r.id,
  cameraId: r.camera_id,
  kind: r.kind,
  periodStart: new Date(r.period_start).getTime(),
  periodEnd: new Date(r.period_end).getTime(),
  day: r.day_label,
  question: r.question,
  status: r.status,
  headline: r.headline,
  concern: r.concern,
  confidence: r.sensor_summary?.confidence ?? null,
  observations: r.observations ?? [],
  suggestions: r.suggestions ?? [],
  frames: r.frames ?? [],
  error: r.error,
  createdAt: r.created_at,
  trigger: r.trigger ?? null,
});

/**
 * Run a Nova analysis for an insight row and save the outcome. Failures are
 * recorded on the row, except configuration/budget ones (503/402), which
 * delete it so nothing blocks a retry.
 */
export async function completeInsight(
  id: string,
  work: () => Promise<NovaResult>
): Promise<{ row: InsightRow } | { error: string; status: number }> {
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
        input_tokens: r.usage.inputTokens,
        output_tokens: r.usage.outputTokens,
        cost_usd: r.usage.costUsd,
        usage_id: r.usage.usageId,
        completed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select(INSIGHT_COLUMNS)
      .single();
    if (error) return { error: "Database error", status: 500 };
    return { row: data as unknown as InsightRow };
  } catch (e) {
    const message = e instanceof NovaError ? e.message : "Nova hit an unexpected error";
    const status = e instanceof NovaError ? e.status : 500;
    if (!(e instanceof NovaError)) console.error("nova: unexpected error", e instanceof Error ? e.message : e);
    if (status === 503 || status === 402) {
      await db().from("camera_insights").delete().eq("id", id);
    } else {
      await db()
        .from("camera_insights")
        .update({ status: "failed", error: message, completed_at: new Date().toISOString() })
        .eq("id", id);
    }
    return { error: message, status };
  }
}
