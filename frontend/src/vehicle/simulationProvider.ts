// Realistic simulation transport. Runs a driving-cycle state machine that
// evolves 40+ PIDs over time (startup -> warmup -> idle -> accel -> cruise ->
// decel) with correlated behaviour: fuel trims react to load, O2 sensors
// switch, boost tracks throttle, charging voltage holds ~14.2V, transmission
// shifts by speed. Implements the same VehicleDataProvider contract as BLE.

import {
  AdapterInfo,
  BleStatusReport,
  ConnectionDiagnostics,
  Dtc,
  DrivePhase,
  FreezeFrame,
  ObdLogEntry,
  VehicleDataProvider,
  VehicleIdentity,
  VehicleSignals,
} from "./types";

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const walk = (v: number, step: number, min: number, max: number) =>
  clamp(v + (Math.random() - 0.5) * step, min, max);

const SIM_IDENTITY: VehicleIdentity = {
  vin: "1C4HJXEG9JW174532",
  year: 2018,
  make: "Jeep",
  model: "Wrangler JL",
  trim: "Sahara",
  engine: "3.6L V6 Pentastar",
  transmission: "8-Speed Automatic (850RE)",
  driveType: "4WD",
  fuelType: "Gasoline",
  odometer: 68420,
  emissionsReady: true,
  protocols: ["ISO 15765-4 CAN (11-bit, 500k)", "ISO 9141-2"],
  ecu: "ECM-CM2220 / TCM",
  calibrationIds: ["68410000AA", "68410100AB"],
  cvns: ["A1B2C3D4", "E5F6A7B8"],
};

const SIM_DTCS: Dtc[] = [
  { code: "P0300", desc: "Random/Multiple Cylinder Misfire Detected", type: "current" },
  { code: "P0171", desc: "System Too Lean (Bank 1)", type: "current" },
  { code: "P0456", desc: "EVAP System Small Leak Detected", type: "pending" },
  { code: "P0128", desc: "Coolant Thermostat Below Regulating Temp", type: "permanent" },
];

const SIM_ADAPTER: AdapterInfo = {
  id: "innova-sim-01",
  name: "Innova Wireless OBD-II",
  model: "Innova 3111",
  rssi: -52,
  battery: 87,
  firmware: "v2.4.1",
  protocol: "ISO 15765-4 CAN (11/500)",
  quality: "excellent",
};

function baseSignals(): VehicleSignals {
  return {
    rpm: 0, speed: 0, coolantTemp: 24, intakeAirTemp: 26, ambientTemp: 24, oilTemp: 24,
    oilPressure: 0, batteryVoltage: 12.5, chargingVoltage: 12.5, alternatorLoad: 0,
    fuelPressure: 0, railPressure: 0, map: 101, boost: 0, maf: 0, throttle: 0,
    pedalPosition: 0, engineLoad: 0, ignitionTiming: 10, timingAdvance: 10,
    shortFuelTrim: 0, longFuelTrim: -1.5, o2Voltage: 0.45, o2Voltage2: 0.45, afr: 14.7,
    lambda: 1.0, evap: -0.2, catalystTemp: 24, catalystTemp2: 24, transTemp: 24, gear: 0,
    knockRetard: 0, baro: 101, fuelLevel: 62, distanceToEmpty: 410, estHorsepower: 0,
    estTorque: 0, intakeVacuum: 0, batteryCurrent: -8, targetVoltage: 14.4,
    generatorDuty: 0, runTime: 0, distanceMIL: 132,
  };
}

export class SimulationProvider implements VehicleDataProvider {
  readonly mode = "simulation" as const;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling = false;
  private s: VehicleSignals = baseSignals();
  private phase: DrivePhase = "startup";
  private phaseTicks = 0;
  private tick = 0;
  private dtcs = [...SIM_DTCS];
  private log: ObdLogEntry[] = [];
  private latencyMs = 32;
  private logPidIndex = 0;
  private readonly logPids = ["010C", "010D", "0105", "0111", "010B", "0110", "0142"];

  private recordExchange() {
    const cmd = this.logPids[this.logPidIndex % this.logPids.length];
    this.logPidIndex++;
    this.latencyMs = Math.round(26 + Math.random() * 22);
    const ts = Date.now();
    this.log.push({ ts, dir: "tx", cmd, data: cmd, ok: true });
    this.log.push({
      ts: ts + this.latencyMs,
      dir: "rx",
      cmd,
      data: "41" + cmd.slice(2) + Math.floor(Math.random() * 255).toString(16).padStart(2, "0").toUpperCase(),
      latencyMs: this.latencyMs,
      ok: true,
    });
    if (this.log.length > 200) this.log.splice(0, this.log.length - 200);
  }

