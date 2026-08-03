import { PidMeta, VehicleData, VehicleSignals } from "./types";

// Diagnostic health engine — evaluates sensor relationships (not just values)
// to score subsystems and surface likely faults with confidence.

export type HealthLevel = "good" | "warn" | "bad";
export interface Subsystem {
  name: string;
  score: number;
  status: HealthLevel;
}

const lvl = (s: number): HealthLevel => (s >= 80 ? "good" : s >= 65 ? "warn" : "bad");

export function computeSubsystems(d: VehicleData): Subsystem[] {
  const s = d.signals;
  const has = (c: string) => d.dtcs.some((x) => x.code === c);
  const hasPrefix = (p: string) => d.dtcs.some((x) => x.code.startsWith(p));

  const engine = 100 - (hasPrefix("P03") ? 34 : 0) - (Math.abs(s.knockRetard) > 3 ? 10 : 0);
  const fuel = 100 - (has("P0171") || Math.abs(s.longFuelTrim) > 8 ? 32 : 0) - (Math.abs(s.shortFuelTrim) > 12 ? 8 : 0);
  const cooling = 100 - (s.coolantTemp > 104 ? 40 : s.coolantTemp > 99 ? 18 : 0) - (has("P0128") ? 12 : 0);
  const charging = 100 - (s.batteryVoltage < 12.2 ? 30 : 0) - (s.chargingVoltage < 13.6 ? 22 : 0);
  const ignition = 100 - (hasPrefix("P03") ? 24 : 0) - (s.knockRetard > 2 ? 10 : 0);
  const emissions = 100 - (hasPrefix("P04") ? 22 : 0) - (!d.identity?.emissionsReady ? 10 : 0);
  const electrical = 100 - (s.batteryVoltage < 12.3 ? 18 : 0);
  const trans = 100 - (s.transTemp > 100 ? 20 : 0);

  const mk = (name: string, score: number): Subsystem => {
    const v = Math.max(0, Math.min(100, Math.round(score)));
    return { name, score: v, status: lvl(v) };
  };

  return [
    mk("Engine", engine),
    mk("Transmission", trans),
    mk("Fuel", fuel),
    mk("Ignition", ignition),
    mk("Cooling", cooling),
    mk("Charging", charging),
    mk("Emissions", emissions),
    mk("Electrical", electrical),
    mk("ABS", 96),
    mk("Steering", 94),
    mk("Airbags", 100),
    mk("Drivetrain", 92),
  ];
}

export function overallHealth(subs: Subsystem[]): number {
  return Math.round(subs.reduce((a, x) => a + x.score, 0) / subs.length);
}

export interface AiFinding {
  title: string;
  detail: string;
  confidence: number;
  level: HealthLevel;
}

// Lightweight on-device heuristic reasoning (used offline / for instant hints;
// the deep explanation comes from the cloud AI engine).
export function analyzeFaults(d: VehicleData): AiFinding[] {
  const s = d.signals;
  const out: AiFinding[] = [];
  if (d.dtcs.some((x) => x.code.startsWith("P03"))) {
    out.push({
      title: "Misfire detected",
      detail: `P030x present with fuel trims (STFT ${s.shortFuelTrim.toFixed(0)}%, LTFT ${s.longFuelTrim.toFixed(0)}%). Likely ignition (plugs/coils) or a lean condition.`,
      confidence: 82,
      level: "bad",
    });
  }
  if (s.longFuelTrim > 8) {
    out.push({
      title: "Lean fuel mixture",
      detail: `Long-term fuel trim elevated at +${s.longFuelTrim.toFixed(0)}%. Suspect vacuum leak, weak fuel delivery, or dirty MAF.`,
      confidence: 74,
      level: "warn",
    });
  }
  if (s.chargingVoltage < 13.6 && s.rpm > 500) {
    out.push({
      title: "Charging system under target",
      detail: `Charging voltage ${s.chargingVoltage.toFixed(1)}V below the ~14.4V target. Check alternator output and belt.`,
      confidence: 69,
      level: "warn",
    });
  }
  if (s.coolantTemp > 100) {
    out.push({
      title: "Cooling running hot",
      detail: `Coolant at ${s.coolantTemp.toFixed(0)}°C. Verify thermostat, fan operation, and coolant level.`,
      confidence: 66,
      level: "warn",
    });
  }
  if (out.length === 0) {
    out.push({ title: "No abnormal sensor correlations", detail: "Live signals are within expected ranges.", confidence: 90, level: "good" });
  }
  return out;
}

