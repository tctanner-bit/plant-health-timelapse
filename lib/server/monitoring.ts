// Background monitoring: the org's Growlink key, kept so the server can read
// sensor data when nobody has the app open (watchers, daily and triggered
// Nova reviews).
//
// The key can control hardware, so:
//   - it's stored AES-256-GCM encrypted with CREDENTIALS_KEY (Vercel only;
//     the database never sees it), bound to the org id as associated data;
//   - it's only used with the read-only Growlink calls in lib/growlink.ts
//     (sensor list, chart and live data), never anything that writes;
//   - an org can turn monitoring off, which deletes it; a key Growlink
//     rejects is deleted too.
// Without CREDENTIALS_KEY nothing is stored and background runs use frames
// only.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { db } from "./supabase";

export type Monitoring = {
  org_id: string;
  enabled: boolean;
  key_ciphertext: string | null;
  key_hash: string | null;
  key_hint: string | null;
  tz: string | null;
  stored_at: string | null;
  last_used_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
};

function masterKey(): Buffer | null {
  const raw = process.env.CREDENTIALS_KEY;
  if (!raw) return null;
  const k = Buffer.from(raw, "base64");
  return k.length === 32 ? k : null;
}
export const canStoreKeys = () => masterKey() !== null;

function encrypt(plain: string, orgId: string): string {
  const key = masterKey()!;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(orgId));
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return "v1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

function decrypt(blob: string, orgId: string): string | null {
  const key = masterKey();
  if (!key || !blob.startsWith("v1:")) return null;
  try {
    const raw = Buffer.from(blob.slice(3), "base64");
    const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAAD(Buffer.from(orgId));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const TZ = /^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+){0,2}$/;

const recent = new Map<string, { hash: string; at: number }>();

/**
 * Called on ordinary app requests: keep the org's key (and viewer's time
 * zone) for background runs, unless the org turned monitoring off. Writes
 * only when the key changed; checks at most every 10 minutes per org.
 */
export async function rememberKey(orgId: string, apiKey: string, tz: string | null): Promise<void> {
  if (!canStoreKeys()) return;
  const hash = sha256(apiKey);
  const seen = recent.get(orgId);
  if (seen && seen.hash === hash && Date.now() - seen.at < 10 * 60_000) return;
  recent.set(orgId, { hash, at: Date.now() });
  try {
    const { data } = await db().from("org_monitoring").select("enabled, key_hash, tz").eq("org_id", orgId).maybeSingle();
    if (data && !data.enabled) return;
    const zone = tz && TZ.test(tz) ? tz : null;
    if (data?.key_hash === hash && (!zone || data.tz === zone)) return;
    await db().from("org_monitoring").upsert({
      org_id: orgId,
      enabled: true,
      key_ciphertext: encrypt(apiKey, orgId),
      key_hash: hash,
      key_hint: apiKey.slice(-4),
      tz: zone ?? data?.tz ?? null,
      stored_at: new Date().toISOString(),
      last_error: null,
      last_error_at: null,
      updated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("monitoring: could not store key", orgId, e instanceof Error ? e.message : e);
  }
}

/** The org's monitoring row and decrypted key (null when off or unavailable). */
export async function loadMonitoring(orgId: string): Promise<{ row: Monitoring | null; apiKey: string | null }> {
  const { data } = await db().from("org_monitoring").select("*").eq("org_id", orgId).maybeSingle();
  const row = (data as Monitoring) ?? null;
  if (!row?.enabled || !row.key_ciphertext) return { row, apiKey: null };
  return { row, apiKey: decrypt(row.key_ciphertext, orgId) };
}

export async function markKeyUsed(orgId: string) {
  await db().from("org_monitoring").update({ last_used_at: new Date().toISOString() }).eq("org_id", orgId);
}

/** Growlink rejected the key (revoked or rotated): drop it until someone uses the app again. */
export async function dropRejectedKey(orgId: string, message: string) {
  recent.delete(orgId);
  await db()
    .from("org_monitoring")
    .update({
      key_ciphertext: null,
      key_hash: null,
      last_error: message.slice(0, 300),
      last_error_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", orgId);
}

/** Org setting: turning it off deletes the stored key. */
export async function setMonitoring(orgId: string, enabled: boolean, apiKey: string, tz: string | null) {
  recent.delete(orgId);
  if (!enabled) {
    await db().from("org_monitoring").upsert({
      org_id: orgId,
      enabled: false,
      key_ciphertext: null,
      key_hash: null,
      key_hint: null,
      updated_at: new Date().toISOString(),
    });
    return;
  }
  await db().from("org_monitoring").upsert({ org_id: orgId, enabled: true, updated_at: new Date().toISOString() });
  await rememberKey(orgId, apiKey, tz);
}
