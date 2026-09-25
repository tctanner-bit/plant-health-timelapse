// Real sensor data from Growlink, shaped for the player: one series of
// { t, v } per sensor, keyed by sensor id. Units arrive already converted by
// the Growlink API (Uom-* headers), so nothing here does unit math.

import { ChartResponse, METRIC_LABELS, Sensor, sameId } from "./growlink";

export type SensorMeta = {
  id: string;           // Growlink sensor id, lowercased
  label: string;        // sensor name as configured in Growlink
  short: string;        // metric label for chips
  metric: number;
  unit: string;         // filled in from the chart response
  color: string;
};

export type Reading = { t: number; v: number };
export type Series = Record<string, Reading[]>;

export const PALETTE = [
  "#ef9f27", "#378add", "#7f77dd", "#97c459", "#1d9e75",
  "#d4537e", "#e24b4a", "#d85a30", "#5dcaa5", "#b4b2a9",
];

// The camera's configured sensors, in the configured order, with their current
// names and metrics from Growlink. Colors follow the configured order so they
// stay put when sensors are toggled. Ids no longer in the room (removed in
// Growlink) are dropped and returned separately so the UI can say so.
export function configuredSensors(
  roomSensors: Sensor[],
  ids: string[]
): { meta: SensorMeta[]; missing: string[] } {
  const meta: SensorMeta[] = [];
  const missing: string[] = [];
  ids.forEach((id) => {
    const s = roomSensors.find((x) => sameId(x.id, id));
    if (!s) return void missing.push(id);
    meta.push({
      id: id.toLowerCase(),
      label: s.name,
      short: METRIC_LABELS[s.metric] ?? s.name,
      metric: s.metric,
      unit: "",
      color: PALETTE[meta.length % PALETTE.length],
    });
  });
  return { meta, missing };
}

// The chart response doesn't promise a sensor id per series, so match by id if
// present, then by name, then fall back to request order.
export function seriesFromChart(
  chart: ChartResponse,
  requested: SensorMeta[]
): { series: Series; units: Record<string, string> } {
  const series: Series = {};
  const units: Record<string, string> = {};
  chart.series.forEach((s, i) => {
    const m =
      requested.find((r) => sameId(r.id, s.sensorId)) ??
      requested.find((r) => r.label === s.name) ??
      requested[i];
    if (!m) return;
    series[m.id] = s.data
      .filter((p) => p.y != null)
      .map((p) => ({ t: new Date(p.x).getTime(), v: p.y as number }))
      .sort((a, b) => a.t - b.t);
    units[m.id] = s.unit ?? "";
  });
  return { series, units };
}

// Most recent reading at or before t. Sensors report on their own time grid,
// so "nearest" could show a value from the future relative to the frame.
export function readingAt(series: Reading[] | undefined, t: number): number | null {
  if (!series?.length || series[0].t > t) return null;
  let lo = 0, hi = series.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (series[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return series[lo].v;
}

export function fmt(v: number): string {
  const a = Math.abs(v);
  return v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2);
}
