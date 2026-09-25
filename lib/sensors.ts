// Real sensor data from Growlink, shaped for the player. Units arrive already
// converted by the Growlink API (Uom-* headers), so nothing here does unit math.
//
// Two levels:
//   sensors — the camera's configured Growlink sensors, one per id.
//   rows    — what the player shows. With averaging on (the default, as in
//             the display app), sensors of the same type collapse into one
//             "room average" row; otherwise each sensor is its own row.
// Series are keyed by sensor id for raw data and by row id for display.

import { ChartResponse, METRIC_LABELS, Sensor, sameId } from "./growlink";

export type SensorMeta = {
  id: string;           // sensor id, or "avg-<metric>" for an averaged row
  label: string;        // sensor name, or the metric name for an average
  short: string;        // metric label
  detail?: string;      // e.g. "Average of 3 sensors"
  metric: number;
  unit: string;         // filled in from the chart response
  color: string;
  members: string[];    // sensor ids feeding this row (one for a plain sensor)
};

export type Reading = { t: number; v: number };
export type Series = Record<string, Reading[]>;
export type Band = { t: number; lo: number; hi: number };

export const PALETTE = [
  "#3fb984", "#4f9fe8", "#e0a33c", "#a47eff", "#e8756a",
  "#5fd0c4", "#d6c24a", "#e36fa8", "#8fb4ff", "#b8c4bd",
];

// A member reading older than this doesn't count toward an average at time t
// (the sensor has stopped reporting, rather than reporting on a coarser grid).
const MAX_GAP_MS = 45 * 60 * 1000;

// The camera's configured sensors, in configured order, with their current
// names and metrics from Growlink. Ids no longer in the room (removed in
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
    const key = id.toLowerCase();
    meta.push({
      id: key,
      label: s.name,
      short: METRIC_LABELS[s.metric] ?? s.name,
      detail: s.moduleName,
      metric: s.metric,
      unit: "",
      color: PALETTE[meta.length % PALETTE.length],
      members: [key],
    });
  });
  return { meta, missing };
}

// Display rows. A metric's average row sits where its first sensor was in the
// configured order. Colors follow row order so they stay put when toggled.
export function displayRows(sensors: SensorMeta[], average: boolean): SensorMeta[] {
  const rows: SensorMeta[] = [];
  for (const s of sensors) {
    const group = average ? sensors.filter((x) => x.metric === s.metric) : [s];
    if (group.length > 1) {
      if (rows.some((r) => r.id === `avg-${s.metric}`)) continue;
      rows.push({
        id: `avg-${s.metric}`,
        label: METRIC_LABELS[s.metric] ?? s.label,
        short: METRIC_LABELS[s.metric] ?? s.label,
        detail: `Average of ${group.length} sensors`,
        metric: s.metric,
        unit: s.unit,
        color: "",
        members: group.map((g) => g.id),
      });
    } else {
      rows.push({ ...s });
    }
  }
  return rows.map((r, i) => ({ ...r, color: PALETTE[i % PALETTE.length] }));
}

// Row series from raw per-sensor series. An average is taken at every
// timestamp any member reported, using each member's latest reading at or
// before that time (sensors report on their own grids). The band is the
// min–max spread across members — how much the probes disagree.
export function rowSeries(raw: Series, rows: SensorMeta[]): { series: Series; bands: Record<string, Band[]> } {
  const series: Series = {};
  const bands: Record<string, Band[]> = {};
  for (const r of rows) {
    if (r.members.length === 1) {
      series[r.id] = raw[r.members[0]] ?? [];
      continue;
    }
    const members = r.members.map((m) => raw[m] ?? []).filter((s) => s.length);
    const times = Array.from(new Set(members.flatMap((s) => s.map((p) => p.t)))).sort((a, b) => a - b);
    const avg: Reading[] = [];
    const band: Band[] = [];
    for (const t of times) {
      const vals = members
        .map((s) => readingAtWithin(s, t, MAX_GAP_MS))
        .filter((v): v is number => v != null);
      if (!vals.length) continue;
      avg.push({ t, v: vals.reduce((a, b) => a + b, 0) / vals.length });
      band.push({ t, lo: Math.min(...vals), hi: Math.max(...vals) });
    }
    series[r.id] = avg;
    bands[r.id] = band;
  }
  return { series, bands };
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

function readingAtWithin(series: Reading[], t: number, maxGap: number): number | null {
  if (!series.length || series[0].t > t) return null;
  let lo = 0, hi = series.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (series[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return t - series[lo].t <= maxGap ? series[lo].v : null;
}

export function fmt(v: number): string {
  const a = Math.abs(v);
  return v.toFixed(a >= 100 ? 0 : a >= 10 ? 1 : 2);
}
