// Recording engine — captures a synchronized telemetry stream into samples,
// then computes summary stats + driving events. Framework/transport-agnostic:
// samples are fed in from whatever provider is active (Simulation or BLE).

import { VehicleSignals } from "../types";
import { detectEvents, DrivingEvent } from "../telemetry/events";

export type TelemetrySample = Partial<VehicleSignals> & {
  t: number; // ms since recording start
  lat?: number;
  lon?: number;
  ele?: number;
  heading?: number;
};

export interface RecordingSummary {
  maxSpeed: number;
  peakRpm: number;
  lowestVoltage: number;
  highestCoolant: number;
  avgSpeed: number;
}

export interface Recording {
  name: string;
  duration: number; // seconds
  distance: number; // km
  summary: RecordingSummary;
  events: DrivingEvent[];
  samples: TelemetrySample[];
}

// Uniformly downsample to at most `max` points, preserving first/last.
function downsample<T>(arr: T[], max = 1000): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * step)]);
  out[out.length - 1] = arr[arr.length - 1];
  return out;
}

export class Recorder {
  private samples: TelemetrySample[] = [];
  private startedAt = 0;
  private accumulated = 0; // ms recorded before last pause
  private lastResume = 0;
  state: "idle" | "recording" | "paused" = "idle";

  start() {
    this.samples = [];
    this.accumulated = 0;
    this.startedAt = Date.now();
    this.lastResume = Date.now();
    this.state = "recording";
  }
  pause() {
    if (this.state !== "recording") return;
    this.accumulated += Date.now() - this.lastResume;
    this.state = "paused";
  }
  resume() {
    if (this.state !== "paused") return;
    this.lastResume = Date.now();
    this.state = "recording";
  }
  elapsedMs() {
    return this.state === "recording" ? this.accumulated + (Date.now() - this.lastResume) : this.accumulated;
  }
  count() {
    return this.samples.length;
  }

  addSample(signals: VehicleSignals, geo?: { lat?: number; lon?: number; ele?: number; heading?: number }) {
    if (this.state !== "recording") return;
    this.samples.push({ t: this.elapsedMs(), ...signals, ...geo });
  }

  finalize(name: string, hasMisfireDtc = false): Recording {
    const s = this.samples;
    const duration = this.elapsedMs() / 1000;
    let distance = 0;
    for (let i = 1; i < s.length; i++) {
      const dt = (s[i].t - s[i - 1].t) / 1000 / 3600; // hours
      distance += (s[i].speed ?? 0) * dt;
    }
    const nums = (k: keyof VehicleSignals) => s.map((x) => (x[k] as number) ?? 0);
    const speeds = nums("speed");
    const summary: RecordingSummary = {
      maxSpeed: Math.round(Math.max(0, ...nums("speed"))),
      peakRpm: Math.round(Math.max(0, ...nums("rpm"))),
      lowestVoltage: s.length ? Math.min(...nums("batteryVoltage")) : 0,
      highestCoolant: Math.round(Math.max(0, ...nums("coolantTemp"))),
      avgSpeed: speeds.length ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : 0,
    };
    const events = detectEvents(s, hasMisfireDtc);
    this.state = "idle";
    return { name, duration, distance: Math.round(distance * 100) / 100, summary, events, samples: downsample(s) };
  }
}
