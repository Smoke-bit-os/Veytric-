// VIN decode service layer (separate from transports). Orchestrates multiple
// providers with a local cache so decoding works OFFLINE after the first hit:
//
//   1) local cache  (storage)         -> instant, offline
//   2) online provider (backend/NHTSA) -> authoritative, high confidence
//   3) local heuristic decoder         -> offline fallback
//
// Returns a Partial<VehicleIdentity> that is merged into the active vehicle
// profile. Adding another provider = extend decodeRemote / the backend.

import { storage } from "@/src/utils/storage";
import { api } from "@/src/api";
import { VehicleIdentity } from "../types";
import { localDecodeVin } from "./localDecoder";
import { isChecksumValid, isValidVinFormat } from "./validator";

const cacheKey = (vin: string) => `vin_decode_${vin.toUpperCase()}`;

// Standard OBD-II module set surfaced as "ECU modules detected".
function ecuModulesFor(drivetrain: string): string[] {
  const base = ["ECM (Engine)", "TCM (Transmission)", "ABS/ESP", "BCM (Body)", "PCM (Powertrain)"];
  if (/4wd|awd|4x4/i.test(drivetrain || "")) base.push("TCCM (Transfer Case)");
  base.push("IPC (Cluster)", "SRS (Airbag)");
  return base;
}

function toIdentity(d: any): Partial<VehicleIdentity> {
  return {
    year: d.year || 0,
    make: d.make || "",
    model: d.model || "",
    trim: d.trim || "",
    engine: d.engine || "",
    transmission: d.transmission || "",
    driveType: d.drivetrain || d.driveType || "",
    plant: d.plant || "",
    country: d.country || "",
    confidence: d.confidence ?? 0,
    decodeSource: d.source || d.decodeSource || "local",
    checksumValid: d.checksumValid ?? isChecksumValid(d.vin || ""),
    ecuModules: ecuModulesFor(d.drivetrain || d.driveType || ""),
  };
}

export const vinService = {
  async decodeVin(vin: string): Promise<Partial<VehicleIdentity>> {
    vin = (vin || "").trim().toUpperCase();
    if (!isValidVinFormat(vin)) {
      return { confidence: 0, decodeSource: "invalid", checksumValid: false };
    }

    // 1) cache
    const cached = await storage.getItem<any>(cacheKey(vin), null);
    if (cached) return { ...toIdentity(cached), decodeSource: "cache" };

    // 2) online provider (backend -> NHTSA + local fallback)
    try {
      const res = await api.decodeVin(vin);
      if (res && (res.make || res.validFormat)) {
        await storage.setItem(cacheKey(vin), res); // enables offline next time
        return toIdentity(res);
      }
    } catch {
      /* offline / backend unreachable -> local fallback */
    }

    // 3) local heuristic fallback
    const local = localDecodeVin(vin);
    const result = {
      ...local,
      vin,
      confidence: local.make !== "Unknown" ? (local.checksumValid ? 0.6 : 0.45) : 0.3,
      source: "local",
    };
    await storage.setItem(cacheKey(vin), result);
    return toIdentity(result);
  },
};
