// Production BLE transport for Innova Wireless / ELM327-compatible OBD-II
// adapters. Implements the full VehicleDataProvider contract so the UI / AI /
// diagnostics layers require ZERO changes vs. Simulation.
//
// ⚠️ NATIVE-ONLY (react-native-ble-plx). Not runnable in Expo Go / web preview.
// Activate on a native dev/production build with EXPO_PUBLIC_VEHICLE_MODE=ble.

import {
  AdapterInfo,
  ConnectionDiagnostics,
  Dtc,
  FreezeFrame,
  ObdLogEntry,
  VehicleDataProvider,
  VehicleIdentity,
  VehicleSignals,
} from "./types";
import { Elm327Connection } from "./obd/elm327";
import { MODE01, POLL_PIDS, decodeDtcs, decodeVin, extractBytes } from "./obd/decoders";

// Adapters whose advertised name matches are treated as OBD-II scanners.
const NAME_MATCH = /obd|elm|innova|vgate|viecar|ediag|obdii|konnwei|veepeak/i;

function rssiQuality(rssi: number): AdapterInfo["quality"] {
  if (rssi > -55) return "excellent";
  if (rssi > -67) return "good";
  if (rssi > -80) return "fair";
  return "poor";
}

export class BleProvider implements VehicleDataProvider {
  readonly mode = "ble" as const;
  private manager: any = null;
  private device: any = null;
  private elm: Elm327Connection | null = null;
  private adapterInfo: AdapterInfo | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private signalCb: ((s: VehicleSignals) => void) | null = null;
  private connCbs: ((connected: boolean) => void)[] = [];
  private reconnectAttempts = 0;
  private lastAdapterId: string | null = null;
  private manualDisconnect = false;

  private getManager() {
    if (!this.manager) {
      const { BleManager } = require("react-native-ble-plx");
      this.manager = new BleManager();
    }
    return this.manager;
  }

  // --- Automatic adapter detection -----------------------------------------
  async scan(): Promise<AdapterInfo[]> {
    const manager = this.getManager();
    const found: Record<string, AdapterInfo> = {};
    return new Promise((resolve, reject) => {
      manager.startDeviceScan(null, { allowDuplicates: false }, (error: any, device: any) => {
        if (error) {
          manager.stopDeviceScan();
          return reject(error);
        }
        const name: string = device?.name || device?.localName || "";
        if (name && NAME_MATCH.test(name)) {
          found[device.id] = {
            id: device.id,
            name,
            model: name,
            rssi: device.rssi ?? -70,
            battery: null,
            firmware: null,
            protocol: "auto",
            quality: rssiQuality(device.rssi ?? -70),
          };
        }
      });
      setTimeout(() => {
        manager.stopDeviceScan();
        resolve(Object.values(found));
      }, 6000);
    });
  }

  async connect(adapterId?: string): Promise<{ adapter: AdapterInfo; identity: VehicleIdentity }> {
    if (!adapterId) throw new Error("adapterId required for BLE connect");
    const manager = this.getManager();
    this.manualDisconnect = false;
    this.lastAdapterId = adapterId;

    this.device = await manager.connectToDevice(adapterId, { requestMTU: 247 });
    await this.device.discoverAllServicesAndCharacteristics();

    // Auto-reconnect wiring.
    this.device.onDisconnected((_err: any) => {
      this.connCbs.forEach((cb) => cb(false));
      if (!this.manualDisconnect) this.attemptReconnect();
    });

    this.elm = new Elm327Connection(this.device);
    await this.elm.start();
    await this.elm.init();

    const identity = await this.readIdentity();
    this.adapterInfo = {
      id: this.device.id,
      name: this.device.name || "OBD-II Adapter",
      model: this.device.name || "ELM327",
      rssi: this.device.rssi ?? -60,
      battery: null,
      firmware: await this.readFirmware(),
      protocol: this.elm.protocol,
      quality: rssiQuality(this.device.rssi ?? -60),
    };
    this.reconnectAttempts = 0;
    this.connCbs.forEach((cb) => cb(true));
    return { adapter: this.adapterInfo, identity };
  }

  private async readFirmware(): Promise<string | null> {
    try {
      const r = await this.elm!.send("ATI");
      return r?.trim() || null;
    } catch {
      return null;
    }
  }

  async disconnect(): Promise<void> {
    this.manualDisconnect = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    await this.elm?.stop();
    if (this.device) await this.device.cancelConnection().catch(() => {});
    this.device = null;
    this.elm = null;
  }

  async reconnect(): Promise<void> {
    if (!this.lastAdapterId) throw new Error("No previous adapter to reconnect");
    await this.connect(this.lastAdapterId);
    if (this.signalCb) this.subscribe(this.signalCb);
  }

