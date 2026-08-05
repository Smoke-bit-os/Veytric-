// Raw VIN acquisition history — stores every VIN read with timestamp + source
// (Mode 09 pipeline output). Offline via local storage.

import { storage } from "@/src/utils/storage";

const KEY = "vin_raw_history";

export interface RawVinRecord {
  vin: string;
  source: string; // "ble-mode09" | "simulation" | "manual"
  ts: string;
}

export async function recordRawVin(vin: string, source: string): Promise<void> {
  const list = await storage.getItem<RawVinRecord[]>(KEY, []);
  list.unshift({ vin: (vin || "").toUpperCase(), source, ts: new Date().toISOString() });
  await storage.setItem(KEY, list.slice(0, 50));
}

export async function getRawVinHistory(): Promise<RawVinRecord[]> {
  return storage.getItem<RawVinRecord[]>(KEY, []);
}
