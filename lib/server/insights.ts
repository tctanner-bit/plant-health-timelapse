// Storage and API shape for Nova insights (camera_insights).

export const INSIGHT_COLUMNS =
  "id, camera_id, kind, period_start, period_end, day_label, question, status, headline, concern, observations, suggestions, frames, sensor_summary, model, error, created_at, completed_at";

export type InsightRow = {
  id: string;
  camera_id: string;
  kind: "daily" | "moment";
  period_start: string;
  period_end: string;
  day_label: string | null;
  question: string | null;
  status: "running" | "ready" | "failed";
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
});
