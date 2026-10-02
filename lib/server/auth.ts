// Who is calling, and may they use this site?
//
// The browser sends the LABS access token (Authorization: Bearer). We check
// it with the LABS project, then require a membership of the site connected
// to the Growlink org in the URL. The site's Growlink key comes from Vault
// for the server's own Growlink calls; it is never sent to the browser.

import { NextResponse } from "next/server";
import { LabsUser, Role, SiteRow, acceptInvites, labsUser, membership, rememberTz, siteKey } from "./sites";

export type OrgContext = {
  apiKey: string; // the site's Growlink key ("" when it needs reconnecting)
  orgId: string;
  orgName: string | null;
  role: Role;
  site: SiteRow;
  user: LabsUser;
};

export const isResponse = (x: unknown): x is NextResponse => x instanceof NextResponse;

/** The signed-in LABS user, or a 401. */
export async function requireUser(req: Request): Promise<LabsUser | NextResponse> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return NextResponse.json({ error: "Sign in to Growlink LABS", signIn: true }, { status: 401 });
  const user = await labsUser(token).catch(() => null);
  if (!user) return NextResponse.json({ error: "Your LABS session has expired — sign in again", signIn: true }, { status: 401 });
  return user;
}

export async function requireOrg(req: Request, orgId: string): Promise<OrgContext | NextResponse> {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) return NextResponse.json({ error: "Bad organization id" }, { status: 400 });
  const user = await requireUser(req);
  if (isResponse(user)) return user;

  const id = orgId.toLowerCase();
  let m = await membership(user.id, id);
  if (!m) {
    await acceptInvites(user); // invited since the last check?
    m = await membership(user.id, id);
  }
  if (!m) return NextResponse.json({ error: "You don't have access to this site" }, { status: 403 });

  await rememberTz(m.site, req.headers.get("x-client-tz")).catch(() => undefined);
  const apiKey = (await siteKey(m.site.id)) ?? "";
  return { apiKey, orgId: id, orgName: m.site.name, role: m.role, site: m.site, user };
}

/** For changes: claiming, renaming, revoking cameras, site settings. */
export function requireOwner(ctx: OrgContext): NextResponse | null {
  return ctx.role === "owner"
    ? null
    : NextResponse.json({ error: "Only a site owner can change this" }, { status: 403 });
}

/** Routes that need Growlink data: a clear message when the key is gone. */
export function requireKey(ctx: OrgContext): NextResponse | null {
  if (ctx.apiKey) return null;
  return NextResponse.json(
    {
      error:
        ctx.site.key_status === "rejected"
          ? "Growlink rejected this site's API key. An owner needs to reconnect it in Settings."
          : "This site has no Growlink API key. An owner needs to connect one in Settings.",
      reconnect: true,
    },
    { status: 409 }
  );
}
