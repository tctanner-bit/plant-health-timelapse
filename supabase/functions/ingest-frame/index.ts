// The single entry point for camera frames.
//
//   POST /functions/v1/ingest-frame
//   Authorization: Bearer phc_<token>          (per-camera, write-only)
//
//   Content-Type: image/jpeg                   → store a frame
//     X-Captured-At: <ISO>  (optional; set when replaying a queued frame)
//   Content-Type: application/json             → status report, no frame
//     { "error": "camera unreachable: ..." }   (or {} for a plain heartbeat)
//
//   → 200 { ok, claimed, frameId?, duplicate?, intervalSec }
//
// Callers: the FTPS gateway (plug-and-play Reolink cameras, where the token is
// the camera's FTP password), or anything else holding a camera token.
//
// The token resolves to exactly one camera, and the camera row carries the
// org and room — the uploader never names a tenant, so it can't write into one
// it doesn't belong to.
//
// Unclaimed cameras (provisioned, plugged in, sticker code not yet entered)
// are accepted but their frames are dropped: there is no org to store them
// under. They still update last_seen_at, so the claim screen can show that
// the camera is online.

import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET = "camera-frames";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_BACKFILL_MS = 7 * 24 * 3600 * 1000; // agent queue holds at most a week
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function sha256Hex(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

function stamp(d: Date) {
  const iso = d.toISOString(); // 2026-09-25T16:42:04.123Z
  return {
    dir: iso.slice(0, 10).replaceAll("-", "/"),
    file: iso.slice(0, 19).replaceAll("-", "").replaceAll(":", "") + "Z",
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });

  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token.startsWith("phc_")) return json(401, { error: "missing camera token" });

  const { data: cam, error: camErr } = await db
    .from("cameras")
    .select("id, org_id, interval_sec, revoked_at, last_frame_at")
    .eq("ingest_token_hash", await sha256Hex(token))
    .maybeSingle();
  if (camErr) return json(500, { error: "lookup failed" });
  if (!cam || cam.revoked_at) return json(401, { error: "invalid or revoked camera token" });

  const now = new Date();
  const type = (req.headers.get("Content-Type") ?? "").split(";")[0].trim();

  if (!cam.org_id) {
    await req.body?.cancel();
    await db.from("cameras").update({ last_seen_at: now.toISOString() }).eq("id", cam.id);
    return json(200, { ok: true, claimed: false, intervalSec: cam.interval_sec });
  }

  // Status report: heartbeat, or the agent telling us it couldn't reach the camera.
  if (type === "application/json") {
    const body = await req.json().catch(() => ({}));
    const err = typeof body?.error === "string" ? body.error.slice(0, 500) : null;
    await db.from("cameras").update({
      last_seen_at: now.toISOString(),
      ...(err ? { last_error: err, last_error_at: now.toISOString() } : {}),
    }).eq("id", cam.id);
    return json(200, { ok: true, claimed: true, intervalSec: cam.interval_sec });
  }

  if (type !== "image/jpeg") return json(415, { error: "expected image/jpeg or application/json" });

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_BYTES) return json(413, { error: "bad size" });
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return json(415, { error: "not a JPEG" });

  // Trust the agent's timestamp for queued frames, within reason.
  let captured = now;
  const hdr = req.headers.get("X-Captured-At");
  if (hdr) {
    const t = new Date(hdr);
    const ms = t.getTime();
    if (Number.isFinite(ms) && ms <= now.getTime() + MAX_CLOCK_SKEW_MS && ms >= now.getTime() - MAX_BACKFILL_MS) {
      captured = t;
    }
  }

  const { dir, file } = stamp(captured);
  const path = `${cam.org_id}/${cam.id}/${dir}/${file}.jpg`;

  const up = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: "image/jpeg",
    upsert: false,
  });
  // A retry of a frame that already landed is success, not an error — the agent
  // may have lost the response the first time.
  const duplicate = !!up.error && /exists|duplicate/i.test(up.error.message);
  if (up.error && !duplicate) return json(502, { error: "storage upload failed" });

  const { data: row, error: insErr } = await db
    .from("camera_frames")
    .upsert(
      { camera_id: cam.id, org_id: cam.org_id, captured_at: captured.toISOString(), storage_path: path, bytes: bytes.length },
      { onConflict: "storage_path", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();
  if (insErr) return json(500, { error: "frame insert failed" });

  await db.from("cameras").update({
    last_seen_at: now.toISOString(),
    last_error: null,
    // Replayed backlog frames can arrive after newer ones; don't move this backwards.
    ...(!cam.last_frame_at || new Date(cam.last_frame_at) < captured
      ? { last_frame_at: captured.toISOString() }
      : {}),
  }).eq("id", cam.id);

  return json(200, { ok: true, claimed: true, frameId: row?.id ?? null, duplicate, intervalSec: cam.interval_sec });
});
