// Web/preview stub for the BLE transport. Metro picks this file on web so the
// native-only `react-native-ble-plx` is never pulled into the web bundle. The
// real implementation lives in ./bleProvider.ts (used on native builds).

import { AdapterInfo, BleStatusReport, Dtc, VehicleDataProvider, VehicleIdentity, VehicleSignals } from "./types";

export class BleProvider implements VehicleDataProvider {
  readonly mode = "ble" as const;
  private err() {
    return new Error("BLE transport is only available on a native build (not web/Expo Go preview).");
  }
  getStatusReport(): BleStatusReport {
    return {
      mode: "ble",
      runtimeProvider: "BLEProvider (web stub)",
      nativeBleAvailable: false,
      permissions: "n/a",
      bluetoothPoweredOn: null,
      adapterDiscovered: false,
      adapterConnected: false,
      servicesDiscovered: false,
      characteristicsDiscovered: false,
      elm327Initialized: false,
      protocol: "Unknown",
      vinReceived: false,
      dtcResponseReceived: false,
      ecuCommunication: false,
      pollingActive: false,
      simulatedDataGenerated: false,
      lastError: "Web preview cannot use BLE.",
    };
  }
  async scan(): Promise<AdapterInfo[]> {
    throw this.err();
  }
  async connect(): Promise<{ adapter: AdapterInfo; identity: VehicleIdentity }> {
    throw this.err();
  }
  async disconnect(): Promise<void> {}
  subscribe(_cb: (s: VehicleSignals) => void): () => void {
    return () => {};
  }
  async readDtcs(): Promise<Dtc[]> {
    throw this.err();
  }
  async clearDtcs(): Promise<void> {
    throw this.err();
  }
}
