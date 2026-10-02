import { NextResponse } from "next/server";
import { isResponse, requireOrg, requireOwner } from "../../../../../lib/server/auth";
import { db } from "../../../../../lib/server/supabase";
import { removeSiteKey, storeSiteKey } from "../../../../../lib/server/sites";
import { GrowlinkError, getOrganizations, sameId } from "../../../../../lib/growlink";
import { ALERTS_PER_DAY } from "../../../../../lib/server/watch";

export const dynamic = "force-dynamic";

type Ctx = { params: { orgId: string } };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function details(siteId: string) {
  const [{ data: site }, { data: members }, { data: invites }] = await Promise.all([
    db()
      .from("sites")
      .select("name, key_hint, key_status, key_error, key_checked_at, monitoring_enabled, tz")
      .eq("id", siteId)
      .single(),
    db().from("site_members").select("user_id, email, role, added_at").eq("site_id", siteId).order("added_at"),
    db().from("site_invites").select("id, email, role, created_at").eq("site_id", siteId).order("created_at"),
  ]);
  return { site, members: members ?? [], invites: invites ?? [] };
}

// GET → the site's settings: Growlink key status, background monitoring,
// members and pending invitations. Viewers see it read-only.
export async function GET(req: Request, { params }: Ctx) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;
  const d = await details(ctx.site.id);
  return NextResponse.json({
    name: d.site?.name ?? ctx.orgName,
    role: ctx.role,
    me: ctx.user.id,
    key: {
      status: d.site?.key_status ?? "missing",
      hint: d.site?.key_hint ?? null,
      error: d.site?.key_error ?? null,
      checkedAt: d.site?.key_checked_at ?? null,
    },
    monitoring: { enabled: d.site?.monitoring_enabled ?? true, alertsPerDay: ALERTS_PER_DAY, tz: d.site?.tz ?? null },
    members: d.members.map((m) => ({ userId: m.user_id, email: m.email, role: m.role, addedAt: m.added_at })),
    invites: ctx.role === "owner" ? d.invites : [],
  });
}

// POST { action, ... } — owners only, except "leave".
//   invite { email, role }        share the site; they join on their next LABS sign-in
//   cancel_invite { id }
//   set_role { userId, role }
//   remove { userId }
//   leave                          remove yourself (not the last owner)
//   set_key { apiKey }             reconnect / rotate the Growlink key
//   monitoring { enabled }         background Nova on or off
export async function POST(req: Request, { params }: Ctx) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  const siteId = ctx.site.id;

  const owners = async () =>
    (await db().from("site_members").select("user_id").eq("site_id", siteId).eq("role", "owner")).data?.map((r) => r.user_id) ?? [];

  if (body.action === "leave") {
    const o = await owners();
    if (ctx.role === "owner" && o.length <= 1)
      return NextResponse.json({ error: "You're the only owner — make someone else an owner first" }, { status: 409 });
    await db().from("site_members").delete().eq("site_id", siteId).eq("user_id", ctx.user.id);
    return NextResponse.json({ ok: true });
  }

  const notOwner = requireOwner(ctx);
  if (notOwner) return notOwner;
  const role = body.role === "owner" ? "owner" : "viewer";

  switch (body.action) {
    case "invite": {
      const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
      if (!EMAIL.test(email)) return NextResponse.json({ error: "Enter an email address" }, { status: 400 });
      const { data: existing } = await db().from("site_members").select("user_id").eq("site_id", siteId).eq("email", email).maybeSingle();
      if (existing) return NextResponse.json({ error: "They already have access" }, { status: 409 });
      const { error } = await db()
        .from("site_invites")
        .upsert({ site_id: siteId, email, role, invited_by: ctx.user.id }, { onConflict: "site_id,email" });
      if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });
      break;
    }
    case "cancel_invite":
      await db().from("site_invites").delete().eq("site_id", siteId).eq("id", String(body.id ?? ""));
      break;
    case "set_role":
    case "remove": {
      const userId = String(body.userId ?? "");
      const o = await owners();
      const demotingLastOwner = o.includes(userId) && o.length <= 1 && (body.action === "remove" || role !== "owner");
      if (demotingLastOwner) return NextResponse.json({ error: "A site needs at least one owner" }, { status: 409 });
      if (body.action === "remove") await db().from("site_members").delete().eq("site_id", siteId).eq("user_id", userId);
      else await db().from("site_members").update({ role }).eq("site_id", siteId).eq("user_id", userId);
      break;
    }
    case "set_key": {
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      if (apiKey.length < 10) return NextResponse.json({ error: "Paste the Growlink API key" }, { status: 400 });
      try {
        const orgs = await getOrganizations(apiKey);
        if (!orgs.some((o) => sameId(o.id, ctx.orgId)))
          return NextResponse.json({ error: "That key can't see this organization" }, { status: 400 });
      } catch (e) {
        if (e instanceof GrowlinkError && e.status === 401)
          return NextResponse.json({ error: "Growlink didn't accept that key" }, { status: 400 });
        return NextResponse.json({ error: "Couldn't reach Growlink to check the key — try again" }, { status: 502 });
      }
      await storeSiteKey(siteId, apiKey);
      break;
    }
    case "remove_key":
      await removeSiteKey(siteId);
      break;
    case "monitoring":
      if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
      await db().from("sites").update({ monitoring_enabled: body.enabled, updated_at: new Date().toISOString() }).eq("id", siteId);
      break;
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
