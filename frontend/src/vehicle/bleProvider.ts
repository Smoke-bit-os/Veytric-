// Production-ready BLE transport for ELM327-compatible OBD-II adapters
// (Innova Wireless, generic ELM327 clones). Implements the SAME
// VehicleDataProvider contract as SimulationProvider so the UI / AI / diagnostic
// layers require ZERO changes when switching to real hardware.
//
// ⚠️ NATIVE-ONLY: react-native-ble-plx is a native module. It does NOT run in
// Expo Go or the web preview — it requires a native dev/production build
// (Publish → Deploy → Generate build). It is therefore lazy-required so it is
// never bundled/executed in the preview. Set EXPO_PUBLIC_VEHICLE_MODE=ble in a
// native build to activate this transport.
//
// Standard ELM327 handshake used below:
//   ATZ (reset) -> ATE0 (echo off) -> ATL0 -> ATS0 -> ATSP0 (auto protocol)
//   0100 (probe supported PIDs) -> then poll mode-01 PIDs.
// Common OBD-II BLE service UUIDs vary by clone; the two most common are
// FFF0/FFF1(notify)/FFF2(write) and the Nordic UART 6E400001-... set.

import {
  AdapterInfo,
  Dtc,
  VehicleDataProvider,
  VehicleIdentity,
  VehicleSignals,
} from "./types";

// Candidate GATT service/characteristic UUIDs for ELM327 BLE adapters.
const SERVICE_CANDIDATES = [
  { service: "FFF0", notify: "FFF1", write: "FFF2" },
  { service: "FFE0", notify: "FFE1", write: "FFE1" },
  {
    service: "6E400001-B5A3-F393-E0A9-E50E24DCCA9E",
    notify: "6E400003-B5A3-F393-E0A9-E50E24DCCA9E",
    write: "6E400002-B5A3-F393-E0A9-E50E24DCCA9E",
  },
];

// Mode-01 PID -> signal decoders. Each returns a partial VehicleSignals.
// (A,B,C,D are the returned data bytes.) Extend as more PIDs are validated
// against the target adapter.
const PID_DECODERS: Record<string, { pid: string; decode: (b: number[]) => Partial<VehicleSignals> }> = {
  rpm: { pid: "010C", decode: (b) => ({ rpm: (b[0] * 256 + b[1]) / 4 }) },
  speed: { pid: "010D", decode: (b) => ({ speed: b[0] }) },
  coolantTemp: { pid: "0105", decode: (b) => ({ coolantTemp: b[0] - 40 }) },
  intakeAirTemp: { pid: "010F", decode: (b) => ({ intakeAirTemp: b[0] - 40 }) },
  map: { pid: "010B", decode: (b) => ({ map: b[0] }) },
  maf: { pid: "0110", decode: (b) => ({ maf: (b[0] * 256 + b[1]) / 100 }) },
  throttle: { pid: "0111", decode: (b) => ({ throttle: (b[0] * 100) / 255 }) },
  engineLoad: { pid: "0104", decode: (b) => ({ engineLoad: (b[0] * 100) / 255 }) },
  shortFuelTrim: { pid: "0106", decode: (b) => ({ shortFuelTrim: (b[0] - 128) * (100 / 128) }) },
  longFuelTrim: { pid: "0107", decode: (b) => ({ longFuelTrim: (b[0] - 128) * (100 / 128) }) },
  timingAdvance: { pid: "010E", decode: (b) => ({ timingAdvance: b[0] / 2 - 64 }) },
  fuelLevel: { pid: "012F", decode: (b) => ({ fuelLevel: (b[0] * 100) / 255 }) },
  baro: { pid: "0133", decode: (b) => ({ baro: b[0] }) },
  o2Voltage: { pid: "0114", decode: (b) => ({ o2Voltage: b[0] / 200 }) },
  runTime: { pid: "011F", decode: (b) => ({ runTime: b[0] * 256 + b[1] }) },
};

export class BleProvider implements VehicleDataProvider {
  readonly mode = "ble" as const;
  private manager: any = null;
  private device: any = null;
  private io: { service: string; notify: string; write: string } | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private getManager() {
    if (!this.manager) {
      // Lazy require — only evaluated on native when BLE mode is active.
      const { BleManager } = require("react-native-ble-plx");
      this.manager = new BleManager();
    }
    return this.manager;
  }

