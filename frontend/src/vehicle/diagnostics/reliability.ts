// Diagnostic reliability engine — quantifies data trustworthiness. Uses the
// normalized signals, PID catalogue ranges, and ConnectionDiagnostics/log that
// every provider already exposes. Transport-agnostic.

import { VehicleSignals, ConnectionDiagnostics, ObdLogEntry } from "../types";
import { PID_CATALOG } from "../health";

export interface PidConfidence {
  key: string;
  label: string;
  value: number;
  inRange: boolean;
  confidence: number; // 0..1
}

// Validate each live PID against its catalogue range → per-signal confidence.
export function pidConfidence(signals: VehicleSignals): PidConfidence[] {
  return PID_CATALOG.map((p) => {
    const v = Number((signals as any)[p.key] ?? 0);
    const inRange = v >= p.min - Math.abs(p.min) * 0.05 && v <= p.max * 1.05;
    // Confidence drops near/over the physical limits (likely bad reads).
    let conf = 1;
    if (!inRange) conf = 0.3;
    else if (v <= p.min) conf = 0.75;
    else if (v >= p.max) conf = 0.7;
    return { key: p.key, label: p.label, value: v, inRange, confidence: conf };
  });
}

export interface SensorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

// Cross-signal plausibility checks (relationships, not just ranges).
export function sensorValidation(s: VehicleSignals): SensorCheck[] {
  const checks: SensorCheck[] = [];
  checks.push({
    name: "MAP vs Barometric",
    ok: (s.map ?? 0) <= (s.baro ?? 101) + 130,
    detail: `MAP ${Math.round(s.map)} kPa vs baro ${Math.round(s.baro)} kPa`,
  });
  checks.push({
    name: "Charging > Battery when running",
    ok: (s.rpm ?? 0) < 500 || (s.chargingVoltage ?? 0) >= (s.batteryVoltage ?? 0) - 0.3,
    detail: `${(s.chargingVoltage ?? 0).toFixed(1)}V charge / ${(s.batteryVoltage ?? 0).toFixed(1)}V batt`,
  });
  checks.push({
    name: "Coolant plausibility",
    ok: (s.coolantTemp ?? 0) >= 0 && (s.coolantTemp ?? 0) <= 130,
    detail: `${Math.round(s.coolantTemp)}°C`,
  });
  checks.push({
    name: "RPM ↔ Speed consistency",
    ok: (s.speed ?? 0) === 0 || (s.rpm ?? 0) > 400,
    detail: `${Math.round(s.rpm)} rpm @ ${Math.round(s.speed)} km/h`,
  });
  checks.push({
    name: "Lambda ↔ AFR",
    ok: Math.abs((s.lambda ?? 1) * 14.7 - (s.afr ?? 14.7)) < 1.5,
    detail: `λ ${(s.lambda ?? 1).toFixed(2)} · AFR ${(s.afr ?? 14.7).toFixed(1)}`,
  });
  return checks;
}

export interface ReliabilityReport {
  commQuality: string;              // excellent|good|fair|poor
  commScore: number;                // 0..100
  latencyMs: number;
  supportedPidCount: number;
  unsupportedPidCount: number;
  retryRate: number;                // 0..1 from log
  avgPidConfidence: number;         // 0..1
  sensorChecksPassed: number;
  sensorChecksTotal: number;
  dataQuality: number;              // 0..100 blended
}

export function reliabilityReport(
  signals: VehicleSignals,
  diag: ConnectionDiagnostics | null,
  log: ObdLogEntry[]
): ReliabilityReport {
  const qualityScore: Record<string, number> = { excellent: 96, good: 82, fair: 64, poor: 40 };
  const commQuality = diag?.quality || "good";
  const commScore = qualityScore[commQuality] ?? 70;
  const rx = log.filter((l) => l.dir === "rx");
  const failed = rx.filter((l) => !l.ok).length;
  const retryRate = rx.length ? failed / rx.length : 0;
  const confs = pidConfidence(signals);
  const avgPidConfidence = confs.length ? confs.reduce((a, c) => a + c.confidence, 0) / confs.length : 1;
  const sensor = sensorValidation(signals);
  const passed = sensor.filter((c) => c.ok).length;
  const supported = diag?.supportedPidCount ?? PID_CATALOG.length;
  const unsupported = Math.max(0, PID_CATALOG.length - supported);
  const dataQuality = Math.round(
    commScore * 0.4 + avgPidConfidence * 100 * 0.35 + (passed / sensor.length) * 100 * 0.15 + (1 - retryRate) * 100 * 0.1
  );
  return {
    commQuality, commScore, latencyMs: diag?.latencyMs ?? 0,
    supportedPidCount: supported, unsupportedPidCount: unsupported,
    retryRate: Math.round(retryRate * 100) / 100, avgPidConfidence: Math.round(avgPidConfidence * 100) / 100,
    sensorChecksPassed: passed, sensorChecksTotal: sensor.length,
    dataQuality: Math.max(0, Math.min(100, dataQuality)),
  };
}
