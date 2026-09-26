import { NextResponse } from "next/server";
import { requireAdmin, isAdminResponse } from "../../../../lib/server/admin";
import { db } from "../../../../lib/server/supabase";
import { hashClaimCode, normalizeClaimCode } from "../../../../lib/server/cameras";

export const dynamic = "force-dynamic";

// GET ?code=XXXX-XXXX → { cameraId } for the camera with that setup code.
// Serial, org and room search happen in the browser over the fleet list; a
// setup code can only be matched server-side because just its hash is stored.
export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (isAdminResponse(ctx)) return ctx;
  const raw = new URL(req.url).searchParams.get("code") ?? "";
  const code = normalizeClaimCode(raw);
  if (!code) return NextResponse.json({ error: "Not a setup code" }, { status: 400 });
  const { data } = await db().from("cameras").select("id").eq("claim_code_hash", hashClaimCode(code)).maybeSingle();
  if (!data)
    return NextResponse.json({ error: "No camera has that setup code (it may already be claimed — codes are single-use)" }, { status: 404 });
  return NextResponse.json({ cameraId: data.id });
}