  async scan(): Promise<AdapterInfo[]> {
    const manager = this.getManager();
    const found: Record<string, AdapterInfo> = {};
    return new Promise((resolve) => {
      manager.startDeviceScan(null, null, (error: any, device: any) => {
        if (error) return;
        const name: string = device?.name || device?.localName || "";
        if (/obd|elm|innova|vgate|viecar|ediag/i.test(name)) {
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
    this.device = await manager.connectToDevice(adapterId, { requestMTU: 256 });
    await this.device.discoverAllServicesAndCharacteristics();
    this.io = await this.resolveIo();
    await this.initElm();
    const identity = await this.readIdentity();
    return {
      adapter: {
        id: this.device.id,
        name: this.device.name || "OBD-II Adapter",
        model: this.device.name || "ELM327",
        rssi: this.device.rssi ?? -60,
        battery: null,
        firmware: null,
        protocol: "auto",
        quality: rssiQuality(this.device.rssi ?? -60),
      },
      identity,
    };
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.device) await this.device.cancelConnection().catch(() => {});
    this.device = null;
  }

  subscribe(cb: (signals: VehicleSignals) => void): () => void {
    const partial: Partial<VehicleSignals> = {};
    this.pollTimer = setInterval(async () => {
      for (const dec of Object.values(PID_DECODERS)) {
        try {
          const resp = await this.sendObd(dec.pid);
          const bytes = parseObdBytes(resp, dec.pid);
          if (bytes) Object.assign(partial, dec.decode(bytes));
        } catch {
          /* skip unsupported PID */
        }
      }
      cb(partial as VehicleSignals);
    }, 1000);
    return () => {
      if (this.pollTimer) clearInterval(this.pollTimer);
      this.pollTimer = null;
    };
  }

  async readDtcs(): Promise<Dtc[]> {
    const resp = await this.sendObd("03");
    return decodeDtcs(resp);
  }

  async clearDtcs(): Promise<void> {
    await this.sendObd("04");
  }

  // --- ELM327 plumbing ------------------------------------------------------
  private async resolveIo() {
    const services = await this.device.services();
    for (const cand of SERVICE_CANDIDATES) {
      if (services.some((s: any) => s.uuid.toUpperCase().includes(cand.service))) return cand;
    }
    throw new Error("No compatible OBD-II GATT service found on adapter");
  }

  private async initElm() {
    for (const cmd of ["ATZ", "ATE0", "ATL0", "ATS0", "ATH1", "ATSP0", "0100"]) {
      await this.sendRaw(cmd);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  private async readIdentity(): Promise<VehicleIdentity> {
    const vinResp = await this.sendObd("0902").catch(() => "");
    const vin = decodeVin(vinResp);
    // Year/make/model resolution from VIN would use a decoder service post-connect.
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
      protocols: ["auto"],
      ecu: "",
      calibrationIds: [],
      cvns: [],
    };
  }

  private async sendObd(pid: string): Promise<string> {
    return this.sendRaw(pid);
  }

  private async sendRaw(cmd: string): Promise<string> {
    if (!this.device || !this.io) throw new Error("Not connected");
    const { Buffer } = require("buffer");
    const payload = Buffer.from(`${cmd}\r`).toString("base64");
    await this.device.writeCharacteristicWithoutResponseForService(
      this.io.service,
      this.io.write,
      payload
    );
    const char = await this.device.readCharacteristicForService(this.io.service, this.io.notify);
    return Buffer.from(char.value, "base64").toString("utf-8");
  }
}

function rssiQuality(rssi: number): AdapterInfo["quality"] {
  if (rssi > -55) return "excellent";
  if (rssi > -67) return "good";
  if (rssi > -80) return "fair";
  return "poor";
}

function parseObdBytes(resp: string, pid: string): number[] | null {
  const hex = resp.replace(/[\s>]/g, "").toUpperCase();
  const mode = "41" + pid.slice(2);
  const idx = hex.indexOf(mode);
  if (idx < 0) return null;
  const dataHex = hex.slice(idx + 4);
  const bytes: number[] = [];
  for (let i = 0; i + 1 < dataHex.length; i += 2) bytes.push(parseInt(dataHex.substr(i, 2), 16));
  return bytes;
}

function decodeDtcs(resp: string): Dtc[] {
  const hex = resp.replace(/[\s>]/g, "").toUpperCase();
  const out: Dtc[] = [];
  const body = hex.startsWith("43") ? hex.slice(2) : hex;
  for (let i = 0; i + 3 < body.length; i += 4) {
    const raw = body.substr(i, 4);
    if (raw === "0000") continue;
    const first = parseInt(raw[0], 16);
    const letter = ["P", "C", "B", "U"][first >> 2];
    const code = `${letter}${(first & 3).toString()}${raw.slice(1)}`;
    out.push({ code, desc: "See diagnostic database", type: "current" });
  }
  return out;
}

function decodeVin(resp: string): string {
  const hex = resp.replace(/[\s>]/g, "").toUpperCase();
  let ascii = "";
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const c = parseInt(hex.substr(i, 2), 16);
    if (c >= 32 && c <= 126) ascii += String.fromCharCode(c);
  }
  const m = ascii.match(/[A-HJ-NPR-Z0-9]{17}/);
  return m ? m[0] : "";
}
