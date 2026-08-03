// OBD-II decoding utilities. Pure functions — no BLE/native dependency, so
// they are safe to import anywhere (incl. web) and unit-testable.
//
// Covers: Mode 01 (live data) decoders, supported-PID bitmask parsing,
// Mode 03 DTC decoding, Mode 09 VIN/CalID extraction.

import { VehicleSignals } from "../types";

// Extract data bytes for a given "41<PID>" response (Mode 01). Handles headers
// (ATH1), spaces, multiple ECUs (takes the first matching frame).
export function extractBytes(resp: string, mode: string, pid: string): number[] | null {
  const hex = resp.replace(/[\s>\r\n]/g, "").toUpperCase();
  const marker = mode + pid; // e.g. "410C"
  const idx = hex.indexOf(marker);
  if (idx < 0) return null;
  const dataHex = hex.slice(idx + marker.length);
  const bytes: number[] = [];
  for (let i = 0; i + 1 < dataHex.length; i += 2) {
    const b = parseInt(dataHex.substr(i, 2), 16);
    if (Number.isNaN(b)) break;
    bytes.push(b);
  }
  return bytes;
}

// Mode 01 PID decoders keyed by 2-char PID (without the mode prefix).
// Each returns a partial normalized signal set.
type Dec = (b: number[]) => Partial<VehicleSignals>;
export const MODE01: Record<string, { key: keyof VehicleSignals | ""; label: string; decode: Dec }> = {
  "04": { key: "engineLoad", label: "Calculated Load", decode: (b) => ({ engineLoad: (b[0] * 100) / 255 }) },
  "05": { key: "coolantTemp", label: "Coolant Temp", decode: (b) => ({ coolantTemp: b[0] - 40 }) },
  "06": { key: "shortFuelTrim", label: "STFT B1", decode: (b) => ({ shortFuelTrim: (b[0] - 128) * (100 / 128) }) },
  "07": { key: "longFuelTrim", label: "LTFT B1", decode: (b) => ({ longFuelTrim: (b[0] - 128) * (100 / 128) }) },
  "0A": { key: "fuelPressure", label: "Fuel Pressure", decode: (b) => ({ fuelPressure: b[0] * 3 }) },
  "0B": { key: "map", label: "Intake MAP", decode: (b) => ({ map: b[0] }) },
  "0C": { key: "rpm", label: "Engine RPM", decode: (b) => ({ rpm: (b[0] * 256 + b[1]) / 4 }) },
  "0D": { key: "speed", label: "Vehicle Speed", decode: (b) => ({ speed: b[0] }) },
  "0E": { key: "timingAdvance", label: "Timing Advance", decode: (b) => ({ timingAdvance: b[0] / 2 - 64, ignitionTiming: b[0] / 2 - 64 }) },
  "0F": { key: "intakeAirTemp", label: "Intake Air Temp", decode: (b) => ({ intakeAirTemp: b[0] - 40 }) },
  "10": { key: "maf", label: "MAF Rate", decode: (b) => ({ maf: (b[0] * 256 + b[1]) / 100 }) },
  "11": { key: "throttle", label: "Throttle Pos", decode: (b) => ({ throttle: (b[0] * 100) / 255 }) },
  "1F": { key: "runTime", label: "Run Time", decode: (b) => ({ runTime: b[0] * 256 + b[1] }) },
  "22": { key: "railPressure", label: "Fuel Rail Press (rel)", decode: (b) => ({ railPressure: ((b[0] * 256 + b[1]) * 0.079) / 1000 }) },
  "23": { key: "railPressure", label: "Fuel Rail Press (direct)", decode: (b) => ({ railPressure: ((b[0] * 256 + b[1]) * 10) / 1000 }) },
  "24": { key: "lambda", label: "O2 Lambda", decode: (b) => ({ lambda: ((b[0] * 256 + b[1]) * 2) / 65536, o2Voltage: ((b[2] * 256 + b[3]) * 8) / 65536 }) },
  "2F": { key: "fuelLevel", label: "Fuel Level", decode: (b) => ({ fuelLevel: (b[0] * 100) / 255 }) },
  "33": { key: "baro", label: "Barometric Press", decode: (b) => ({ baro: b[0] }) },
  "42": { key: "batteryVoltage", label: "Control Module V", decode: (b) => ({ batteryVoltage: (b[0] * 256 + b[1]) / 1000, chargingVoltage: (b[0] * 256 + b[1]) / 1000 }) },
  "45": { key: "pedalPosition", label: "Rel Throttle", decode: (b) => ({ pedalPosition: (b[0] * 100) / 255 }) },
  "46": { key: "ambientTemp", label: "Ambient Air Temp", decode: (b) => ({ ambientTemp: b[0] - 40 }) },
  "49": { key: "pedalPosition", label: "Accel Pedal D", decode: (b) => ({ pedalPosition: (b[0] * 100) / 255 }) },
  "5C": { key: "oilTemp", label: "Engine Oil Temp", decode: (b) => ({ oilTemp: b[0] - 40 }) },
  "3C": { key: "catalystTemp", label: "Catalyst Temp B1S1", decode: (b) => ({ catalystTemp: (b[0] * 256 + b[1]) / 10 - 40 }) },
  "3E": { key: "catalystTemp2", label: "Catalyst Temp B2S1", decode: (b) => ({ catalystTemp2: (b[0] * 256 + b[1]) / 10 - 40 }) },
};

