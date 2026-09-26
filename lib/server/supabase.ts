// Server-only Supabase client. Holds the service-role key, so it must never be
// imported from a "use client" file. Every route that uses it checks org
// membership first (see ./auth.ts) and filters every query by org_id.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const FRAMES_BUCKET = "camera-frames";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (typeof window !== "undefined") throw new Error("server-only module");
  if (!client) {
    // The project URL isn't secret; fall back to the prototype's public variable.
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    // Next 14 caches server-side fetch() calls (GETs and POSTs alike) in its
    // Data Cache, which outlives deployments on Vercel. Without no-store,
    // "newest frame" and camera status queries kept returning one stale
    // answer, and cached signed URLs expired into broken images.
    client = createClient(url, key, {
      auth: { persistSession: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    });
  }
  return client;
}
