// Static ECU capability registry. Maps detected module labels (from VIN
// enrichment) to canonical modules with their addresses, supported diagnostic
// functions and the DTC code family they own. Pure data — no transport coupling.

export type DtcFamily = "P" | "P-trans" | "C" | "B" | "B-srs" | "U";

export interface EcuDef {
  key: string;
  name: string;          // canonical display name
  short: string;
  address: string;       // logical CAN address (11-bit)
  match: RegExp;         // matches identity.ecuModules labels
  family: DtcFamily;     // which DTC prefix this module reports
  functions: string[];   // supported diagnostic services
  icon: string;
  common?: boolean;      // commonly present even if not in ecuModules list
}

export const ECU_REGISTRY: EcuDef[] = [
  {
    key: "pcm", name: "Powertrain Control Module", short: "PCM/ECM", address: "0x7E0",
    match: /ecm|pcm|engine|powertrain/i, family: "P", icon: "engine", common: true,
    functions: ["Live Data (Mode 01)", "Freeze Frame (Mode 02)", "Stored DTCs (Mode 03)", "Clear DTCs (Mode 04)", "O2 Monitors (Mode 05)", "On-board Monitors (Mode 06)", "Pending DTCs (Mode 07)", "VIN/CalID (Mode 09)"],
  },
  {
    key: "tcm", name: "Transmission Control Module", short: "TCM", address: "0x7E1",
    match: /tcm|transmission/i, family: "P-trans", icon: "car-shift-pattern",
    functions: ["Live Data", "Stored DTCs", "Pending DTCs", "Adaptive Learn", "Clear DTCs"],
  },
  {
    key: "abs", name: "ABS / ESP Module", short: "ABS", address: "0x760",
    match: /abs|esp|esc/i, family: "C", icon: "car-brake-abs",
    functions: ["Wheel Speed Data", "Stored DTCs", "Actuator Test", "Clear DTCs"],
  },
  {
    key: "srs", name: "Airbag / SRS Module", short: "SRS", address: "0x758",
    match: /srs|airbag/i, family: "B-srs", icon: "car-seat",
    functions: ["Crash Data", "Stored DTCs", "Occupancy Status", "Clear DTCs"],
  },
  {
    key: "bcm", name: "Body Control Module", short: "BCM", address: "0x740",
    match: /bcm|body/i, family: "B", icon: "car-door",
    functions: ["Live Data", "Stored DTCs", "Actuator Test", "Clear DTCs"],
  },
  {
    key: "steering", name: "Steering Control Module", short: "EPS", address: "0x730",
    match: /steer|eps/i, family: "C", icon: "steering", common: true,
    functions: ["Torque Sensor Data", "Stored DTCs", "Calibration"],
  },
  {
    key: "cluster", name: "Instrument Cluster", short: "IPC", address: "0x720",
    match: /ipc|cluster|instrument/i, family: "U", icon: "gauge",
    functions: ["Gauge Data", "Odometer", "Stored DTCs", "Warning Lamps"],
  },
  {
    key: "hvac", name: "HVAC Module", short: "HVAC", address: "0x744",
    match: /hvac|climate|a\/c/i, family: "B", icon: "air-conditioner", common: true,
    functions: ["Temperature Data", "Blower Control", "Stored DTCs"],
  },
  {
    key: "tpms", name: "TPMS Module", short: "TPMS", address: "0x751",
    match: /tpms|tire pressure/i, family: "C", icon: "car-tire-alert", common: true,
    functions: ["Tire Pressure Data", "Sensor IDs", "Stored DTCs"],
  },
  {
    key: "tccm", name: "Transfer Case Module", short: "TCCM", address: "0x7E2",
    match: /tccm|transfer/i, family: "P", icon: "car-4x4",
    functions: ["Range Status", "Stored DTCs", "Actuator Test"],
  },
];

// Which module owns a DTC code.
export function moduleKeyForDtc(code: string): string {
  const c = (code || "").toUpperCase();
  if (c.startsWith("B0")) return "srs";        // airbag range (approx)
  if (c.startsWith("B")) return "bcm";
  if (c.startsWith("C")) return "abs";
  if (c.startsWith("U")) return "cluster";
  if (/^P07\d/.test(c)) return "tcm";          // transmission P07xx
  return "pcm";                                // powertrain default
}