// The Mode 01 PIDs we actively poll for the live dashboard (in priority order).
export const POLL_PIDS = [
  "0C", "0D", "04", "11", "05", "0B", "10", "0F", "06", "07", "0E",
  "2F", "42", "33", "24", "1F", "5C", "46", "3C", "0A", "45",
];

// Parse the 4-byte bitmask returned by 0100/0120/0140/0160 into supported PIDs.
export function parseSupportedPids(resp: string, base: number): string[] {
  const marker = "41" + base.toString(16).padStart(2, "0").toUpperCase();
  const bytes = extractBytes(resp, "41", base.toString(16).padStart(2, "0").toUpperCase());
  if (!bytes || bytes.length < 4) return [];
  const supported: string[] = [];
  const bits = (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  for (let i = 0; i < 32; i++) {
    if (bits & (0x80000000 >>> i)) {
      supported.push((base + i + 1).toString(16).padStart(2, "0").toUpperCase());
    }
  }
  return supported;
}

// Mode 03 — decode stored DTCs. Handles the optional leading count byte and
// multi-frame concatenation.
export function decodeDtcs(resp: string, type: "current" | "pending" | "permanent" = "current") {
  const hex = resp.replace(/[\s>\r\n]/g, "").toUpperCase();
  const modeByte = type === "pending" ? "47" : type === "permanent" ? "4A" : "43";
  let body = hex;
  const idx = hex.indexOf(modeByte);
  if (idx >= 0) body = hex.slice(idx + 2);
  const out: { code: string; desc: string; type: typeof type }[] = [];
  for (let i = 0; i + 3 < body.length; i += 4) {
    const raw = body.substr(i, 4);
    if (raw === "0000" || /[^0-9A-F]/.test(raw)) continue;
    const first = parseInt(raw[0], 16);
    const letter = ["P", "C", "B", "U"][first >> 2];
    const code = `${letter}${(first & 3).toString()}${raw.slice(1)}`;
    if (!out.find((d) => d.code === code)) out.push({ code, desc: "See diagnostic database", type });
  }
  return out;
}

// Mode 09 PID 02 — VIN. ELM327 (with headers) returns ISO-TP frames; we strip
// framing and pull the 17-char VIN out of the ASCII payload.
export function decodeVin(resp: string): string {
  const hex = resp.replace(/[\s>\r\n]/g, "").toUpperCase();
  // remove the "4902" markers and per-frame index bytes best-effort
  const cleaned = hex.replace(/4902[0-9A-F]{2}/g, "");
  let ascii = "";
  for (let i = 0; i + 1 < cleaned.length; i += 2) {
    const c = parseInt(cleaned.substr(i, 2), 16);
    if (c >= 32 && c <= 126) ascii += String.fromCharCode(c);
  }
  const m = ascii.match(/[A-HJ-NPR-Z0-9]{17}/);
  return m ? m[0] : "";
}

// Map ELM327 ATDPN protocol number -> human name.
export function protocolName(dpn: string): string {
  const n = dpn.replace(/[^0-9A]/gi, "").slice(-1).toUpperCase();
  const map: Record<string, string> = {
    "0": "Automatic",
    "1": "SAE J1850 PWM",
    "2": "SAE J1850 VPW",
    "3": "ISO 9141-2",
    "4": "ISO 14230-4 KWP (5-baud)",
    "5": "ISO 14230-4 KWP (fast)",
    "6": "ISO 15765-4 CAN (11-bit, 500k)",
    "7": "ISO 15765-4 CAN (29-bit, 500k)",
    "8": "ISO 15765-4 CAN (11-bit, 250k)",
    "9": "ISO 15765-4 CAN (29-bit, 250k)",
    A: "SAE J1939 CAN",
  };
  return map[n] || "Unknown";
}
