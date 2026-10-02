// Sites: one connected Growlink organization each, with members (LABS users)
// and the org's Growlink API key in Vault. The key never leaves the server.

import { createClient, SupabaseClient, User } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { db } from "./supabase";
import { LABS_PUBLISHABLE_KEY, LABS_SUPABASE_URL } from "../labs";

export type Role = "owner" | "viewer";

export type SiteRow = {
  id: string;
  growlink_org_id: string;
  name: string;
  key_secret_id: string | null;
  key_hint: string | null;
  key_status: "ok" | "rejected" | "missing";
  key_error: string | null;
  key_checked_at: string | null;
  monitoring_enabled: boolean;
  tz: string | null;
  created_by: string;
  created_at: string;
};

export const SITE_COLUMNS =
  "id, growlink_org_id, name, key_secret_id, key_hint, key_status, key_error, key_checked_at, monitoring_enabled, tz, created_by, created_at";

// ------------------------------------------------------------ LABS sign-in

let labs: SupabaseClient | null = null;
function labsAuth(): SupabaseClient {
  // Auth calls must never be served from Next's fetch cache.
  labs ??= createClient(LABS_SUPABASE_URL, LABS_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
  });
  return labs;
}

export type LabsUser = { id: string; email: string | null; emailVerified: boolean };

const userCache = new Map<string, { user: LabsUser | null; exp: number }>();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** The LABS account behind an access token, or null. Cached 60 s per token. */
export async function labsUser(token: string): Promise<LabsUser | null> {
  const h = sha(token);
  const hit = userCache.get(h);
  if (hit && hit.exp > Date.now()) return hit.user;
  const { data, error } = await labsAuth().auth.getUser(token);
  const u: User | null = error ? null : data.user;
  const user = u ? { id: u.id, email: u.email?.toLowerCase() ?? null, emailVerified: !!u.email_confirmed_at } : null;
  userCache.set(h, { user, exp: Date.now() + 60_000 });
  if (userCache.size > 5000) userCache.clear();
  return user;
}

// ------------------------------------------------------------ memberships

/** Turn any invitations for this verified email into memberships. */
export async function acceptInvites(user: LabsUser): Promise<void> {
  if (!user.email || !user.emailVerified) return;
  const { data: invites } = await db().from("site_invites").select("id, site_id, role, invited_by").eq("email", user.email);
  for (const inv of invites ?? []) {
    await db()
      .from("site_members")
      .upsert(
        { site_id: inv.site_id, user_id: user.id, email: user.email, role: inv.role, added_by: inv.invited_by },
        { onConflict: "site_id,user_id", ignoreDuplicates: true }
      );
    await db().from("site_invites").delete().eq("id", inv.id);
  }
}

export async function sitesFor(userId: string) {
  const { data } = await db()
    .from("site_members")
    .select(`role, sites(${SITE_COLUMNS})`)
    .eq("user_id", userId);
  return (data ?? [])
    .map((m: any) => ({ role: m.role as Role, site: m.sites as SiteRow }))
    .filter((m) => m.site)
    .sort((a, b) => a.site.name.localeCompare(b.site.name));
}

export async function membership(userId: string, orgId: string): Promise<{ role: Role; site: SiteRow } | null> {
  const { data: site } = await db().from("sites").select(SITE_COLUMNS).eq("growlink_org_id", orgId).maybeSingle();
  if (!site) return null;
  const { data: m } = await db()
    .from("site_members")
    .select("role")
    .eq("site_id", site.id)
    .eq("user_id", userId)
    .maybeSingle();
  return m ? { role: m.role as Role, site: site as SiteRow } : null;
}

export async function siteForOrg(orgId: string): Promise<SiteRow | null> {
  const { data } = await db().from("sites").select(SITE_COLUMNS).eq("growlink_org_id", orgId).maybeSingle();
  return (data as SiteRow) ?? null;
}

// --------------------------------------------------------------- the key

const keyCache = new Map<string, { key: string | null; exp: number }>();

/** The site's Growlink key from Vault (cached 60 s), or null. */
export async function siteKey(siteId: string): Promise<string | null> {
  const hit = keyCache.get(siteId);
  if (hit && hit.exp > Date.now()) return hit.key;
  const { data, error } = await db().rpc("get_site_key", { p_site: siteId });
  const key = error ? null : ((data as string | null) ?? null);
  keyCache.set(siteId, { key, exp: Date.now() + 60_000 });
  return key;
}

export async function storeSiteKey(siteId: string, apiKey: string) {
  const { error } = await db().rpc("set_site_key", { p_site: siteId, p_key: apiKey, p_hint: apiKey.slice(-4) });
  if (error) throw new Error("Could not store the key");
  keyCache.delete(siteId);
}

/** Growlink rejected the key: delete it and tell owners to reconnect. */
export async function rejectSiteKey(siteId: string, message = "Growlink rejected the key") {
  await db().rpc("clear_site_key", { p_site: siteId, p_status: "rejected", p_error: message.slice(0, 300) });
  keyCache.delete(siteId);
}

export async function removeSiteKey(siteId: string) {
  await db().rpc("clear_site_key", { p_site: siteId, p_status: "missing", p_error: null });
  keyCache.delete(siteId);
}

export async function markKeyUsed(siteId: string) {
  await db().from("sites").update({ key_checked_at: new Date().toISOString() }).eq("id", siteId);
}

// --------------------------------------------------------------- time zone

const TZ = /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$/;
/** Keep the site's time zone (for server-side daily reviews) from its members' browsers. */
export async function rememberTz(site: SiteRow, tz: string | null) {
  if (!tz || !TZ.test(tz) || site.tz === tz) return;
  await db().from("sites").update({ tz, updated_at: new Date().toISOString() }).eq("id", site.id);
  site.tz = tz;
}
