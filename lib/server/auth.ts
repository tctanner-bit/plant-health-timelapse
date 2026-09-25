// Tenancy check for API routes.
//
// The caller sends their Growlink API key in `X-Growlink-Key`. We ask Growlink
// which organizations that key can see and allow the request only if the org
// in the URL is one of them. Growlink stays the source of truth for who
// belongs to which customer; we never store keys.
//
// Results are cached briefly per key hash so a playing timelapse doesn't call
// Growlink on every signed-URL batch.

import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { getOrganizations, GrowlinkError, sameId } from "../growlink";

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { orgIds: string[]; exp: number }>();

export type OrgContext = { apiKey: string; orgId: string };

export async function requireOrg(
  req: Request,
  orgId: string
): Promise<OrgContext | NextResponse> {
  const apiKey = req.headers.get("x-growlink-key")?.trim();
  if (!apiKey) return NextResponse.json({ error: "Missing Growlink API key" }, { status: 401 });
  if (!/^[0-9a-f-]{36}$/i.test(orgId))
    return NextResponse.json({ error: "Bad organization id" }, { status: 400 });

  const h = createHash("sha256").update(apiKey).digest("hex");
  let entry = cache.get(h);
  if (!entry || entry.exp < Date.now()) {
    try {
      const orgs = await getOrganizations(apiKey);
      entry = { orgIds: orgs.map((o) => o.id.toLowerCase()), exp: Date.now() + TTL_MS };
      cache.set(h, entry);
    } catch (e) {
      if (e instanceof GrowlinkError && e.status === 401)
        return NextResponse.json({ error: "Invalid API key" }, { status: 401 });
      return NextResponse.json({ error: "Could not verify key with Growlink" }, { status: 502 });
    }
  }
  if (!entry.orgIds.some((id) => sameId(id, orgId)))
    return NextResponse.json({ error: "Not a member of this organization" }, { status: 403 });

  return { apiKey, orgId: orgId.toLowerCase() };
}

export const isResponse = (x: unknown): x is NextResponse => x instanceof NextResponse;
