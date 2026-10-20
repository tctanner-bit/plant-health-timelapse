// Background job routes (/api/jobs/*) are called only by the database
// scheduler (pg_cron + pg_net in the Plant Health Camera project). They need
// the shared secret in the x-jobs-secret header: pg_cron reads it from Vault
// ('phai_jobs_secret'), this server from the server-only env var JOBS_SECRET.
// Without it anyone could trigger Nova reviews, each one an AI call.

import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** null when the caller is the scheduler, else the response to send. */
export function requireJobSecret(req: Request): NextResponse | null {
  const want = process.env.JOBS_SECRET;
  // fail closed: never run unprotected because the env var went missing
  if (!want) return NextResponse.json({ error: "Background jobs aren't configured on this server" }, { status: 503 });
  const got = req.headers.get("x-jobs-secret") ?? "";
  // compare fixed-length digests, so neither the length nor the content leaks through timing
  if (!got || !timingSafeEqual(digest(got), digest(want))) return NextResponse.json({ error: "Forbidden" }, { status: 401 });
  return null;
}
