// Cheap measurements of a frame for the background watchers: brightness,
// whether it's grey-scale (night / infrared), and a 32×18 luma thumbnail to
// compare frames. No AI involved.

import sharp from "sharp";

export type FrameStats = { brightness: number; ir: boolean; thumb: Uint8Array };

const W = 32;
const H = 18;

export async function frameStats(jpeg: Buffer): Promise<FrameStats> {
  const { data } = await sharp(jpeg).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const thumb = new Uint8Array(W * H);
  let sum = 0;
  let spread = 0;
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    const y = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    thumb[i] = y;
    sum += y;
    spread += Math.max(r, g, b) - Math.min(r, g, b);
  }
  const n = W * H;
  return { brightness: sum / n, ir: spread / n < 6, thumb };
}

export const encodeThumb = (t: Uint8Array) => Buffer.from(t).toString("base64");
export const decodeThumb = (s: string) => new Uint8Array(Buffer.from(s, "base64"));

export type Lights = "on" | "off" | "dim";
export function lightsFrom(s: { brightness: number; ir: boolean }): Lights {
  if (s.ir || s.brightness < 25) return "off";
  if (s.brightness > 55) return "on";
  return "dim";
}

/**
 * How different two frames look, ignoring overall exposure: mean absolute
 * difference of brightness-normalized thumbnails, as a fraction (0 = same).
 */
export function visualDifference(a: Uint8Array, b: Uint8Array): number {
  const mean = (t: Uint8Array) => t.reduce((s, v) => s + v, 0) / t.length || 1;
  const ma = mean(a);
  const mb = mean(b);
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] / ma - b[i] / mb);
  return d / a.length;
}
