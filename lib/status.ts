import type { Camera } from "./api";

export type Tone = "ok" | "warn" | "alarm" | "idle";

// A camera is online if it has checked in within three capture intervals.
export function cameraStatus(c: Camera, now = Date.now()): { label: string; tone: Tone; rank: number } {
  if (c.revoked) return { label: "Revoked", tone: "idle", rank: 3 };
  const seenAge = c.lastSeenAt ? now - new Date(c.lastSeenAt).getTime() : Infinity;
  const online = seenAge <= c.intervalSec * 3 * 1000;
  if (!c.lastFrameAt)
    return online ? { label: "First frame soon", tone: "warn", rank: 1 } : { label: "Waiting", tone: "warn", rank: 1 };
  return online ? { label: "Capturing", tone: "ok", rank: 2 } : { label: "Offline", tone: "alarm", rank: 0 };
}

export function ago(iso: string | number | null, now = Date.now()): string {
  if (iso == null) return "never";
  const s = Math.round((now - new Date(iso).getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
