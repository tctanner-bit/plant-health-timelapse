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
const KEY = "growlink-api-key";
export const loadApiKey = () => {
  try { return sessionStorage.getItem(KEY); } catch { return null; }
};
export const saveApiKey = (k: string | null) => {
  try { k ? sessionStorage.setItem(KEY, k) : sessionStorage.removeItem(KEY); } catch {}
};

export type LatestFrame = { id: number; ts: number; url: string };

// Every camera's newest frame, signed, in one call. Used by the facility view.
export const latestFrames = (key: string, orgId: string) =>
  call<{ frames: Record<string, LatestFrame> }>(key, `/api/orgs/${orgId}/latest-frames`).then((r) => r.frames);