  private async attemptReconnect() {
    if (this.reconnectAttempts >= 3 || !this.lastAdapterId) return;
    this.reconnectAttempts++;
    await new Promise((r) => setTimeout(r, 1500 * this.reconnectAttempts));
    try {
      await this.reconnect();
    } catch {
      this.attemptReconnect();
    }
  }

  // --- Live data polling with unsupported-PID fallback ----------------------
  subscribe(cb: (signals: VehicleSignals) => void): () => void {
    this.signalCb = cb;
    const merged: Partial<VehicleSignals> = {};
    this.pollTimer = setInterval(async () => {
      if (!this.elm) return;
      for (const pid of POLL_PIDS) {
        if (!this.elm.isSupported(pid)) continue; // skip unsupported
        const dec = MODE01[pid];
        if (!dec) continue;
        try {
          const resp = await this.elm.send("01" + pid, 1500);
          if (/NO DATA|ERROR|UNABLE/.test(resp)) continue;
          const bytes = extractBytes(resp, "41", pid);
          if (bytes && bytes.length) Object.assign(merged, dec.decode(bytes));
        } catch {
          /* transient — keep last value */
        }
      }
      // derived signals
      if (merged.map != null) merged.boost = merged.map - (merged.baro ?? 101);
      cb(merged as VehicleSignals);
    }, 1100);
    return () => {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = null;
    };
  }

  async readDtcs(): Promise<Dtc[]> {
    if (!this.elm) return [];
    const [cur, pend] = await Promise.all([
      this.elm.send("03").catch(() => ""),
      this.elm.send("07").catch(() => ""),
    ]);
    return [...decodeDtcs(cur, "current"), ...decodeDtcs(pend, "pending")] as Dtc[];
  }

  async clearDtcs(): Promise<void> {
    await this.elm?.send("04");
  }

  async readFreezeFrame(): Promise<FreezeFrame | null> {
    if (!this.elm) return null;
    // Mode 02 freeze frame (frame 00) for key PIDs captured when the DTC set.
    const pids = ["0C", "0D", "05", "0B", "10", "11", "04"];
    const signals: Partial<VehicleSignals> = {};
    for (const pid of pids) {
      try {
        const resp = await this.elm.send("02" + pid + "00", 1500);
        const bytes = extractBytes(resp, "42", pid);
        const dec = MODE01[pid];
        if (bytes && dec) Object.assign(signals, dec.decode(bytes));
      } catch {}
    }
    let code = "";
    try {
      const dtcResp = await this.elm.send("0202");
      code = decodeDtcs(dtcResp)[0]?.code || "";
    } catch {}
    return { code, captured: new Date().toISOString(), signals };
  }

  private async readIdentity(): Promise<VehicleIdentity> {
    const vinResp = await this.elm!.send("0902", 6000).catch(() => "");
    const vin = decodeVin(vinResp);
    const calResp = await this.elm!.send("0904", 6000).catch(() => "");
    const calAscii = asciiFrom(calResp);
    const ecuResp = await this.elm!.send("090A", 6000).catch(() => "");
    return {
      vin: vin || "UNKNOWN",
      year: 0,
      make: "",
      model: "",
      trim: "",
      engine: "",
      transmission: "",
      driveType: "",
      fuelType: "",
      odometer: null,
      emissionsReady: false,
      protocols: [this.elm!.protocol],
      ecu: asciiFrom(ecuResp).trim() || "ECU",
      calibrationIds: calAscii ? [calAscii.trim()] : [],
      cvns: [],
    };
  }

  getDiagnostics(): ConnectionDiagnostics | null {
    if (!this.adapterInfo || !this.elm) return null;
    return {
      adapterName: this.adapterInfo.name,
      deviceId: this.adapterInfo.id,
      protocol: this.elm.protocol,
      voltage: this.elm.voltage,
      latencyMs: this.elm.lastLatencyMs,
      quality: this.adapterInfo.quality,
      supportedPidCount: this.elm.supportedPids.size,
      reconnectAttempts: this.reconnectAttempts,
    };
  }

  getLog(): ObdLogEntry[] {
    return this.elm?.log ?? [];
  }

  onConnectionChange(cb: (connected: boolean) => void): () => void {
    this.connCbs.push(cb);
    return () => {
      this.connCbs = this.connCbs.filter((c) => c !== cb);
    };
  }
}

function asciiFrom(hex: string): string {
  const clean = hex.replace(/[\s>\r\n]/g, "").toUpperCase();
  let out = "";
  for (let i = 0; i + 1 < clean.length; i += 2) {
    const c = parseInt(clean.substr(i, 2), 16);
    if (c >= 32 && c <= 126) out += String.fromCharCode(c);
  }
  return out;
}
