// Browser-side client for our own API routes. Every call carries the LABS
// access token; the server checks the person's membership of the site before
// touching data. Growlink data comes through the server too (the site's key
// never reaches the browser).

import { accessToken } from "./labs-client";
import { appPath } from "./labs";
import type { Room, Sensor, ChartResponse, LiveReading, Uom } from "./growlink";

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

// Errors carry the HTTP status; 402 means the org's trial ended unpaid.
export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

// Screens listen for this to switch to the Billing tab.
export const BILLING_REQUIRED_EVENT = "phai:billing-required";

function clientTz(): string | null {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null; } catch { return null; }
}

// Screens listen for this to send the person to the LABS sign-in.
export const SIGN_IN_REQUIRED_EVENT = "phai:sign-in-required";

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await accessToken();
  if (!token) {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(SIGN_IN_REQUIRED_EVENT));
    throw new ApiError("Sign in to Growlink LABS", 401);
  }
  const res = await fetch(appPath(path), {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      // For server-side daily reviews: when this org's day ends.
      ...(clientTz() ? { "X-Client-TZ": clientTz()! } : {}),
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 402 && typeof window !== "undefined") window.dispatchEvent(new Event(BILLING_REQUIRED_EVENT));
    if (res.status === 401 && data.signIn && typeof window !== "undefined") window.dispatchEvent(new Event(SIGN_IN_REQUIRED_EVENT));
    throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status);
  }
  return data as T;
}

const base = (orgId: string) => `/api/orgs/${orgId}/cameras`;

export const listCameras = (orgId: string) =>
  call<{ cameras: Camera[] }>(base(orgId)).then((r) => r.cameras);

export const claimCamera = (orgId: string, body: { code: string; roomId: string; name: string }) =>
  call<{ camera: Camera }>(`${base(orgId)}/claim`, { method: "POST", body }).then((r) => r.camera);

export const updateCamera = (orgId: string, id: string, body: Partial<{ roomId: string; name: string; sensors: string[]; averageSameType: boolean }>) =>
  call<{ camera: Camera }>(`${base(orgId)}/${id}`, { method: "PATCH", body }).then((r) => r.camera);

export const revokeCamera = (orgId: string, id: string) =>
  call<{ camera: Camera }>(`${base(orgId)}/${id}`, { method: "DELETE" }).then((r) => r.camera);

export const listFrames = (orgId: string, id: string, start?: number, end?: number) => {
  const q = new URLSearchParams();
  if (start != null) q.set("start", String(Math.floor(start)));
  if (end != null) q.set("end", String(Math.ceil(end)));
  return call<FramesResponse>(`${base(orgId)}/${id}/frames?${q}`);
};

// Small (~640 px) copies by default, for tiles and playback; "full" for a
// paused frame.
export const signFrames = (orgId: string, id: string, ids: number[], size: "small" | "full" = "small") =>
  call<{ urls: Record<number, string> }>(`${base(orgId)}/${id}/frame-urls`, { method: "POST", body: { ids, size } }).then((r) => r.urls);

export type LatestFrame = { id: number; ts: number; url: string; fetchedAt?: number };

// Every camera's newest frame, signed, in one call. Used by the facility view.
export const latestFrames = (orgId: string) =>
  call<{ frames: Record<string, LatestFrame> }>(`/api/orgs/${orgId}/latest-frames`).then((r) => r.frames);

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
  kind: "daily" | "moment" | "range" | "alert";
  periodStart: number;
  periodEnd: number;
  day: string | null;
  question: string | null;
  status: "queued" | "running" | "ready" | "failed";
  headline: string | null;
  concern: "none" | "watch" | "action" | null;
  confidence: "low" | "medium" | "high" | null;
  observations: InsightObservation[];
  suggestions: string[];
  frames: InsightFrame[];
  error: string | null;
  createdAt: string;
  trigger: { kind: string; label: string; detail?: string } | null;
};
export type LatestInsight = { id: string; kind: string; concern: string | null; headline: string | null; createdAt: string };

const tz = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return undefined; }
};

export const listInsights = (orgId: string, cameraId: string) =>
  call<{ insights: Insight[] }>(`${base(orgId)}/${cameraId}/insights`).then((r) => r.insights);

// A completed local day, e.g. yesterday: start/end are local midnights.
export const requestDailyInsight = (
  orgId: string, cameraId: string,
  day: { label: string; start: number; end: number }, uom?: unknown
) =>
  call<{ insight: Insight }>(`${base(orgId)}/${cameraId}/insights`, {
    method: "POST",
    body: { kind: "daily", day: day.label, start: day.start, end: day.end, tz: tz(), uom },
  }).then((r) => r.insight);

