// Live System Monitor definitions — six subsystems, each a curated set of PIDs
// plus a heuristic status derived from live signals + DTCs. AI interpretation is
// fetched on demand. Transport-agnostic (reads normalized signals/history).

import { VehicleSignals, Dtc } from "../types";
import { api } from "@/src/api";
import { isCloudActive, runPreparedOnActive } from "@/src/ai/diagnosticAI";

export interface SystemDef {
  key: string;
  name: string;
  icon: string;
  pids: string[];          // keys into VehicleSignals / PID_CATALOG
  chartKey: string;        // primary signal to graph
}

export const SYSTEMS: SystemDef[] = [
  { key: "engine", name: "Engine", icon: "engine", chartKey: "rpm",
    pids: ["rpm", "engineLoad", "throttle", "timingAdvance", "knockRetard", "estHorsepower", "estTorque"] },
  { key: "transmission", name: "Transmission", icon: "car-shift-pattern", chartKey: "transTemp",
    pids: ["gear", "transTemp", "speed", "rpm"] },
  { key: "charging", name: "Charging System", icon: "car-battery", chartKey: "chargingVoltage",
    pids: ["batteryVoltage", "chargingVoltage", "targetVoltage", "alternatorLoad", "generatorDuty", "batteryCurrent"] },
  { key: "cooling", name: "Cooling System", icon: "coolant-temperature", chartKey: "coolantTemp",
    pids: ["coolantTemp", "oilTemp", "intakeAirTemp", "catalystTemp"] },
  { key: "fuel", name: "Fuel System", icon: "gas-station", chartKey: "longFuelTrim",
    pids: ["shortFuelTrim", "longFuelTrim", "afr", "lambda", "o2Voltage", "fuelPressure", "railPressure", "fuelLevel"] },
  { key: "emissions", name: "Emissions", icon: "molecule-co2", chartKey: "catalystTemp",
    pids: ["catalystTemp", "catalystTemp2", "o2Voltage", "o2Voltage2", "evap", "longFuelTrim"] },
];

export type SystemLevel = "good" | "warn" | "bad";

export function systemStatus(key: string, s: VehicleSignals, dtcs: Dtc[]): { level: SystemLevel; note: string } {
  const has = (p: string) => dtcs.some((d) => d.code.toUpperCase().startsWith(p));
  switch (key) {
    case "engine":
      if (has("P03") || (s.knockRetard ?? 0) > 4) return { level: "bad", note: "Misfire / knock activity detected" };
      if ((s.engineLoad ?? 0) > 95) return { level: "warn", note: "High sustained engine load" };
      return { level: "good", note: "Operating within normal parameters" };
    case "transmission":
      if ((s.transTemp ?? 0) > 100) return { level: "warn", note: "Transmission running warm" };
      return { level: "good", note: "Shift behaviour nominal" };
    case "charging":
      if ((s.rpm ?? 0) > 500 && (s.chargingVoltage ?? 14) < 13.4) return { level: "bad", note: "Charging voltage below target" };
      if ((s.batteryVoltage ?? 14) < 12.2) return { level: "warn", note: "Battery voltage low" };
      return { level: "good", note: "Alternator output healthy" };
    case "cooling":
      if ((s.coolantTemp ?? 0) > 104) return { level: "bad", note: "Coolant temperature high" };
      if ((s.coolantTemp ?? 0) > 99) return { level: "warn", note: "Coolant approaching upper limit" };
      return { level: "good", note: "Thermal management nominal" };
    case "fuel":
      if (has("P0171") || Math.abs(s.longFuelTrim ?? 0) > 10) return { level: "warn", note: "Fuel trims outside normal band" };
      return { level: "good", note: "Mixture control nominal" };
    case "emissions":
      if (has("P04") || has("P042")) return { level: "warn", note: "Emissions-related fault present" };
      return { level: "good", note: "Catalyst & EVAP nominal" };
    default:
      return { level: "good", note: "Nominal" };
  }
}

export async function interpretSystem(name: string, vehicle: string, context: any): Promise<string> {
  const payload = { kind: "system", title: name, vehicle, context };
  if (await isCloudActive()) {
    const res = await api.interpretDiagnostics(payload);
    return res?.interpretation || "";
  }
  const prep = await api.interpretDiagnostics(payload, true);
  const res = await runPreparedOnActive(prep);
  return res.text;
}
