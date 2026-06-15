// Placeholder Nova content. Generates one journal entry per day from the
// frames + sensor series you already have, so the drawer feels real.
// When we wire the backend up, replace this with a fetch to /api/journal.

import type { JournalEntry, ChatTurn } from "../components/NovaDrawer";
import { Series, SENSORS } from "./sensors";

type Frame = { id: number; ts: number; storage_path: string };

function dayKey(ts: number) {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function avg(xs: number[]) {
  return xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
}

export function buildPlaceholderJournal(
  frames: Frame[],
  series: Series | null
): JournalEntry[] {
  if (!frames.length || !series) return [];

  // Group by local day.
  const byDay = new Map<string, Frame[]>();
  for (const f of frames) {
    const k = dayKey(f.ts);
    const arr = byDay.get(k) ?? [];
    arr.push(f);
    byDay.set(k, arr);
  }

  // Helper: pull this day's slice of any series.
  const dayValues = (key: keyof Series, start: number, end: number) =>
    series[key].filter((r) => r.t >= start && r.t <= end).map((r) => r.v);

  const days = Array.from(byDay.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  // Newest day first in the UI.
  return days.reverse().map(([day, fs], i) => {
    const start = fs[0].ts;
    const end = fs[fs.length - 1].ts;
    const temp = dayValues("air_temp", start, end);
    const rh = dayValues("humidity", start, end);
    const vpd = dayValues("vpd", start, end);
    const par = dayValues("par", start, end);
    const wc = dayValues("sub_moisture", start, end);

    const tempMax = Math.max(...temp);
    const tempMin = Math.min(...temp);
    const rhAvg = avg(rh);
    const vpdMax = Math.max(...vpd);
    const parPeak = Math.max(...par);
    const wcAvg = avg(wc);

    // Pick a couple of "interesting" timestamps to expose as jump-to buttons.
    const vpdPeakTs = series.vpd
      .filter((r) => r.t >= start && r.t <= end)
      .reduce((a, b) => (b.v > a.v ? b : a)).t;
    const wcLowTs = series.sub_moisture
      .filter((r) => r.t >= start && r.t <= end)
      .reduce((a, b) => (b.v < a.v ? b : a)).t;

    // Headline + body shaped by what was extreme that day.
    const variants = [
      {
        headline: "Steady canopy, no visible stress",
        body: `Air ${tempMin.toFixed(0)}–${tempMax.toFixed(0)} °F with average RH ${rhAvg.toFixed(0)}%. VPD peaked at ${vpdMax.toFixed(2)} kPa midday. Leaves held angle through the photoperiod, no curling or drooping. Substrate held around ${wcAvg.toFixed(0)}% — irrigation cadence looks dialed in.`,
        tags: ["growth", "environment"] as JournalEntry["tags"],
      },
      {
        headline: "VPD spike near peak light — worth watching",
        body: `Temp climbed to ${tempMax.toFixed(0)} °F and VPD touched ${vpdMax.toFixed(2)} kPa for ~40 minutes. A few upper-canopy leaves showed mild taco shape in afternoon frames but recovered after lights dimmed. If this recurs tomorrow, consider raising RH 3–4 points during peak.`,
        tags: ["stress", "environment"] as JournalEntry["tags"],
      },
      {
        headline: "Healthy growth, slight stretch overnight",
        body: `Canopy is ~1.5–2 cm taller than yesterday's frame at the same time of day, concentrated in the back-right corner. No discoloration. PAR peaked at ${parPeak.toFixed(0)} µmol — within target. Substrate moisture trough at ${Math.min(...wc).toFixed(0)}% just before lights-on, which is right where we want it for a dryback.`,
        tags: ["growth", "light"] as JournalEntry["tags"],
      },
    ];
    const v = variants[i % variants.length];

    const highlights: JournalEntry["highlights"] = [
      { ts: vpdPeakTs, label: `VPD peak ${new Date(vpdPeakTs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` },
      { ts: wcLowTs,   label: `Dryback ${new Date(wcLowTs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` },
    ];

    return {
      id: day,
      day,
      headline: v.headline,
      body: v.body,
      highlights,
      tags: v.tags,
    };
  });
}

// Canned "Ask Nova" responses for the placeholder phase.
export function placeholderAsk(question: string): Promise<string> {
  const q = question.toLowerCase();
  const reply =
    /vpd/.test(q)
      ? "VPD was highest yesterday between 2:10 and 2:50 PM, peaking at 1.62 kPa. The canopy showed mild taco-shape in those frames; it relaxed within an hour of lights dimming. I'd watch tomorrow's afternoon window."
      : /stress|curl|droop/.test(q)
      ? "I haven't seen sustained stress this week. The closest moment was yesterday afternoon (see the VPD peak highlight). Leaves recovered by evening, so I'd call it transient, not chronic."
      : /growth|canopy|stretch/.test(q)
      ? "Canopy is up roughly 4 cm from 7 days ago, with most of the gain in the back-right quadrant. No abnormal stretching — internodes look tight."
      : /irrigation|water|dryback/.test(q)
      ? "Substrate moisture is cycling between 58% and 64%, drybacks landing right before lights-on. That's a healthy pattern for this stage."
      : "I'd need to look at the full data window to answer that well. Once my backend is wired up, I'll be able to reason about the frames and sensor history together.";
  return new Promise((resolve) => setTimeout(() => resolve(reply), 700));
}
