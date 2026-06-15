// Placeholder sensor data. Generates a believable 24-hour curve for each
// channel, sampled at the same instants as the frames. When Growlink is
// wired in, replace `generateFakeSeries` with a real fetch; the shape
// (timestamp + value per channel) stays the same.

export type SensorKey =
  | "air_temp"
  | "humidity"
  | "vpd"
  | "co2"
  | "par"
  | "leaf_temp"
  | "sub_moisture"
  | "sub_ec"
  | "root_temp";

export type SensorMeta = {
  key: SensorKey;
  label: string;
  short: string;
  unit: string;
  decimals: number;
  color: string;
  group: "air" | "light" | "substrate";
};

export const SENSORS: SensorMeta[] = [
  { key: "air_temp",     label: "Air temperature",   short: "Temp", unit: "°F",    decimals: 1, color: "#ef9f27", group: "air" },
  { key: "humidity",     label: "Relative humidity", short: "RH",   unit: "%",     decimals: 0, color: "#378add", group: "air" },
  { key: "vpd",          label: "VPD",               short: "VPD",  unit: "kPa",   decimals: 2, color: "#7f77dd", group: "air" },
  { key: "co2",          label: "CO\u2082",          short: "CO\u2082", unit: "ppm", decimals: 0, color: "#b4b2a9", group: "air" },
  { key: "par",          label: "PAR (light)",       short: "PAR",  unit: "\u00b5mol", decimals: 0, color: "#97c459", group: "light" },
  { key: "leaf_temp",    label: "Leaf temperature",  short: "Leaf", unit: "°F",    decimals: 1, color: "#d85a30", group: "air" },
  { key: "sub_moisture", label: "Substrate moisture", short: "WC",  unit: "%",     decimals: 1, color: "#1d9e75", group: "substrate" },
  { key: "sub_ec",       label: "Substrate EC",      short: "EC",   unit: "mS/cm", decimals: 2, color: "#d4537e", group: "substrate" },
  { key: "root_temp",    label: "Root-zone temp",    short: "Root", unit: "°F",    decimals: 1, color: "#e24b4a", group: "substrate" },
];

export type Reading = { t: number; v: number };
export type Series = Record<SensorKey, Reading[]>;

function hash(t: number, salt: number) {
  const x = Math.sin(t * 0.0001 + salt * 7.13) * 43758.5453;
  return x - Math.floor(x);
}

function tod(ts: number) {
  const d = new Date(ts);
  return (d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600) / 24;
}

function lightsOn(ts: number) {
  const h = tod(ts) * 24;
  return h >= 6 && h < 22;
}

function valueFor(key: SensorKey, ts: number): number {
  const h = tod(ts) * 24;
  const wave = Math.sin(((h - 6) / 24) * Math.PI * 2);
  const lit = lightsOn(ts);
  const drift = hash(ts, key.length) * 2 - 1;

  switch (key) {
    case "air_temp":
      return (lit ? 76 : 68) + wave * 3 + drift * 0.6;
    case "humidity":
      return (lit ? 58 : 68) - wave * 4 + drift * 1.5;
    case "vpd": {
      const tF = (lit ? 76 : 68) + wave * 3;
      const rh = (lit ? 58 : 68) - wave * 4;
      const tC = ((tF - 32) * 5) / 9;
      const es = 0.61078 * Math.exp((17.27 * tC) / (tC + 237.3));
      return Math.max(0, es * (1 - rh / 100) + drift * 0.03);
    }
    case "co2":
      return (lit ? 1000 : 450) + wave * 80 + drift * 30;
    case "par":
      return lit ? Math.max(0, 900 + wave * 200 + drift * 40) : 0;
    case "leaf_temp":
      return (lit ? 74 : 67) + wave * 2.5 + drift * 0.5;
    case "sub_moisture": {
      const pulse = lit && Math.floor(h * 0.5) % 1 === 0 ? Math.max(0, 4 - (h % 2) * 3) : 0;
      return 62 + pulse + drift * 0.4;
    }
    case "sub_ec":
      return 3.0 + wave * 0.2 + drift * 0.05;
    case "root_temp":
      return 70 + wave * 1.5 + drift * 0.3;
  }
}

export function generateFakeSeries(frameTimestamps: number[]): Series {
  const out = {} as Series;
  for (const s of SENSORS) {
    out[s.key] = frameTimestamps.map((t) => ({ t, v: valueFor(s.key, t) }));
  }
  return out;
}

export function readingAt(series: Reading[], t: number): number | null {
  if (!series.length) return null;
  let lo = 0, hi = series.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = series[Math.max(0, lo - 1)];
  const b = series[lo];
  return Math.abs(a.t - t) < Math.abs(b.t - t) ? a.v : b.v;
}
