// Server-only Supabase client. Holds the service-role key, so it must never be
// imported from a "use client" file. Every route that uses it checks org
// membership first (see ./auth.ts) and filters every query by org_id.

import { createClient, SupabaseClient } from "@supabase/supabase-js";

export const FRAMES_BUCKET = "camera-frames";

let client: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (typeof window !== "undefined") throw new Error("server-only module");
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
