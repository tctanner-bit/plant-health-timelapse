import { NextResponse } from "next/server";
import { requireAdmin, isAdminResponse } from "../../../../lib/server/admin";

export const dynamic = "force-dynamic";

// GET → { email } if the caller is a signed-in fleet admin.
export async function GET(req: Request) {
  const ctx = await requireAdmin(req);
  if (isAdminResponse(ctx)) return ctx;
  return NextResponse.json({ email: ctx.email });
}