// --- PID catalogue (drives gauges, graphs, sensor lists) --------------------
export const PID_CATALOG: PidMeta[] = [
  { key: "rpm", label: "Engine RPM", unit: "", min: 0, max: 7000, group: "Engine" },
  { key: "speed", label: "Vehicle Speed", unit: "km/h", min: 0, max: 200, group: "Engine" },
  { key: "engineLoad", label: "Engine Load", unit: "%", min: 0, max: 100, group: "Engine" },
  { key: "throttle", label: "Throttle Position", unit: "%", min: 0, max: 100, group: "Engine" },
  { key: "pedalPosition", label: "Accel Pedal", unit: "%", min: 0, max: 100, group: "Engine" },
  { key: "estHorsepower", label: "Est. Horsepower", unit: "hp", min: 0, max: 300, group: "Performance" },
  { key: "estTorque", label: "Est. Torque", unit: "Nm", min: 0, max: 360, group: "Performance" },
  { key: "map", label: "Manifold Press (MAP)", unit: "kPa", min: 0, max: 220, group: "Air/Fuel" },
  { key: "boost", label: "Boost Pressure", unit: "kPa", min: -60, max: 120, group: "Air/Fuel" },
  { key: "intakeVacuum", label: "Intake Vacuum", unit: "inHg", min: -8, max: 25, group: "Air/Fuel" },
  { key: "maf", label: "Mass Air Flow", unit: "g/s", min: 0, max: 260, group: "Air/Fuel" },
  { key: "afr", label: "Air/Fuel Ratio", unit: ":1", min: 10, max: 18, group: "Air/Fuel", decimals: 1 },
  { key: "lambda", label: "Lambda", unit: "λ", min: 0.7, max: 1.3, group: "Air/Fuel", decimals: 2 },
  { key: "shortFuelTrim", label: "Short Fuel Trim", unit: "%", min: -20, max: 20, group: "Air/Fuel", decimals: 1 },
  { key: "longFuelTrim", label: "Long Fuel Trim", unit: "%", min: -20, max: 20, group: "Air/Fuel", decimals: 1 },
  { key: "o2Voltage", label: "O2 Sensor B1", unit: "V", min: 0, max: 1, group: "Air/Fuel", decimals: 2 },
  { key: "o2Voltage2", label: "O2 Sensor B2", unit: "V", min: 0, max: 1, group: "Air/Fuel", decimals: 2 },
  { key: "fuelPressure", label: "Fuel Pressure", unit: "kPa", min: 0, max: 550, group: "Air/Fuel" },
  { key: "railPressure", label: "Rail Pressure", unit: "MPa", min: 0, max: 60, group: "Air/Fuel", decimals: 1 },
  { key: "evap", label: "EVAP Pressure", unit: "inH2O", min: -4, max: 2, group: "Air/Fuel", decimals: 1 },
  { key: "coolantTemp", label: "Coolant Temp", unit: "°C", min: 0, max: 130, group: "Temps" },
  { key: "oilTemp", label: "Oil Temp", unit: "°C", min: 0, max: 130, group: "Temps" },
  { key: "oilPressure", label: "Oil Pressure", unit: "psi", min: 0, max: 90, group: "Temps" },
  { key: "intakeAirTemp", label: "Intake Air Temp", unit: "°C", min: 0, max: 60, group: "Temps" },
  { key: "ambientTemp", label: "Ambient Temp", unit: "°C", min: 0, max: 50, group: "Temps" },
  { key: "transTemp", label: "Trans Temp", unit: "°C", min: 0, max: 120, group: "Temps" },
  { key: "catalystTemp", label: "Catalyst Temp B1", unit: "°C", min: 0, max: 800, group: "Temps" },
  { key: "catalystTemp2", label: "Catalyst Temp B2", unit: "°C", min: 0, max: 800, group: "Temps" },
  { key: "gear", label: "Transmission Gear", unit: "", min: 0, max: 8, group: "Drivetrain" },
  { key: "timingAdvance", label: "Timing Advance", unit: "°", min: 0, max: 45, group: "Ignition", decimals: 1 },
  { key: "ignitionTiming", label: "Ignition Timing", unit: "°", min: 0, max: 45, group: "Ignition", decimals: 1 },
  { key: "knockRetard", label: "Knock Retard", unit: "°", min: 0, max: 10, group: "Ignition", decimals: 1 },
  { key: "batteryVoltage", label: "Battery Voltage", unit: "V", min: 10, max: 15, group: "Charging", decimals: 1 },
  { key: "chargingVoltage", label: "Charging Voltage", unit: "V", min: 10, max: 15, group: "Charging", decimals: 1 },
  { key: "targetVoltage", label: "Target Voltage", unit: "V", min: 12, max: 15, group: "Charging", decimals: 1 },
  { key: "alternatorLoad", label: "Alternator Load", unit: "%", min: 0, max: 100, group: "Charging" },
  { key: "generatorDuty", label: "Generator Duty", unit: "%", min: 0, max: 100, group: "Charging" },
  { key: "batteryCurrent", label: "Battery Current", unit: "A", min: -20, max: 60, group: "Charging" },
  { key: "fuelLevel", label: "Fuel Level", unit: "%", min: 0, max: 100, group: "Fuel" },
  { key: "distanceToEmpty", label: "Distance to Empty", unit: "km", min: 0, max: 700, group: "Fuel" },
  { key: "baro", label: "Barometric Press", unit: "kPa", min: 80, max: 110, group: "Ambient" },
  { key: "runTime", label: "Engine Run Time", unit: "s", min: 0, max: 3600, group: "Ambient" },
  { key: "distanceMIL", label: "Distance w/ MIL", unit: "km", min: 0, max: 500, group: "Ambient" },
];
