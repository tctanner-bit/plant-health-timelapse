import { NextResponse } from "next/server";
import { isResponse, requireKey, requireOrg } from "../../../../../lib/server/auth";
import { roomInOrg } from "../../../../../lib/server/cameras";
import { rejectSiteKey } from "../../../../../lib/server/sites";
import { GrowlinkError, Uom, getLiveSensors, getRooms, getSensorChart, getSensors } from "../../../../../lib/growlink";

export const dynamic = "force-dynamic";

const GUID = /^[0-9a-f-]{36}$/i;
const MAX_SENSORS = 400;
const MAX_SPAN_MS = 93 * 86_400_000;

// POST { op, ... } → Growlink data for this site, read with the site's key.
// Read-only operations only; the browser never sees the key.
//   rooms
//   sensors { roomId }
//   chart   { sensorIds, start, end, uom? }
//   live    { sensorIds, uom? }
export async function POST(req: Request, { params }: { params: { orgId: string } }) {
  const ctx = await requireOrg(req, params.orgId);
  if (isResponse(ctx)) return ctx;
  const noKey = requireKey(ctx);
  if (noKey) return noKey;

  const body = await req.json().catch(() => ({}));
  const uom = body.uom && typeof body.uom === "object" ? (body.uom as Uom) : undefined;
  const ids = (v: unknown) =>
    Array.isArray(v) ? Array.from(new Set(v.map(String).filter((s) => GUID.test(s)))).slice(0, MAX_SENSORS) : [];

  try {
    switch (body.op) {
      case "rooms":
        return NextResponse.json({ rooms: await getRooms(ctx.apiKey, ctx.orgId) });
      case "sensors": {
        const room = await roomInOrg(ctx, body.roomId);
        if (!room) return NextResponse.json({ error: "Room not found in this organization" }, { status: 404 });
        return NextResponse.json({ sensors: await getSensors(ctx.apiKey, String(body.roomId)) });
      }
      case "chart": {
        const start = Number(body.start);
        const end = Number(body.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > MAX_SPAN_MS)
          return NextResponse.json({ error: "Bad time range" }, { status: 400 });
        return NextResponse.json({ chart: await getSensorChart(ctx.apiKey, ctx.orgId, ids(body.sensorIds), start, end, uom) });
      }
      case "live":
        return NextResponse.json({ readings: await getLiveSensors(ctx.apiKey, ctx.orgId, ids(body.sensorIds), uom) });
    }
    return NextResponse.json({ error: "Unknown op" }, { status: 400 });
  } catch (e) {
    if (e instanceof GrowlinkError && e.status === 401) {
      await rejectSiteKey(ctx.site.id);
      return NextResponse.json(
        { error: "Growlink rejected this site's API key. An owner needs to reconnect it in Settings.", reconnect: true },
        { status: 409 }
      );
    }
    if (e instanceof GrowlinkError) return NextResponse.json({ error: e.message }, { status: 502 });
    throw e;
  }
}