export const requestMomentInsight = (
  orgId: string, cameraId: string, at: number, question?: string, uom?: unknown
) =>
  call<{ insight: Insight }>(`${base(orgId)}/${cameraId}/insights`, {
    method: "POST",
    body: { kind: "moment", at, question, tz: tz(), uom },
  }).then((r) => r.insight);

// Whatever period is selected in the player (an hour … a month).
export const requestRangeInsight = (
  orgId: string, cameraId: string, start: number, end: number, question?: string, uom?: unknown
) =>
  call<{ insight: Insight }>(`${base(orgId)}/${cameraId}/insights`, {
    method: "POST",
    body: { kind: "range", start, end, question, tz: tz(), uom },
  }).then((r) => r.insight);

export const latestInsights = (orgId: string) =>
  call<{ latest: Record<string, LatestInsight> }>(`/api/orgs/${orgId}/insights/latest`).then((r) => r.latest);

// ------------------------------------------------------------------ billing

export type Billing = {
  entitled: boolean;
  state: "comp" | "trial" | "subscribed" | "past_due" | "expired";
  trialEndsAt: number;
  daysLeft: number | null;
  configured: boolean;
  trialDays: number;
  cameras: number;
  price: { unitAmount: number; currency: string } | null;
  subscription: {
    status: string | null;
    quantity: number | null;
    currentPeriodEnd: number | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  canManage: boolean;
  card: { brand: string; last4: string; expMonth: number; expYear: number } | null;
};

export const getBilling = (orgId: string) => call<Billing>(`/api/orgs/${orgId}/billing`);

// Both return a Stripe-hosted URL, opened in a new tab.
export const startCheckout = (orgId: string) =>
  call<{ url: string }>(`/api/orgs/${orgId}/billing/checkout`, { method: "POST", body: {} }).then((r) => r.url);
export const openBillingPortal = (orgId: string) =>
  call<{ url: string }>(`/api/orgs/${orgId}/billing/portal`, { method: "POST", body: {} }).then((r) => r.url);

// Subscribe with the card the org already pays Growlink with.
export const subscribeWithCardOnFile = (orgId: string) =>
  call<{ ok: true }>(`/api/orgs/${orgId}/billing/subscribe`, { method: "POST", body: {} });
export const setCancelAtPeriodEnd = (orgId: string, cancel: boolean) =>
  call<{ ok: true }>(`/api/orgs/${orgId}/billing/cancel`, { method: "POST", body: { resume: !cancel } });

// ------------------------------------------------------------------- sites

export type SiteSummary = { orgId: string; name: string; role: "owner" | "viewer"; keyStatus: "ok" | "rejected" | "missing" };

export const listSites = () => call<{ user: { email: string | null }; sites: SiteSummary[] }>("/api/sites");

/** Connect a Growlink org with an org-admin key; may ask which org first. */
export const connectSite = (apiKey: string, orgId?: string) =>
  call<{ site?: SiteSummary; choose?: { id: string; name: string }[] }>("/api/sites", { method: "POST", body: { apiKey, orgId } });

export type SiteSettings = {
  name: string;
  role: "owner" | "viewer";
  me: string;
  key: { status: "ok" | "rejected" | "missing"; hint: string | null; error: string | null; checkedAt: string | null };
  monitoring: { enabled: boolean; alertsPerDay: number; tz: string | null };
  members: { userId: string; email: string | null; role: "owner" | "viewer"; addedAt: string }[];
  invites: { id: string; email: string; role: "owner" | "viewer"; created_at: string }[];
};
export const getSite = (orgId: string) => call<SiteSettings>(`/api/orgs/${orgId}/site`);
export const siteAction = (orgId: string, body: Record<string, unknown>) =>
  call<{ ok: true }>(`/api/orgs/${orgId}/site`, { method: "POST", body });

// ----------------------------------------------------------- Growlink data

const gl = <T>(orgId: string, body: Record<string, unknown>) =>
  call<T>(`/api/orgs/${orgId}/growlink`, { method: "POST", body });

export const getRooms = (orgId: string) => gl<{ rooms: Room[] }>(orgId, { op: "rooms" }).then((r) => r.rooms);
export const getSensors = (orgId: string, roomId: string) =>
  gl<{ sensors: Sensor[] }>(orgId, { op: "sensors", roomId }).then((r) => r.sensors);
export const getSensorChart = (orgId: string, sensorIds: string[], start: number, end: number, uom?: Uom) =>
  gl<{ chart: ChartResponse }>(orgId, { op: "chart", sensorIds, start, end, uom }).then((r) => r.chart);
export const getLiveSensors = (orgId: string, sensorIds: string[], uom?: Uom) =>
  sensorIds.length ? gl<{ readings: LiveReading[] }>(orgId, { op: "live", sensorIds, uom }).then((r) => r.readings) : Promise.resolve([]);
