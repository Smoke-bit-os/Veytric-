// Enhanced diagnostic data derivation. Classifies DTCs by status and derives
// OBD-II readiness monitors + Mode-06 on-board monitor results from the
// normalized signals + DTC set. Works in both Simulation and BLE modes.

import { Dtc, VehicleSignals, VehicleIdentity } from "../types";

export interface ClassifiedDtcs {
  stored: Dtc[];      // confirmed / current
  pending: Dtc[];
  permanent: Dtc[];
  manufacturer: Dtc[];
  total: number;
}

export function classifyDtcs(dtcs: Dtc[]): ClassifiedDtcs {
  return {
    stored: dtcs.filter((d) => d.type === "current"),
    pending: dtcs.filter((d) => d.type === "pending"),
    permanent: dtcs.filter((d) => d.type === "permanent"),
    manufacturer: dtcs.filter((d) => d.type === "manufacturer"),
    total: dtcs.length,
  };
}

export type MonitorStatus = "ready" | "not_ready" | "not_supported";
export interface ReadinessMonitor {
  key: string;
  name: string;
  status: MonitorStatus;
}

// Standard OBD-II Mode 01 PID 01 monitor set.
export function readinessMonitors(identity: VehicleIdentity | null, dtcs: Dtc[]): ReadinessMonitor[] {
  const ready = identity?.emissionsReady ?? true;
  const has = (p: string) => dtcs.some((d) => d.code.toUpperCase().startsWith(p));
  const mk = (key: string, name: string, notReadyIf: boolean, supported = true): ReadinessMonitor => ({
    key, name,
    status: !supported ? "not_supported" : notReadyIf || !ready ? (notReadyIf ? "not_ready" : "not_ready") : "ready",
  });
  return [
    { key: "misfire", name: "Misfire Monitor", status: has("P03") ? "not_ready" : "ready" },
    { key: "fuel", name: "Fuel System Monitor", status: has("P017") || has("P0171") ? "not_ready" : "ready" },
    { key: "ccm", name: "Comprehensive Components", status: "ready" },
    { key: "catalyst", name: "Catalyst Monitor", status: has("P042") ? "not_ready" : ready ? "ready" : "not_ready" },
    { key: "hcat", name: "Heated Catalyst", status: "not_supported" },
    { key: "evap", name: "Evaporative System", status: has("P044") || has("P045") ? "not_ready" : "ready" },
    { key: "air", name: "Secondary Air System", status: "not_supported" },
    { key: "o2", name: "Oxygen Sensor Monitor", status: has("P013") || has("P014") ? "not_ready" : "ready" },
    { key: "o2h", name: "O2 Sensor Heater", status: has("P003") ? "not_ready" : "ready" },
    { key: "egr", name: "EGR / VVT System", status: has("P040") ? "not_ready" : ready ? "ready" : "not_ready" },
  ];
}

export interface Mode06Test {
  id: string;
  name: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  pass: boolean;
}

// Derive representative on-board monitor test results from live signals.
export function mode06Results(s: VehicleSignals, dtcs: Dtc[]): Mode06Test[] {
  const misfire = dtcs.some((d) => d.code.toUpperCase().startsWith("P03"));
  const lean = dtcs.some((d) => d.code === "P0171");
  const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
  const catEff = round(0.62 + Math.min(0.35, (s.catalystTemp || 400) / 2400), 2);
  const o2Switch = round(0.06 + Math.abs(0.45 - (s.o2Voltage ?? 0.45)) * 0.2, 3);
  const evapLeak = round(0.02 + Math.abs(s.evap ?? 0) * 0.01, 3);
  return [
    { id: "0x01", name: "O2 Sensor B1S1 Switch Time", value: o2Switch, min: 0.02, max: 0.12, unit: "s", pass: o2Switch <= 0.12 },
    { id: "0x21", name: "Catalyst Efficiency B1", value: catEff, min: 0.6, max: 1.0, unit: "ratio", pass: catEff >= 0.6 },
    { id: "0x3B", name: "EVAP System Leak", value: evapLeak, min: 0, max: 0.09, unit: '"Hg', pass: evapLeak <= 0.09 },
    { id: "0xA2", name: "Misfire Cyl. Count", value: misfire ? 14 : 0, min: 0, max: 5, unit: "cnt", pass: !misfire },
    { id: "0x05", name: "Fuel Trim Range B1", value: round((s.longFuelTrim ?? 0), 1), min: -10, max: 10, unit: "%", pass: !lean && Math.abs(s.longFuelTrim ?? 0) <= 10 },
  ];
}

// VIN verification: does the connected identity VIN match expected format/checksum?
export function verifyVin(identity: VehicleIdentity | null): { vin: string; valid: boolean; source: string } {
  const vin = identity?.vin || "";
  const valid = vin.length === 17 && !/[IOQ]/.test(vin) && (identity?.checksumValid ?? true);
  return { vin, valid, source: identity?.decodeSource || "obd" };
}
