import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// GET → { version } — the commit this deployment was built from. Open tabs
// compare it with their own build and reload onto a newer one.
export function GET() {
  return NextResponse.json({ version: process.env.VERCEL_GIT_COMMIT_SHA ?? null }, { headers: { "Cache-Control": "no-store" } });
}
