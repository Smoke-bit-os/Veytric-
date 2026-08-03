// Backwards-compatible shim. The vehicle data layer now lives in ./vehicle/*
// behind a swappable VehicleDataProvider (Simulation active; BLE ready for
// native builds). Existing screens keep importing from here unchanged.

import { computeSubsystems, overallHealth, Subsystem } from "./vehicle/health";
import { useVehicle } from "./vehicle/service";

export { VehicleServiceProvider as TelemetryProvider } from "./vehicle/service";
export { useVehicle as useTelemetry } from "./vehicle/service";
export type HealthSystem = Subsystem;

// Legacy signature: accepts the flattened telemetry object used by older screens.
export function computeHealth(data: any): Subsystem[] {
  return computeSubsystems({
    signals: data,
    dtcs: (data?.dtcs || []).map((d: any) => ({ ...d, type: "current" })),
    identity: null,
    phase: "cruise",
    connected: !!data?.connected,
  });
}

export { computeSubsystems, overallHealth, useVehicle };
