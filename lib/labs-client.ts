"use client";

// The LABS login in the browser. Same Supabase project, URL, publishable key
// and storage key as labs.growlink.io's own pages, so a LABS sign-in anywhere
// on that origin signs you in here too, and signing out here signs you out
// of LABS.

import { createClient, Session, SupabaseClient } from "@supabase/supabase-js";
import { BASE_PATH, LABS_PUBLISHABLE_KEY, LABS_STORAGE_KEY, LABS_SUPABASE_URL } from "./labs";

let client: SupabaseClient | null = null;
export function labs(): SupabaseClient {
  client ??= createClient(LABS_SUPABASE_URL, LABS_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: LABS_STORAGE_KEY },
  });
  return client;
}

/** A current access token (refreshed by supabase-js when needed), or null. */
export async function accessToken(): Promise<string | null> {
  const { data } = await labs().auth.getSession();
  return data.session?.access_token ?? null;
}

export function onSessionChange(cb: (s: Session | null) => void) {
  const { data } = labs().auth.onAuthStateChange((_e, s) => setTimeout(() => cb(s), 0));
  return () => data.subscription.unsubscribe();
}

// The page the person should come back to: the LABS viewer when we're framed
// inside it (/app/plant-health/), else this app.
function returnPath(): string {
  try {
    if (window.top && window.top !== window && window.top.location.origin === window.location.origin)
      return window.top.location.pathname + window.top.location.search;
  } catch {}
  return window.location.pathname + window.location.search;
}

/** Off to the LABS account page (sign-in / sign-up), then back here. */
export function goToLabsAccount() {
  const url = `/account/?next=${encodeURIComponent(returnPath())}`;
  try {
    if (window.top && window.top !== window) {
      window.top.location.href = url;
      return;
    }
  } catch {}
  window.location.href = url;
}

/** On a host that isn't LABS (the bare Vercel URL), the LABS session isn't here. */
export function onLabsOrigin(): boolean {
  const h = window.location.hostname;
  return h === "labs.growlink.io" || h === "localhost" || h === "127.0.0.1";
}

export const appHome = () => `${BASE_PATH}/`;
