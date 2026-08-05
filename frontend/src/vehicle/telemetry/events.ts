// Automatic driving-event detection over a recorded sample stream. Pure — no
// BLE/transport coupling. Produces playback bookmarks.

import { TelemetrySample } from "../recording/recorder";

export type EventType =
  | "wot" | "hard_brake" | "rapid_accel" | "high_coolant"
  | "voltage_drop" | "charging_problem" | "knock" | "misfire" | "fuel_trim";

export interface DrivingEvent {
  t: number;
  index: number;
  type: EventType;
  label: string;
  severity: "info" | "warn" | "bad";
}

const META: Record<EventType, { label: string; severity: DrivingEvent["severity"] }> = {
  wot: { label: "Wide Open Throttle", severity: "info" },
  rapid_accel: { label: "Rapid Acceleration", severity: "info" },
  hard_brake: { label: "Hard Braking", severity: "warn" },
  high_coolant: { label: "High Coolant Temp", severity: "bad" },
  voltage_drop: { label: "Battery Voltage Drop", severity: "warn" },
  charging_problem: { label: "Charging Problem", severity: "bad" },
  knock: { label: "Knock Event", severity: "bad" },
  misfire: { label: "Misfire Detected", severity: "bad" },
  fuel_trim: { label: "Fuel Trim Anomaly", severity: "warn" },
};

export function detectEvents(samples: TelemetrySample[], hasMisfireDtc = false): DrivingEvent[] {
  const out: DrivingEvent[] = [];
  const last: Partial<Record<EventType, number>> = {};
  const push = (i: number, type: EventType) => {
    const s = samples[i];
    if (last[type] != null && s.t - (last[type] as number) < 3000) return; // dedup 3s
    last[type] = s.t;
    out.push({ t: s.t, index: i, type, ...META[type] });
  };

  for (let i = 1; i < samples.length; i++) {
    const s = samples[i];
    const p = samples[i - 1];
    const dt = Math.max(0.2, (s.t - p.t) / 1000);
    const accel = ((s.speed ?? 0) - (p.speed ?? 0)) / dt; // km/h per s
    if ((s.throttle ?? 0) >= 90) push(i, "wot");
    if (accel > 12) push(i, "rapid_accel");
    if (accel < -14) push(i, "hard_brake");
    if ((s.coolantTemp ?? 0) > 104) push(i, "high_coolant");
    if ((s.batteryVoltage ?? 14) < 12.0) push(i, "voltage_drop");
    if ((s.rpm ?? 0) > 800 && (s.chargingVoltage ?? 14) < 13.4) push(i, "charging_problem");
    if ((s.knockRetard ?? 0) > 3) push(i, "knock");
    if (Math.abs(s.longFuelTrim ?? 0) > 10) push(i, "fuel_trim");
  }
  if (hasMisfireDtc && samples.length) out.unshift({ t: 0, index: 0, type: "misfire", ...META.misfire });
  return out;
}
