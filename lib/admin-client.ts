"use client";

// Browser side of the fleet dashboard. Supabase Auth is used only to sign
// staff in; all data comes from /api/admin routes, which check the session
// and the fleet_admins allow-list on every request.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function adminAuth(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Admin sign-in isn't configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)");
    // Implicit flow: the emailed link comes back with the session in the URL
    // hash, which detectSessionInUrl picks up and stores.
    client = createClient(url, key, {
      auth: { persistSession: true, storageKey: "plant-health-ai-admin", flowType: "implicit", detectSessionInUrl: true },
    });
  }
  return client;
}

export class AdminError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function adminFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data } = await adminAuth().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AdminError("Sign in required", 401);
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new AdminError(body.error ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

export type FleetCamera = {
  id: string;
  serial: string | null;
  name: string;
  org_id: string | null;
  org_name: string | null;
  room_id: string | null;
  room_name: string | null;
  interval_sec: number;
  provisioned_at: string;
  claimed_at: string | null;
  revoked_at: string | null;
  last_seen_at: string | null;
  last_frame_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  notes: string | null;
  frames_24h: number;
  frames_7d: number;
  nova_insights_30d: number;
  nova_cost_30d: number | string;
};

export type FleetState = "capturing" | "gaps" | "offline" | "waiting" | "unclaimed" | "revoked";

const HOUR = 3600_000;

// Support's view of a camera's health. "gaps" = online but under 80% of the
// frames it should have sent in the last 24h (judged only after a full day).
export function fleetState(c: FleetCamera, now = Date.now()): { state: FleetState; label: string; tone: "ok" | "warn" | "alarm" | "idle"; rank: number } {
  if (c.revoked_at) return { state: "revoked", label: "Revoked", tone: "idle", rank: 5 };
  const seenAge = c.last_seen_at ? now - Date.parse(c.last_seen_at) : Infinity;
  const online = seenAge <= c.interval_sec * 3 * 1000;
  if (!c.org_id) return { state: "unclaimed", label: online ? "Unclaimed · online" : "Unclaimed", tone: "idle", rank: 4 };
  if (!online) return { state: c.last_frame_at ? "offline" : "waiting", label: c.last_frame_at ? "Offline" : "Never connected", tone: "alarm", rank: 0 };
  const expected = (24 * HOUR) / (c.interval_sec * 1000);
  const claimedLongEnough = c.claimed_at && now - Date.parse(c.claimed_at) > 24 * HOUR;
  if (claimedLongEnough && Number(c.frames_24h) < expected * 0.8) return { state: "gaps", label: "Missing frames", tone: "warn", rank: 1 };
  if (!c.last_frame_at) return { state: "waiting", label: "First frame soon", tone: "warn", rank: 2 };
  return { state: "capturing", label: "Capturing", tone: "ok", rank: 3 };
}

export const expectedPerDay = (c: FleetCamera) => Math.round(86400 / c.interval_sec);
