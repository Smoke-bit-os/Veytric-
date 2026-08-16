// VIN decode service layer (separate from transports). Orchestrates the VPIC
// backend with a STRICTLY USER-SCOPED local cache so decoding works OFFLINE
// after the first hit WITHOUT ever leaking one account's data to another:
//
//   1) user-scoped cache  (storage: vin_decode:<uid>:<vin>) -> instant, offline
//   2) online provider (backend/NHTSA vPIC)                 -> authoritative
//   3) offline + no cache                                    -> "unavailable"
//
// Data-integrity rules:
//   - Reject invalid VINs (length/charset) BEFORE any network call.
//   - NEVER fabricate missing fields. Missing => empty (UI shows "Unavailable").
//   - Offline with no current-user cache => explicit unavailable state, never a
//     guess and never another user's cached data.

import { storage } from "@/src/utils/storage";
import { api } from "@/src/api";
import { VehicleIdentity } from "../types";
import { isChecksumValid, isValidVinFormat } from "./validator";

const UID_KEY = "jarvis_current_uid";

async function currentUid(): Promise<string> {
  const uid = await storage.getItem<string>(UID_KEY, "");
  return uid || "anon";
}

const cacheKey = (uid: string, vin: string) => `vin_decode:${uid}:${vin.toUpperCase()}`;

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

export type VinDecodeResult = Partial<VehicleIdentity> & { reason?: string; offline?: boolean };

export const vinService = {
  async decodeVin(vin: string, opts: { forceRefresh?: boolean } = {}): Promise<VinDecodeResult> {
    vin = (vin || "").trim().toUpperCase();
    if (!isValidVinFormat(vin)) {
      return {
        confidence: 0,
        decodeSource: "invalid",
        checksumValid: false,
        reason: "Invalid VIN. Please check the VIN and try again.",
      };
    }

    const uid = await currentUid();
    const key = cacheKey(uid, vin);

    // 1) user-scoped cache
    if (!opts.forceRefresh) {
      const cached = await storage.getItem<any>(key, null);
      if (cached) return { ...toIdentity(cached), decodeSource: "cache" };
    }

    // 2) online provider (backend -> NHTSA vPIC). Persist for offline reuse.
    try {
      const res = await api.decodeVin(vin);
      if (res && res.validFormat === false) {
        return { confidence: 0, decodeSource: "invalid", checksumValid: false, reason: res.reason };
      }
      if (res && (res.make || res.validFormat)) {
        await storage.setItem(key, { ...res, _cachedAt: Date.now() });
        return toIdentity(res);
      }
    } catch {
      // offline / backend unreachable -> fall through to unavailable
    }

    // 3) offline with NO current-user cache -> explicit unavailable state.
    //    We do NOT fabricate a vehicle and NEVER read another user's cache.
    return {
      confidence: 0,
      decodeSource: "offline_unavailable",
      checksumValid: isChecksumValid(vin),
      offline: true,
      reason: "Vehicle information unavailable offline. Connect to the internet to decode this VIN.",
    };
  },
};
