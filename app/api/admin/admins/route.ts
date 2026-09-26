import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { audit, isAdminResponse, requireAdmin } from "../../../../lib/server/admin";
import { db } from "../../../../lib/server/supabase";

export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// GET → { admins: [{ email, added_at, added_by }] }
export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (isAdminResponse(ctx)) return ctx;
  const { data } = await db().from("fleet_admins").select("email, added_at, added_by").order("added_at");
  return NextResponse.json({ admins: data ?? [] });
}

// POST { email } → { email, temporaryPassword? }
// Adds a fleet admin. If they have no account yet, one is created with a
// temporary password (shown once) that they change after signing in.
export async function POST(req: Request) {
  const ctx = await requireAdmin(req);
  if (isAdminResponse(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!EMAIL.test(email)) return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });

  const { error: insErr } = await db().from("fleet_admins").upsert({ email, added_by: ctx.email }, { onConflict: "email" });
  if (insErr) return NextResponse.json({ error: "Database error" }, { status: 500 });

  let temporaryPassword: string | undefined;
  const pw = randomBytes(12).toString("base64url");
  const created = await db().auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (!created.error) temporaryPassword = pw;
  // An existing account keeps its password; only the allow-list changes.

  await audit(ctx, "admin_add", null, { email, accountCreated: !!temporaryPassword });
  return NextResponse.json({ email, temporaryPassword });
}

// DELETE ?email= → removes someone from the allow-list (their account stays,
// but can no longer open the dashboard). You can't remove yourself.
export async function DELETE(req: Request) {
  const ctx = await requireAdmin(req);
  if (isAdminResponse(ctx)) return ctx;
  const email = (new URL(req.url).searchParams.get("email") ?? "").toLowerCase();
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  if (email === ctx.email) return NextResponse.json({ error: "You can't remove yourself" }, { status: 400 });
  await db().from("fleet_admins").delete().eq("email", email);
  await audit(ctx, "admin_remove", null, { email });
  return NextResponse.json({ ok: true });
}
