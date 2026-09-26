import { NextResponse } from "next/server";
import { runWatch } from "../../../../lib/server/watch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Called every 5 minutes by the database scheduler (pg_cron + pg_net). Safe to
// call from anywhere: a lock allows one run at a time and it returns only
// counts. Nova work it queues is bounded per camera per day.
export async function POST() {
  return NextResponse.json(await runWatch());
}
