import { NextResponse } from "next/server";
import { isResponse, requireUser } from "../../../lib/server/auth";
import { db } from "../../../lib/server/supabase";
import { SITE_COLUMNS, SiteRow, acceptInvites, sitesFor, storeSiteKey } from "../../../lib/server/sites";
import { GrowlinkError, getOrganizations, sameId } from "../../../lib/growlink";

export const dynamic = "force-dynamic";

// GET → { sites: [{ orgId, name, role, keyStatus }] } for the signed-in LABS user.
export async function GET(req: Request) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  await acceptInvites(user);
  const list = await sitesFor(user.id);
  return NextResponse.json({
    user: { email: user.email },
    sites: list.map(({ role, site }) => ({
      orgId: site.growlink_org_id,
      name: site.name,
      role,
      keyStatus: site.key_status,
    })),
  });
}

// POST { apiKey, orgId? } → connect a Growlink organization.
//
// The key must be an org-admin key for that org (checked with Growlink). A
// key that sees several orgs returns { choose: [...] } first. Connecting an
// org that's already a site makes the caller an owner of it (holding the
// org's key already gives full access to it) and refreshes the stored key.
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (isResponse(user)) return user;
  const body = await req.json().catch(() => ({}));
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (apiKey.length < 10 || apiKey.length > 300)
    return NextResponse.json({ error: "Paste your Growlink API key (Builder → Authentication)" }, { status: 400 });

  let orgs;
  try {
    orgs = await getOrganizations(apiKey);
  } catch (e) {
    if (e instanceof GrowlinkError && e.status === 401)
      return NextResponse.json({ error: "Growlink didn't accept that key" }, { status: 400 });
    return NextResponse.json({ error: "Couldn't reach Growlink to check the key — try again" }, { status: 502 });
  }
  if (orgs.length === 0) return NextResponse.json({ error: "That key isn't linked to any organization" }, { status: 400 });

  const wanted = typeof body.orgId === "string" ? body.orgId : orgs.length === 1 ? orgs[0].id : null;
  if (!wanted) return NextResponse.json({ choose: orgs.map((o) => ({ id: o.id.toLowerCase(), name: o.name })) });
  const org = orgs.find((o) => sameId(o.id, wanted));
  if (!org) return NextResponse.json({ error: "That key can't see this organization" }, { status: 400 });
  const orgId = org.id.toLowerCase();

  let { data: site } = await db().from("sites").select(SITE_COLUMNS).eq("growlink_org_id", orgId).maybeSingle();
  if (!site) {
    const ins = await db()
      .from("sites")
      .insert({ growlink_org_id: orgId, name: org.name, created_by: user.id })
      .select(SITE_COLUMNS)
      .single();
    if (ins.error) {
      // Someone connected it at the same moment.
      const again = await db().from("sites").select(SITE_COLUMNS).eq("growlink_org_id", orgId).single();
      site = again.data;
    } else site = ins.data;
  }
  if (!site) return NextResponse.json({ error: "Database error" }, { status: 500 });
  const s = site as SiteRow;

  await storeSiteKey(s.id, apiKey);
  await db()
    .from("site_members")
    .upsert({ site_id: s.id, user_id: user.id, email: user.email, role: "owner", added_by: user.id }, { onConflict: "site_id,user_id" });
  if (s.name !== org.name) await db().from("sites").update({ name: org.name }).eq("id", s.id);

  return NextResponse.json({ site: { orgId, name: org.name, role: "owner", keyStatus: "ok" } }, { status: 201 });
}