  async scan(): Promise<AdapterInfo[]> {
    await new Promise((r) => setTimeout(r, 1400));
    return [SIM_ADAPTER];
  }

  async connect(): Promise<{ adapter: AdapterInfo; identity: VehicleIdentity }> {
    await new Promise((r) => setTimeout(r, 1600));
    this.s = baseSignals();
    this.phase = "startup";
    this.phaseTicks = 0;
    return { adapter: SIM_ADAPTER, identity: SIM_IDENTITY };
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  subscribe(cb: (signals: VehicleSignals) => void): () => void {
    this.polling = true;
    this.timer = setInterval(() => {
      this.step();
      cb({ ...this.s });
    }, 900);
    return () => {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.polling = false;
    };
  }

  async readDtcs(): Promise<Dtc[]> {
    return [...this.dtcs];
  }

  async clearDtcs(): Promise<void> {
    this.dtcs = [];
  }

  getPhase() {
    return this.phase;
  }

  getDiagnostics(): ConnectionDiagnostics {
    return {
      adapterName: SIM_ADAPTER.name,
      deviceId: "SIM:00:1A:7D:DA:71:13",
      protocol: "ISO 15765-4 CAN (11-bit, 500k)",
      voltage: Math.round(this.s.batteryVoltage * 10) / 10,
      latencyMs: this.latencyMs,
      quality: SIM_ADAPTER.quality,
      supportedPidCount: 43,
      reconnectAttempts: 0,
    };
  }

  getLog(): ObdLogEntry[] {
    return this.log;
  }

  getStatusReport(): BleStatusReport {
    return {
      mode: "simulation",
      nativeBleAvailable: false,
      permissions: "n/a",
      bluetoothPoweredOn: null,
      adapterDiscovered: true,
      adapterConnected: this.timer != null,
      elm327Initialized: this.timer != null,
      protocol: "ISO 15765-4 CAN (11-bit, 500k)",
      pollingActive: this.polling,
    };
  }

  async readFreezeFrame(code?: string): Promise<FreezeFrame> {
    const c = code || this.dtcs[0]?.code || "P0300";
    return {
      code: c,
      captured: new Date().toISOString(),
      signals: {
        rpm: Math.round(this.s.rpm),
        speed: Math.round(this.s.speed),
        coolantTemp: Math.round(this.s.coolantTemp),
        map: Math.round(this.s.map),
        maf: Math.round(this.s.maf),
        throttle: Math.round(this.s.throttle),
        engineLoad: Math.round(this.s.engineLoad),
        shortFuelTrim: Math.round(this.s.shortFuelTrim * 10) / 10,
        longFuelTrim: Math.round(this.s.longFuelTrim * 10) / 10,
      },
    };
  }

  // --- driving-cycle state machine -----------------------------------------
  private advancePhase() {
    this.phaseTicks++;
    const seq: Record<DrivePhase, { next: DrivePhase; len: number }> = {
      startup: { next: "warmup", len: 3 },
      warmup: { next: "idle", len: 8 },
      idle: { next: "accel", len: 5 },
      accel: { next: "cruise", len: 6 },
      cruise: { next: "decel", len: 10 },
      decel: { next: "idle", len: 4 },
    };
    const cur = seq[this.phase];
    if (this.phaseTicks >= cur.len) {
      this.phase = cur.next;
      this.phaseTicks = 0;
    }
  }

  private step() {
    this.tick++;
    this.advancePhase();
    this.recordExchange();
    const s = this.s;
    const warm = s.coolantTemp > 78;

    // throttle & rpm targets per phase
    let targetThrottle = 8;
    if (this.phase === "startup") targetThrottle = 15;
    else if (this.phase === "warmup") targetThrottle = 10;
    else if (this.phase === "idle") targetThrottle = 6;
    else if (this.phase === "accel") targetThrottle = 55 + Math.random() * 30;
    else if (this.phase === "cruise") targetThrottle = 22 + Math.random() * 10;
    else if (this.phase === "decel") targetThrottle = 2;

    s.throttle = clamp(s.throttle + (targetThrottle - s.throttle) * 0.5, 0, 100);
    s.pedalPosition = clamp(s.throttle + (Math.random() - 0.5) * 4, 0, 100);

    const idleRpm = warm ? 720 : 1050;
    const targetRpm = this.phase === "startup" ? 1200 : idleRpm + s.throttle * 52;
    s.rpm = clamp(s.rpm + (targetRpm - s.rpm) * 0.5 + (Math.random() - 0.5) * 60, 550, 6500);

    const targetSpeed =
      this.phase === "accel" ? 90 : this.phase === "cruise" ? 100 : this.phase === "decel" ? 15 : 0;
    s.speed = clamp(s.speed + (targetSpeed - s.speed) * 0.25, 0, 180);

    // gear from speed
    s.gear = s.speed < 1 ? 0 : Math.min(8, Math.max(1, Math.round(s.speed / 14) || 1));

    // temperatures warm up gradually
    s.coolantTemp = warm ? walk(s.coolantTemp, 1.0, 86, s.phase === "idle" ? 98 : 96) : clamp(s.coolantTemp + 2.2, 24, 92);
    s.oilTemp = clamp(s.oilTemp + (s.coolantTemp + 6 - s.oilTemp) * 0.15, 24, 118);
    s.transTemp = clamp(s.transTemp + (s.coolantTemp - 4 - s.transTemp) * 0.12, 24, 105);
    s.intakeAirTemp = walk(s.intakeAirTemp, 0.8, 22, 46);
    s.ambientTemp = walk(s.ambientTemp, 0.2, 20, 28);
    s.catalystTemp = clamp(300 + s.engineLoad * 4 + s.rpm * 0.03, 24, 720);
    s.catalystTemp2 = s.catalystTemp - 30;

    // load / airflow / pressures
    s.engineLoad = clamp(s.throttle * 0.85 + (s.rpm / 6500) * 25, 2, 99);
    s.map = clamp(28 + s.throttle * 1.6 + (Math.random() - 0.5) * 5, 20, 210);
    s.boost = clamp(s.map - s.baro, -60, 120);
    s.intakeVacuum = clamp((s.baro - s.map) * 0.2953, -8, 22); // inHg
    s.maf = clamp((s.rpm / 1000) * (s.engineLoad / 100) * 55, 1.5, 260);
    s.baro = 101;
    s.fuelPressure = walk(380 + s.engineLoad * 0.6, 6, 300, 520);
    s.railPressure = walk(s.fuelPressure * 0.1, 0.5, 30, 60);
    s.oilPressure = clamp(12 + s.rpm * 0.011, 8, 85);

    // ignition / timing / knock
    s.timingAdvance = clamp(12 + (s.rpm / 6500) * 24 - s.engineLoad * 0.08, 4, 40);
    s.ignitionTiming = s.timingAdvance;
    s.knockRetard = this.phase === "accel" && Math.random() > 0.7 ? walk(s.knockRetard, 2, 0, 6) : Math.max(0, s.knockRetard - 0.5);

    // fuel trims / O2 / AFR — lean condition (P0171) biases positive trims
    const leanBias = this.dtcs.some((d) => d.code === "P0171") ? 6 : 0;
    s.shortFuelTrim = walk(s.shortFuelTrim, 3, -8, 14) + (Math.random() > 0.5 ? 1 : -1);
    s.shortFuelTrim = clamp(s.shortFuelTrim, -15, 20);
    s.longFuelTrim = clamp(s.longFuelTrim + (leanBias - s.longFuelTrim) * 0.05, -12, 18);
    // O2 sensor switching around stoich
    s.o2Voltage = 0.1 + (Math.sin(this.tick * 1.7) * 0.5 + 0.5) * 0.8;
    s.o2Voltage2 = clamp(s.o2Voltage - 0.05 + (Math.random() - 0.5) * 0.1, 0.05, 0.9);
    s.afr = clamp(14.7 + (s.o2Voltage < 0.45 ? 0.6 : -0.4) + (leanBias * 0.05), 11.5, 16.5);
    s.lambda = s.afr / 14.7;
    s.evap = walk(s.evap, 0.3, -3.5, 1);

    // charging system
    const charging = s.rpm > 500;
    s.chargingVoltage = charging ? walk(14.2, 0.05, 13.8, 14.6) : walk(12.4, 0.04, 12.1, 12.6);
    s.batteryVoltage = charging ? s.chargingVoltage - walk(0.4, 0.03, 0.2, 0.6) : walk(12.4, 0.03, 12.0, 12.6);
    s.alternatorLoad = clamp(30 + s.engineLoad * 0.4, 8, 95);
    s.targetVoltage = 14.4;
    s.generatorDuty = clamp(40 + s.alternatorLoad * 0.5, 10, 98);
    s.batteryCurrent = charging ? walk(18, 4, -5, 45) : -8;

    // fuel level / range / estimates
    s.fuelLevel = clamp(s.fuelLevel - 0.002, 3, 100);
    s.distanceToEmpty = Math.round(s.fuelLevel * 6.6);
    s.estTorque = clamp((s.engineLoad / 100) * 355, 0, 355);
    s.estHorsepower = clamp((s.estTorque * s.rpm) / 5252, 0, 285);
    s.runTime = this.tick * 0.9;
    s.distanceMIL = 132;
  }
}
