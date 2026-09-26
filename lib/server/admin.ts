// Growlink staff access for the camera fleet dashboard (/admin).
//
// Staff sign in with Supabase Auth (this project), normally with an emailed
// sign-in link, and send the session's access token as `Authorization:
// Bearer …`. A request is allowed if the token is valid AND either:
//   - the account's email is a verified address on the staff domain
//     (@growlink.com by default, ADMIN_EMAIL_DOMAIN to change), or
//   - the email is on the fleet_admins list (exceptions, e.g. contractors).
// Everything is then read and written with the service role, and every
// change is audited.

import { NextResponse } from "next/server";
import { createHash, randomInt } from "crypto";
import { db } from "./supabase";

export type AdminContext = { email: string };

const ALLOW_TTL_MS = 60_000;
export const STAFF_DOMAIN = (process.env.ADMIN_EMAIL_DOMAIN ?? "growlink.com").toLowerCase();

export const isStaffEmail = (email: string) => email.toLowerCase().endsWith("@" + STAFF_DOMAIN);

export async function onAdminList(email: string) {
  const { data } = await db().from("fleet_admins").select("email").eq("email", email.toLowerCase()).maybeSingle();
  return !!data;
}
const allowCache = new Map<string, number>(); // email -> allowed-until

export async function requireAdmin(req: Request): Promise<AdminContext | NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const { data, error } = await db().auth.getUser(token);
  const user = data?.user;
  const email = user?.email?.toLowerCase();
  if (error || !email) return NextResponse.json({ error: "Session expired — sign in again" }, { status: 401 });

  if ((allowCache.get(email) ?? 0) < Date.now()) {
    const staff = isStaffEmail(email) && !!user?.email_confirmed_at;
    if (!staff && !(await onAdminList(email)))
      return NextResponse.json({ error: `Only @${STAFF_DOMAIN} staff can open the fleet dashboard` }, { status: 403 });
    allowCache.set(email, Date.now() + ALLOW_TTL_MS);
  }
  return { email };
}

export const isAdminResponse = (x: unknown): x is NextResponse => x instanceof NextResponse;

export async function audit(ctx: AdminContext, action: string, cameraId: string | null, detail: Record<string, unknown> = {}) {
  await db().from("fleet_audit").insert({ admin_email: ctx.email, camera_id: cameraId, action, detail });
}

// --- credentials a support action can issue (same formats as provisioning) ---

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Camera FTP password = ingest token. Only the hash is stored. */
export function newCameraToken() {
  const token = "phc_" + Array.from({ length: 27 }, () => BASE62[randomInt(62)]).join("");
  return { token, hash: sha256(token), hint: token.slice(-4) };
}

/** Sticker setup code, printed XXXX-XXXX. Hash matches hashClaimCode(). */
export function newSetupCode() {
  const code = Array.from({ length: 8 }, () => CROCKFORD[randomInt(32)]).join("");
  return { code: `${code.slice(0, 4)}-${code.slice(4)}`, hash: sha256("claim:" + code) };
}

export const GATEWAY_HOST = process.env.GATEWAY_HOST ?? "phc-ftp.fly.dev";
