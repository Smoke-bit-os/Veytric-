// VEYTRIC — BLE Vehicle Provider ADAPTER (Prompt 1, Phase 1B)
// Wraps the VERIFIED VehicleDataProvider (frontend/src/vehicle/*) and translates
// its existing outputs into normalized MEASURED EvidenceRecords. It does NOT
// change the BLE engine, command queue, parsing, or the provider interface.
//
// MEASURED is emitted ONLY when a REAL ECU response has been received
// (BleStatusReport.ecuCommunication === true). Otherwise the adapter throws a
// structured ProviderError so the Capability Router returns UNAVAILABLE — never
// a fabricated value, never a silent switch to simulation.
import {
  makeMeasured,
  SourceType,
  Freshness,
  EvidenceRecord,
} from "@/src/evidence";
import {
  CapabilityRequest,
  Capability,
  Platform,
  Provider,
  ProviderError,
  ProviderErrorCode,
  RouterContext,
} from "../registry";
import { AuthorityZone } from "@/src/evidence";

// Minimal duck-typed view of the verified provider (keeps this adapter free of
// React Native imports so it is unit-testable in Node).
export interface WrappedVehicleProvider {
  mode: "ble" | "simulation";
  readDtcs(): Promise<{ code: string; desc: string; type: string }[]>;
  getDiagnostics?(): { voltage: number; protocol: string } | null;
  getStatusReport?(): {
    ecuCommunication: boolean;
    protocol: string;
    lastRealPid?: string;
    vinReceived: boolean;
  };
  // Latest live snapshot (adapter caches the newest frame via subscribe()).
  getLatestSignals?(): Record<string, number> | null;
  getIdentity?(): { vin?: string } | null;
}

const CAPS: Capability[] = [
  "vehicle.read_dtcs",
  "vehicle.read_vin",
  "vehicle.read_voltage",
  "vehicle.live_pid",
];

export class BleVehicleAdapter implements Provider {
  providerId = "vehicle.ble";
  providerVersion = "1.0.0";
  providerType = "vehicle" as const;
  authorityZone = AuthorityZone.ZONE1_VEHICLE;
  platforms: Platform[] = ["ios", "android"];
  capabilities = CAPS;
  canProduceMeasured = true;
  timeoutMs = 8000;
  priority = 10;

  constructor(private provider: WrappedVehicleProvider) {}

  isAvailable(): boolean {
    return this.provider.mode === "ble";
  }

  health() {
    const s = this.provider.getStatusReport?.();
    return s?.ecuCommunication ? ("ok" as const) : ("degraded" as const);
  }

  private requireEcu(): { protocol: string } {
    const s = this.provider.getStatusReport?.();
    if (!s || !s.ecuCommunication)
      throw new ProviderError(ProviderErrorCode.Disconnected,
        "No real ECU response yet (not connected / no measurement).", this.providerId);
    return { protocol: s.protocol };
  }

  async execute(req: CapabilityRequest, _ctx: RouterContext): Promise<EvidenceRecord[]> {
    const common = {
      userId: req.userId,
      vehicleId: req.vehicleId ?? undefined,
      sessionId: req.sessionId ?? undefined,
      providerId: this.providerId,
      providerVersion: this.providerVersion,
      transport: "ble",
    };

    switch (req.capability) {
      case "vehicle.read_dtcs": {
        const { protocol } = this.requireEcu();
        const dtcs = await this.provider.readDtcs();
        // An empty list is a valid MEASURED result ("no codes"): emit one record.
        if (dtcs.length === 0) {
          return [makeMeasured({
            ...common, protocol, requestMode: "03", sourceType: SourceType.VEHICLE_OBD,
            decodedName: "Stored DTC count", decodedValue: 0, decodedUnit: "codes",
            rawRequest: "03",
          })];
        }
        return dtcs.map((d) => makeMeasured({
          ...common, protocol, requestMode: "03", sourceType: SourceType.VEHICLE_OBD,
          decodedName: `DTC ${d.code}`, decodedValue: d.code, decodedUnit: d.type,
          rawRequest: "03",
        }));
      }

      case "vehicle.read_vin": {
        this.requireEcu();
        const vin = this.provider.getIdentity?.()?.vin;
        if (!vin)
          throw new ProviderError(ProviderErrorCode.Unavailable, "VIN not received", this.providerId);
        return [makeMeasured({
          ...common, requestMode: "09", sourceType: SourceType.VEHICLE_OBD,
          decodedName: "VIN", decodedValue: vin, rawRequest: "0902",
          quality: undefined,
        })];
      }

      case "vehicle.read_voltage": {
        this.requireEcu();
        const d = this.provider.getDiagnostics?.();
        if (!d || typeof d.voltage !== "number")
          throw new ProviderError(ProviderErrorCode.Unavailable, "Voltage unavailable", this.providerId);
        return [makeMeasured({
          ...common, protocol: d.protocol, sourceType: SourceType.MEASUREMENT_DEVICE,
          decodedName: "Adapter voltage", decodedValue: Math.round(d.voltage * 10) / 10,
          decodedUnit: "V", rawRequest: "ATRV",
        })];
      }

      case "vehicle.live_pid": {
        const { protocol } = this.requireEcu();
        const key = req.params?.pidKey as string | undefined;
        const snap = this.provider.getLatestSignals?.();
        if (!key || !snap || typeof snap[key] !== "number")
          throw new ProviderError(ProviderErrorCode.Unavailable, `PID ${key ?? "?"} unavailable`, this.providerId);
        return [makeMeasured({
          ...common, protocol, requestMode: "01", pid: key, sourceType: SourceType.VEHICLE_OBD,
          decodedName: key, decodedValue: snap[key], freshness: Freshness.LIVE,
        })];
      }

      default:
        throw new ProviderError(ProviderErrorCode.Unsupported,
          `${req.capability} not supported by BLE adapter`, this.providerId);
    }
  }
}
