// Stand-in for Nova until the Claude backend is wired up.
//
// With real customer data on screen, canned prose with invented numbers would
// be misleading, so the journal here is strictly factual: one entry per day
// with the observed range of each loaded sensor, plus jump-to moments at the
// VPD peak and the substrate dryback low when those sensors exist. Replace
// with a fetch to /api/journal once Nova can look at the frames.

import type { JournalEntry } from "../components/NovaDrawer";
import { SensorMeta, Series, fmt } from "./sensors";

type Frame = { id: number; ts: number };

const METRIC_VPD = 8;
const METRIC_WATER_CONTENT = 9;

function dayKey(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const timeLabel = (ts: number) =>
  new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

export function buildPlaceholderJournal(
  frames: Frame[],
  series: Series | null,
  sensors: SensorMeta[]
): JournalEntry[] {
  if (!frames.length) return [];

  const byDay = new Map<string, Frame[]>();
  for (const f of frames) {
    const k = dayKey(f.ts);
    byDay.set(k, [...(byDay.get(k) ?? []), f]);
  }

  const days = Array.from(byDay.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  return days.map(([day, fs]) => {
    const start = fs[0].ts;
    const end = fs[fs.length - 1].ts;
    const slice = (id: string) => (series?.[id] ?? []).filter((r) => r.t >= start && r.t <= end);

    const lines: string[] = [];
    const highlights: JournalEntry["highlights"] = [];
    for (const s of sensors) {
      const rs = slice(s.id);
      if (!rs.length) continue;
      const lo = rs.reduce((a, b) => (b.v < a.v ? b : a));
      const hi = rs.reduce((a, b) => (b.v > a.v ? b : a));
      lines.push(`${s.label}: ${fmt(lo.v)}–${fmt(hi.v)} ${s.unit}`.trim());
      if (s.metric === METRIC_VPD && !highlights.some((h) => h.label.startsWith("VPD")))
        highlights.push({ ts: hi.t, label: `VPD peak ${timeLabel(hi.t)}` });
      if (s.metric === METRIC_WATER_CONTENT && !highlights.some((h) => h.label.startsWith("Dryback")))
        highlights.push({ ts: lo.t, label: `Dryback low ${timeLabel(lo.t)}` });
    }

    return {
      id: day,
      day,
      headline: `${fs.length} frames, ${timeLabel(start)}–${timeLabel(end)}`,
      body: lines.length
        ? lines.join(". ") + "."
        : "No sensor data loaded for this day. Toggle sensors on below the player to include them.",
      highlights,
      tags: ["environment"],
    };
  });
}

export function placeholderAsk(_question: string): Promise<string> {
  return new Promise((resolve) =>
    setTimeout(
      () =>
        resolve(
          "Nova isn't connected to this timelapse yet. Once it is, I'll be able to look at the frames and the room's sensor history together to answer questions like this."
        ),
      400
    )
  );
}
