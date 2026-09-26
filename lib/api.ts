// Browser-side client for our own API routes. Every call carries the user's
// Growlink key; the server checks it against the org before touching data.

export type Camera = {
  id: string;
  roomId: string;
  name: string;
  serial: string | null;
  intervalSec: number;
  tokenHint: string;
  createdAt: string;
  claimedAt: string | null;
  lastFrameAt: string | null;
  lastSeenAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  revoked: boolean;
  sensors: string[]; // Growlink sensor ids from the camera's room, display order
  averageSameType: boolean; // show same-type sensors as one room average
};

export type FramesResponse = {
  frames: { id: number; ts: number }[];
  first: number | null;
  last: number | null;
  truncated: boolean;
};

async function call<T>(apiKey: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: {
      "X-Growlink-Key": apiKey,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

const base = (orgId: string) => `/api/orgs/${orgId}/cameras`;

export const listCameras = (key: string, orgId: string) =>
  call<{ cameras: Camera[] }>(key, base(orgId)).then((r) => r.cameras);

export const claimCamera = (key: string, orgId: string, body: { code: string; roomId: string; name: string }) =>
  call<{ camera: Camera }>(key, `${base(orgId)}/claim`, { method: "POST", body }).then((r) => r.camera);

export const updateCamera = (key: string, orgId: string, id: string, body: Partial<{ roomId: string; name: string; sensors: string[]; averageSameType: boolean }>) =>
  call<{ camera: Camera }>(key, `${base(orgId)}/${id}`, { method: "PATCH", body }).then((r) => r.camera);

export const revokeCamera = (key: string, orgId: string, id: string) =>
  call<{ camera: Camera }>(key, `${base(orgId)}/${id}`, { method: "DELETE" }).then((r) => r.camera);

export const listFrames = (key: string, orgId: string, id: string, start?: number, end?: number) => {
  const q = new URLSearchParams();
  if (start != null) q.set("start", String(Math.floor(start)));
  if (end != null) q.set("end", String(Math.ceil(end)));
  return call<FramesResponse>(key, `${base(orgId)}/${id}/frames?${q}`);
};

export const signFrames = (key: string, orgId: string, id: string, ids: number[]) =>
  call<{ urls: Record<number, string> }>(key, `${base(orgId)}/${id}/frame-urls`, { method: "POST", body: { ids } }).then((r) => r.urls);

// The API key lives in sessionStorage only — forgotten when the tab closes.
// Opened from Growlink Builder, the portal supplies it (see takeBuilderKey),
// so users there never type it.
const KEY = "growlink-api-key";
const FROM_BUILDER = "growlink-key-from-builder";
export const loadApiKey = () => {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
};
export const saveApiKey = (k: string | null) => {
  try {
    k ? sessionStorage.setItem(KEY, k) : sessionStorage.removeItem(KEY);
    if (!k) sessionStorage.removeItem(FROM_BUILDER);
  } catch {}
};

// Growlink's portal launches Growlink-authored apps already signed in: a hosted
// app gets the user's key as ?apiKey=… on its frame URL, a single-file app gets
// window.GROWLINK_API_KEY (the portal's injectAppRuntime contract). Take it,
// keep it for this tab, and scrub it from the address bar so it doesn't linger
// in history or get copied along with a link.
export function takeBuilderKey(): string | null {
  const url = new URL(window.location.href);
  const fromUrl = url.searchParams.get("apiKey")?.trim();
  const injected = (window as unknown as { GROWLINK_API_KEY?: unknown }).GROWLINK_API_KEY;
  const key = fromUrl || (typeof injected === "string" && injected.trim()) || null;
  if (fromUrl) {
    url.searchParams.delete("apiKey");
    window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
  }
  if (key) {
    saveApiKey(key);
    try { sessionStorage.setItem(FROM_BUILDER, "1"); } catch {}
  }
  return key;
}

export const signedInByBuilder = () => {
  try { return sessionStorage.getItem(FROM_BUILDER) === "1"; } catch { return false; }
};

export type LatestFrame = { id: number; ts: number; url: string; fetchedAt?: number };

// Every camera's newest frame, signed, in one call. Used by the facility view.
export const latestFrames = (key: string, orgId: string) =>
  call<{ frames: Record<string, LatestFrame> }>(key, `/api/orgs/${orgId}/latest-frames`).then((r) => r.frames);

// ------------------------------------------------------------ Nova insights

export type InsightFrame = { id: number; ts: number; label: string; role?: string };
export type InsightObservation = {
  text: string;
  category: string;
  concern: "none" | "watch" | "action";
  frames: InsightFrame[];
  sensors: string[];
};
export type Insight = {
  id: string;
  cameraId: string;
  kind: "daily" | "moment" | "range";
  periodStart: number;
  periodEnd: number;
  day: string | null;
  question: string | null;
  status: "running" | "ready" | "failed";
  headline: string | null;
  concern: "none" | "watch" | "action" | null;
  confidence: "low" | "medium" | "high" | null;
  observations: InsightObservation[];
  suggestions: string[];
  frames: InsightFrame[];
  error: string | null;
  createdAt: string;
};
export type LatestInsight = { id: string; kind: string; concern: string | null; headline: string | null; createdAt: string };

const tz = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
};

export const listInsights = (key: string, orgId: string, cameraId: string) =>
  call<{ insights: Insight[] }>(key, `${base(orgId)}/${cameraId}/insights`).then((r) => r.insights);

// A completed local day, e.g. yesterday: start/end are local midnights.
export const requestDailyInsight = (
  key: string, orgId: string, cameraId: string,
  day: { label: string; start: number; end: number }, uom?: unknown
) =>
  call<{ insight: Insight }>(key, `${base(orgId)}/${cameraId}/insights`, {
    method: "POST",
    body: { kind: "daily", day: day.label, start: day.start, end: day.end, tz: tz(), uom },
  }).then((r) => r.insight);

export const requestMomentInsight = (
  key: string, orgId: string, cameraId: string, at: number, question?: string, uom?: unknown
) =>
  call<{ insight: Insight }>(key, `${base(orgId)}/${cameraId}/insights`, {
    method: "POST",
    body: { kind: "moment", at, question, tz: tz(), uom },
  }).then((r) => r.insight);

// Whatever period is selected in the player (an hour … a month).
export const requestRangeInsight = (
  key: string, orgId: string, cameraId: string, start: number, end: number, question?: string, uom?: unknown
) =>
  call<{ insight: Insight }>(key, `${base(orgId)}/${cameraId}/insights`, {
    method: "POST",
    body: { kind: "range", start, end, question, tz: tz(), uom },
  }).then((r) => r.insight);

export const latestInsights = (key: string, orgId: string) =>
  call<{ latest: Record<string, LatestInsight> }>(key, `/api/orgs/${orgId}/insights/latest`).then((r) => r.latest);
