import { NextResponse } from "next/server";
import { requireJobSecret } from "../../../../lib/server/jobs";
import { runNovaJob } from "../../../../lib/server/watch";

export const dynamic = "force-dynamic";
// Vision calls with several frames take 10–30s.
export const maxDuration = 60;

// Called every minute by the database scheduler: runs one queued Nova review
// (daily or alert). Returns only an id and outcome. Scheduler only (x-jobs-secret).
export async function POST(req: Request) {
  const denied = requireJobSecret(req);
  if (denied) return denied;
  return NextResponse.json(await runNovaJob());
}
