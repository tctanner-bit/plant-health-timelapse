// Thin client for the Growlink Developer API. Used from the browser (CORS is
// open) for rooms and sensor history, and from our API routes to prove that a
// caller's key belongs to the org whose cameras they're asking for.
//
// Conventions from the API guide: numeric enums, keys that may arrive
// PascalCase, lists that may or may not be wrapped, GUIDs compared lowercased,
// and unit conversion done server-side via Uom-* headers — never here.

export const GROWLINK_BASE = "https://api.developer.growlink.com";

export type Uom = { temp: 0 | 1; vpd: 8 | 9; tds: 3 | 6; light: 7 | 16; volume: 42 | 43 };
export const DEFAULT_UOM: Uom = { temp: 1, vpd: 8, tds: 6, light: 16, volume: 42 };

export type Org = { id: string; name: string };
export type Room = { id: string; name: string; roomType: number };
export type Sensor = {
  id: string;
  name: string;
  sensorType: number;
  unitOfMeasure: number;
  metric: number;
  moduleName?: string;
};
export type ChartPoint = { x: string; y: number | null };
export type ChartSeries = {
  sensorId?: string;
  name: string;
  seriesType: number;
  unit: string;
  yAxis?: { min: number; max: number; tickAmount?: number };
  data: ChartPoint[];
};
export type ChartResponse = { series: ChartSeries[]; dayNight: { x: string; y: number }[] };

export class GrowlinkError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export function normalizeKeys<T = any>(value: any): T {
  if (Array.isArray(value)) return value.map(normalizeKeys) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k.charAt(0).toLowerCase() + k.slice(1)] = normalizeKeys(v);
    }
    return out as T;
  }
  return value;
}

function unwrapList<T>(data: any, key: string): T[] {
  if (Array.isArray(data)) return data;
  return data?.[key] ?? [];
}

export const sameId = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export async function glFetch<T = any>(
  apiKey: string,
  path: string,
  init: { method?: string; body?: unknown; uom?: Uom } = {}
): Promise<T> {
  const uom = init.uom ?? DEFAULT_UOM;
  let res: Response;
  try {
    res = await fetch(GROWLINK_BASE + path, {
      method: init.method ?? "GET",
      headers: {
        "Gl-Api-Key": apiKey,
        "Uom-Temp": String(uom.temp),
        "Uom-Vpd": String(uom.vpd),
        "Uom-Tds": String(uom.tds),
        "Uom-Light": String(uom.light),
        "Uom-Volume": String(uom.volume),
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
  } catch {
    throw new GrowlinkError("Could not reach the Growlink API", 0);
  }
  if (res.status === 401) throw new GrowlinkError("Invalid API key", 401);
  if (!res.ok) throw new GrowlinkError(`Growlink API error (HTTP ${res.status})`, res.status);
  const text = await res.text();
  return normalizeKeys(text ? JSON.parse(text) : null);
}

export const getOrganizations = async (key: string) =>
  unwrapList<Org>(await glFetch(key, "/api/v2/organizations"), "organizations");

export const getRooms = async (key: string, orgId: string) =>
  unwrapList<Room>(await glFetch(key, `/api/v2/organization/${orgId}/rooms`), "rooms");

export const getSensors = async (key: string, roomId: string) =>
  unwrapList<Sensor>(await glFetch(key, `/api/v2/room/${roomId}/sensors`), "sensors");

export async function getSensorChart(
  key: string,
  orgId: string,
  sensorIds: string[],
  start: number,
  end: number,
  uom?: Uom
): Promise<ChartResponse> {
  const data = await glFetch(key, `/api/v2/organization/${orgId}/sensors/data/chart`, {
    method: "POST",
    body: {
      sensorIds,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      includeDayNight: true,
    },
    uom,
  });
  return { series: data?.series ?? [], dayNight: data?.dayNight ?? [] };
}

// SensorMetric enum (subset we label; anything else falls back to the sensor name).
export const METRIC_LABELS: Record<number, string> = {
  0: "Temperature", 1: "Humidity", 2: "pH", 3: "CO₂", 4: "TDS", 6: "Light",
  8: "VPD", 9: "Water content", 10: "EC", 13: "Dissolved O₂", 20: "PAR", 22: "DLI",
};

export const ROOM_TYPE_LABELS: Record<number, string> = {
  0: "Production", 1: "Non-production", 2: "Fertigation",
};
