// VEYTRIC — Deterministic calculation layer (Prompt 1, Phase 1C)
// Versioned, pure calculators. Each:
//   - is labeled CALCULATED and references its input evidence IDs + calculator id,
//   - preserves the source timestamp (earliest input),
//   - rejects missing/incompatible units, stale/invalid inputs (per policy),
//     division-by-zero, NaN and Infinity -> returns UNAVAILABLE (never a guess),
//   - inherits a stale limitation when inputs are stale/historical/unknown,
//   - uses documented rounding and is deterministic for identical inputs.
//
// AI must NEVER perform these; they live in code.
import {
  EvidenceRecord,
  Freshness,
  UnavailableReason,
} from "./evidenceTypes";
import { makeCalculated, makeUnavailable } from "./evidenceFactory";
import { leastFresh } from "./freshness";

const ROUND_DP = 4; // documented default rounding
function round(n: number, dp = ROUND_DP): number {
  const f = Math.pow(10, dp);
  return Math.round((n + Number.EPSILON) * f) / f;
}

function num(r: EvidenceRecord): number | null {
  const v = r.decodedValue;
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

interface CalcMeta {
  userId: string;
  vehicleId?: string | null;
  sessionId?: string | null;
}

function meta(inputs: EvidenceRecord[], over?: CalcMeta): CalcMeta {
  const first = inputs[0];
  return {
    userId: over?.userId ?? first?.userId ?? "unknown",
    vehicleId: over?.vehicleId ?? first?.vehicleId ?? null,
    sessionId: over?.sessionId ?? first?.sessionId ?? null,
  };
}

function earliestTs(inputs: EvidenceRecord[]): number {
  return Math.min(...inputs.map((r) => r.timestamp));
}

function inheritedFreshness(inputs: EvidenceRecord[]): { freshness: Freshness; stale: boolean } {
  const f = leastFresh(inputs.map((r) => r.freshness));
  const stale = f === Freshness.STALE || f === Freshness.HISTORICAL || f === Freshness.UNKNOWN;
  return { freshness: stale ? (f === Freshness.UNKNOWN ? Freshness.UNKNOWN : Freshness.STALE) : Freshness.RECENT, stale };
}

function unavailable(m: CalcMeta, name: string, reason: UnavailableReason, notes: string): EvidenceRecord {
  return makeUnavailable({ ...m, reason, notes, decodedName: name });
}

/** Shared builder: validates inputs, builds a CALCULATED record. */
function build(
  calculationId: string,
  name: string,
  unit: string | undefined,
  inputs: EvidenceRecord[],
  compute: (vals: number[]) => number,
  over?: CalcMeta,
): EvidenceRecord {
  const m = meta(inputs, over);
  if (inputs.length === 0) return unavailable(m, name, UnavailableReason.MISSING, "no inputs");
  const vals: number[] = [];
  for (const r of inputs) {
    const v = num(r);
    if (v == null) return unavailable(m, name, UnavailableReason.MALFORMED, "non-numeric / NaN / Infinite input");
    vals.push(v);
  }
  // unit compatibility: all decoded inputs must share the same unit (if declared)
  const units = new Set(inputs.map((r) => r.decodedUnit ?? "").filter((u) => u !== ""));
  if (units.size > 1)
    return unavailable(m, name, UnavailableReason.MALFORMED, `incompatible units: ${[...units].join(",")}`);

  let out: number;
  try {
    out = compute(vals);
  } catch (e) {
    return unavailable(m, name, UnavailableReason.MALFORMED, (e as Error).message);
  }
  if (!Number.isFinite(out))
    return unavailable(m, name, UnavailableReason.MALFORMED, "result is NaN/Infinite (e.g. division by zero)");

  const { freshness, stale } = inheritedFreshness(inputs);
  return makeCalculated({
    ...m,
    timestamp: earliestTs(inputs),
    calculationId,
    inputEvidenceIds: inputs.map((r) => r.evidenceId),
    decodedName: name,
    decodedValue: round(out),
    decodedUnit: unit,
    freshness,
    limitations: stale ? { degraded: true, notes: "derived from stale/historical/unknown inputs" } : undefined,
  });
}

// --- unit conversions (single input) ----------------------------------------
export function celsiusToFahrenheit(input: EvidenceRecord, over?: CalcMeta): EvidenceRecord {
  return build("calc.c_to_f@1", `${input.decodedName ?? "Temp"} (°F)`, "°F", [input], ([c]) => c * 9 / 5 + 32, over);
}
export function kpaToPsi(input: EvidenceRecord, over?: CalcMeta): EvidenceRecord {
  return build("calc.kpa_to_psi@1", `${input.decodedName ?? "Pressure"} (psi)`, "psi", [input], ([k]) => k * 0.1450377, over);
}

// --- fuel trim total (STFT + LTFT) ------------------------------------------
export function totalFuelTrim(stft: EvidenceRecord, ltft: EvidenceRecord, over?: CalcMeta): EvidenceRecord {
  return build("calc.total_fuel_trim@1", "Total Fuel Trim", "%", [stft, ltft], ([s, l]) => s + l, over);
}

// --- deltas / stats (multi input) -------------------------------------------
export function delta(from: EvidenceRecord, to: EvidenceRecord, over?: CalcMeta): EvidenceRecord {
  return build("calc.delta@1", "Delta", to.decodedUnit ?? undefined, [from, to], ([a, b]) => b - a, over);
}
export function minimum(inputs: EvidenceRecord[], over?: CalcMeta): EvidenceRecord {
  return build("calc.min@1", "Minimum", inputs[0]?.decodedUnit ?? undefined, inputs, (v) => Math.min(...v), over);
}
export function maximum(inputs: EvidenceRecord[], over?: CalcMeta): EvidenceRecord {
  return build("calc.max@1", "Maximum", inputs[0]?.decodedUnit ?? undefined, inputs, (v) => Math.max(...v), over);
}
export function average(inputs: EvidenceRecord[], over?: CalcMeta): EvidenceRecord {
  return build("calc.avg@1", "Average", inputs[0]?.decodedUnit ?? undefined, inputs, (v) => v.reduce((a, b) => a + b, 0) / v.length, over);
}

/** Rate of change per second between two timestamped samples. */
export function rateOfChange(from: EvidenceRecord, to: EvidenceRecord, over?: CalcMeta): EvidenceRecord {
  const dtSec = (to.timestamp - from.timestamp) / 1000;
  const unit = (from.decodedUnit ?? "") + "/s";
  return build("calc.rate_of_change@1", "Rate of change", unit || undefined, [from, to], ([a, b]) => {
    if (dtSec === 0) throw new Error("division by zero (identical timestamps)");
    return (b - a) / dtSec;
  }, over);
}

/** Compare a measured value to a limit; returns 1 (over), 0 (at), -1 (under). */
export function limitComparison(value: EvidenceRecord, limit: number, over?: CalcMeta): EvidenceRecord {
  return build("calc.limit_compare@1", `${value.decodedName ?? "Value"} vs limit`, undefined, [value],
    ([v]) => (v > limit ? 1 : v < limit ? -1 : 0), over);
}

export function beforeAfter(before: EvidenceRecord, after: EvidenceRecord, over?: CalcMeta): EvidenceRecord {
  return build("calc.before_after@1", "Before/after change", after.decodedUnit ?? undefined, [before, after],
    ([a, b]) => b - a, over);
}

/** Simple session summary: average of a series (labeled, references all inputs). */
export function sessionSummaryAverage(inputs: EvidenceRecord[], name: string, over?: CalcMeta): EvidenceRecord {
  return build("calc.session_summary@1", `${name} (session avg)`, inputs[0]?.decodedUnit ?? undefined, inputs,
    (v) => v.reduce((a, b) => a + b, 0) / v.length, over);
}

/** Data-quality summary: fraction of inputs that are LIVE/RECENT (0..1). */
export function dataQualitySummary(inputs: EvidenceRecord[], over?: CalcMeta): EvidenceRecord {
  const m = meta(inputs, over);
  if (inputs.length === 0) return unavailable(m, "Data quality", UnavailableReason.MISSING, "no inputs");
  const good = inputs.filter((r) => r.freshness === Freshness.LIVE || r.freshness === Freshness.RECENT).length;
  return makeCalculated({
    ...m,
    timestamp: earliestTs(inputs),
    calculationId: "calc.data_quality@1",
    inputEvidenceIds: inputs.map((r) => r.evidenceId),
    decodedName: "Data quality (fresh fraction)",
    decodedValue: round(good / inputs.length),
    decodedUnit: "ratio",
    freshness: Freshness.RECENT,
  });
}
