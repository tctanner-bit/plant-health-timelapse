// Per-viewer display preferences. Units are a personal choice (one grower
// reads °C, another °F), so they live in this browser, not on the camera.
// Growlink converts server-side from the Uom-* headers; nothing here does math.

import { DEFAULT_UOM, Uom } from "./growlink";

const KEY = "plant-health-ai:uom";

export function loadUom(): Uom {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return saved ? { ...DEFAULT_UOM, ...saved } : DEFAULT_UOM;
  } catch {
    return DEFAULT_UOM;
  }
}

export function saveUom(u: Uom) {
  try {
    localStorage.setItem(KEY, JSON.stringify(u));
  } catch {}
}

export const UOM_OPTIONS: { key: keyof Uom; label: string; options: { value: number; label: string }[] }[] = [
  { key: "temp", label: "Temperature", options: [{ value: 1, label: "°F" }, { value: 0, label: "°C" }] },
  { key: "vpd", label: "VPD", options: [{ value: 8, label: "kPa" }, { value: 9, label: "mbar" }] },
  { key: "tds", label: "Nutrients", options: [{ value: 6, label: "EC" }, { value: 3, label: "PPM" }] },
  { key: "light", label: "Light", options: [{ value: 16, label: "PPFD" }, { value: 7, label: "Lux" }] },
  { key: "volume", label: "Volume", options: [{ value: 42, label: "Gallons" }, { value: 43, label: "Liters" }] },
];
