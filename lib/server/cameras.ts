import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { db } from "./supabase";
import { getRooms, getSensors, sameId } from "../growlink";

import type { OrgContext } from "./auth";

export const CAMERA_COLUMNS =
  "id, room_id, name, serial, interval_sec, token_hint, created_at, claimed_at, last_frame_at, last_seen_at, last_error, last_error_at, revoked_at, sensors";

export type CameraRow = {
  id: string;
  room_id: string;
  name: string;
  serial: string | null;
  interval_sec: number;
  token_hint: string;
  created_at: string;
  claimed_at: string | null;
  last_frame_at: string | null;
  last_seen_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  revoked_at: string | null;
  sensors: string[]; // Growlink sensor ids in the camera's room, display order
};

// Shape sent to the browser. Never includes the token hash.
export const toCamera = (r: CameraRow) => ({
  id: r.id,
  roomId: r.room_id,
  name: r.name,
  serial: r.serial,
  intervalSec: r.interval_sec,
  tokenHint: r.token_hint,
  createdAt: r.created_at,
  claimedAt: r.claimed_at,
  lastFrameAt: r.last_frame_at,
  lastSeenAt: r.last_seen_at,
  lastError: r.last_error,
  lastErrorAt: r.last_error_at,
  revoked: !!r.revoked_at,
  sensors: r.sensors ?? [],
});

// Sticker claim codes: 8 Crockford base32 characters, printed as XXXX-XXXX.
// Normalizing forgives the usual transcription slips (lowercase, dashes,
// spaces, O for 0, I/L for 1). scripts/provision-camera.mjs must hash the same
// normalized form.
export function normalizeClaimCode(input: string): string | null {
  const s = input
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(s) ? s : null;
}

export const hashClaimCode = (normalized: string) =>
  createHash("sha256").update("claim:" + normalized).digest("hex");

// Fetch a camera, scoped to the caller's org. 404 (not 403) for other orgs'
// cameras so ids from one tenant reveal nothing about another.
export async function loadCamera(ctx: OrgContext, cameraId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(cameraId))
    return NextResponse.json({ error: "Camera not found" }, { status: 404 });
  const { data, error } = await db()
    .from("cameras")
    .select(CAMERA_COLUMNS)
    .eq("id", cameraId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Database error" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Camera not found" }, { status: 404 });
  return data as CameraRow;
}

// A camera can only be attached to a room Growlink says is in this org.
export async function roomInOrg(ctx: OrgContext, roomId: unknown) {
  if (typeof roomId !== "string") return false;
  const rooms = await getRooms(ctx.apiKey, ctx.orgId);
  return rooms.some((r) => sameId(r.id, roomId));
}

export function parseName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length >= 1 && s.length <= 80 ? s : null;
}

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_CAMERA_SENSORS = 20;

// Validate a sensor selection: a list of Growlink sensor ids, all in the
// camera's own room (checked against Growlink). Returns the cleaned list in
// the caller's order, or an error message.
export async function parseSensors(ctx: OrgContext, roomId: string, v: unknown): Promise<string[] | string> {
  if (!Array.isArray(v)) return "sensors must be a list of sensor ids";
  if (v.length > MAX_CAMERA_SENSORS) return `Choose at most ${MAX_CAMERA_SENSORS} sensors`;
  const ids: string[] = [];
  for (const x of v) {
    const id = typeof x === "string" ? x.toLowerCase() : "";
    if (!GUID.test(id)) return "Each sensor must be a sensor id";
    if (!ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return ids;

  const inRoom = await getSensors(ctx.apiKey, roomId);
  if (!ids.every((id) => inRoom.some((s) => sameId(s.id, id))))
    return "Only sensors in the camera's room can be selected";
  return ids;
}
