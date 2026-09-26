import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { STAFF_DOMAIN, isStaffEmail, onAdminList } from "../../../../lib/server/admin";
import { db } from "../../../../lib/server/supabase";

export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOLDOWN_MS = 60_000;
const lastSent = new Map<string, number>();

// POST { email } → { ok } and emails a one-time sign-in link.
//
// Links go only to the staff domain (@growlink.com) or the fleet_admins
// exceptions list, so the dashboard can't be used to send mail to anyone
// else. The account is created on first use; public sign-up stays off.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) return NextResponse.json({ error: "Enter your email address" }, { status: 400 });
  if (!isStaffEmail(email) && !(await onAdminList(email)))
    return NextResponse.json({ error: `Use your @${STAFF_DOMAIN} email address` }, { status: 403 });

  const last = lastSent.get(email) ?? 0;
  if (Date.now() - last < COOLDOWN_MS)
    return NextResponse.json({ error: "A link was just sent — check your inbox (and spam) before asking for another" }, { status: 429 });

  // Create the account if this is their first sign-in. Harmless if it exists.
  await db().auth.admin.createUser({ email, email_confirm: true }).catch(() => undefined);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.json({ error: "Sign-in email isn't configured" }, { status: 503 });

  const origin = new URL(req.url).origin;
  const authClient = createClient(url, anon, { auth: { persistSession: false, flowType: "implicit" } });
  const { error } = await authClient.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/admin` },
  });
  if (error) {
    const rate = /rate|limit|seconds/i.test(error.message);
    return NextResponse.json(
      { error: rate ? "Too many sign-in emails — wait a minute and try again" : `Couldn't send the email: ${error.message}` },
      { status: rate ? 429 : 502 }
    );
  }
  lastSent.set(email, Date.now());
  return NextResponse.json({ ok: true });
}
