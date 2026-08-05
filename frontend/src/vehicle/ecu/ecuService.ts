// ECU discovery service — derives the detected-module list from the normalized
// provider outputs (identity.ecuModules + calibrationIds/cvns) and the shared
// registry. Works identically in Simulation and BLE modes (reads only the
// normalized VehicleIdentity + ConnectionDiagnostics).

import { VehicleIdentity, ConnectionDiagnostics, Dtc } from "../types";
import { ECU_REGISTRY, EcuDef, moduleKeyForDtc } from "./ecuDatabase";

export interface DetectedModule {
  key: string;
  name: string;
  short: string;
  address: string;
  icon: string;
  status: "online" | "no_response";
  calibrationId: string | null;
  softwareVersion: string | null;
  functions: string[];
  dtcCount: number;
}

export function discoverModules(
  identity: VehicleIdentity | null,
  dtcs: Dtc[],
  diag: ConnectionDiagnostics | null,
  connected: boolean
): DetectedModule[] {
  const labels = identity?.ecuModules || [];
  const calIds = identity?.calibrationIds || [];
  const cvns = identity?.cvns || [];

  const dtcByModule: Record<string, number> = {};
  dtcs.forEach((d) => {
    const k = moduleKeyForDtc(d.code);
    dtcByModule[k] = (dtcByModule[k] || 0) + 1;
  });

  const detected: DetectedModule[] = [];
  ECU_REGISTRY.forEach((def: EcuDef, idx) => {
    const inList = labels.some((l) => def.match.test(l));
    if (!inList && !def.common) return;
    const isPowertrain = def.key === "pcm" || def.key === "tcm" || def.key === "tccm";
    const calibrationId = isPowertrain ? (calIds[def.key === "tcm" ? 1 : 0] || calIds[0] || null) : null;
    const softwareVersion = isPowertrain ? (cvns[def.key === "tcm" ? 1 : 0] || cvns[0] || null) : null;
    // Commonly-present modules that weren't explicitly enumerated may not answer.
    const status: DetectedModule["status"] = connected ? (inList || def.common ? "online" : "no_response") : "no_response";
    detected.push({
      key: def.key,
      name: def.name,
      short: def.short,
      address: def.address,
      icon: def.icon,
      status,
      calibrationId,
      softwareVersion,
      functions: def.functions,
      dtcCount: dtcByModule[def.key] || 0,
    });
  });
  // Powertrain first, then by DTC count desc.
  detected.sort((a, b) => (a.key === "pcm" ? -1 : b.key === "pcm" ? 1 : b.dtcCount - a.dtcCount));
  return detected;
}
