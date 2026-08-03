// Normalized vehicle data model + provider abstraction.
// UI / AI / diagnostics consume ONLY these types and never know whether the
// underlying source is Simulation, an Innova/ELM327 BLE adapter, or a future
// Wi-Fi/USB tool. Swapping transports = swapping the provider implementation.

export type ConnectionStatus =
  | "idle"
  | "scanning"
  | "found"
  | "connecting"
  | "connected"
  | "failed"
  | "disconnected";

export type ProviderMode = "simulation" | "ble";

export interface AdapterInfo {
  id: string;
  name: string; // e.g. "Innova Wireless OBD-II"
  model: string;
  rssi: number; // signal strength dBm
  battery: number | null; // % if reported
  firmware: string | null;
  protocol: string; // e.g. "ISO 15765-4 CAN (11/500)"
  quality: "excellent" | "good" | "fair" | "poor";
}

export interface VehicleIdentity {
  vin: string;
  year: number;
  make: string;
  model: string;
  trim: string;
  engine: string;
  transmission: string;
  driveType: string;
  fuelType: string;
  odometer: number | null;
  emissionsReady: boolean;
  protocols: string[];
  ecu: string;
  calibrationIds: string[];
  cvns: string[];
}

export interface Dtc {
  code: string;
  desc: string;
  type: "current" | "pending" | "permanent" | "manufacturer";
}

// All live PIDs (numeric). Keep names stable — screens/graphs key off these.
export interface VehicleSignals {
  rpm: number;
  speed: number;
  coolantTemp: number;
  intakeAirTemp: number;
  ambientTemp: number;
  oilTemp: number;
  oilPressure: number;
  batteryVoltage: number;
  chargingVoltage: number;
  alternatorLoad: number;
  fuelPressure: number;
  railPressure: number;
  map: number;
  boost: number;
  maf: number;
  throttle: number;
  pedalPosition: number;
  engineLoad: number;
  ignitionTiming: number;
  timingAdvance: number;
  shortFuelTrim: number;
  longFuelTrim: number;
  o2Voltage: number;
  o2Voltage2: number;
  afr: number;
  lambda: number;
  evap: number;
  catalystTemp: number;
  catalystTemp2: number;
  transTemp: number;
  gear: number;
  knockRetard: number;
  baro: number;
  fuelLevel: number;
  distanceToEmpty: number;
  estHorsepower: number;
  estTorque: number;
  intakeVacuum: number;
  batteryCurrent: number;
  targetVoltage: number;
  generatorDuty: number;
  runTime: number;
  distanceMIL: number;
}

export type DrivePhase = "startup" | "warmup" | "idle" | "accel" | "cruise" | "decel";

export interface VehicleData {
  signals: VehicleSignals;
  dtcs: Dtc[];
  identity: VehicleIdentity | null;
  phase: DrivePhase;
  connected: boolean;
}

// Metadata describing each PID for gauges / graphs / sensor lists.
export interface PidMeta {
  key: keyof VehicleSignals;
  label: string;
  unit: string;
  min: number;
  max: number;
  group: string;
  decimals?: number;
}

// ---- The abstraction every transport implements ----------------------------
export interface VehicleDataProvider {
  readonly mode: ProviderMode;
  scan(): Promise<AdapterInfo[]>;
  connect(adapterId?: string): Promise<{ adapter: AdapterInfo; identity: VehicleIdentity }>;
  disconnect(): Promise<void>;
  // Subscribe to live signal frames. Returns an unsubscribe fn.
  subscribe(cb: (signals: VehicleSignals) => void): () => void;
  readDtcs(): Promise<Dtc[]>;
  clearDtcs(): Promise<void>;
}
