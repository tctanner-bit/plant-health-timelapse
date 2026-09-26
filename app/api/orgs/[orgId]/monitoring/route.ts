import { NextResponse } from "next/server";
import { requireOrg, isResponse } from "../../../../../lib/server/auth";
import { canStoreKeys, loadMonitoring, setMonitoring } from "../../../../../lib/server/monitoring";
import { ALERTS_PER_DAY } from "../../../../../lib/server/watch";

export const dynamic = "force-dynamic";

async function status(orgId: string) {
  const { row } = await loadMonitoring(orgId);
  return {
    available: canStoreKeys(),
    enabled: row ? row.enabled : true,
    hasKey: !!row?.key_ciphertext,
    keyHint: row?.key_hint ?? null,
    storedAt: row?.stored_at ?? null,
    lastUsedAt: row?.last_used_at ?? null,
    lastError: row?.last_error ?? null,
    alertsPerDay: ALERTS_PER_DAY,
  };
}

// GET → whether Nova watches this org in the background, and with what.
export async function GET(req: Request, { params }: { params: { orgId: string } }) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;
  return NextResponse.json(await status(ctx.orgId));
}

// POST { enabled } → turn background monitoring on (stores this key) or off
// (deletes the stored key).
export async function POST(req: Request, { params }: { params: { orgId: string } }) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;
  const body = await req.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be true or false" }, { status: 400 });
  await setMonitoring(ctx.orgId, body.enabled, ctx.apiKey, req.headers.get("x-client-tz"));
  return NextResponse.json(await status(ctx.orgId));
}
