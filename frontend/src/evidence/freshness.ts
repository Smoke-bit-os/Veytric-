// VEYTRIC — Freshness & session boundary policy (Prompt 1, Phase 1C)
// Freshness is decided PER DATA CLASS, never one arbitrary threshold for
// everything. UNKNOWN freshness must never be presented as LIVE.
import { Freshness } from "./evidenceTypes";

/** Data classes with distinct freshness expectations. */
export enum DataClass {
  LIVE_PID = "live_pid",       // fast-changing telemetry
  VOLTAGE = "voltage",          // slow analog
  DTC = "dtc",                  // event-ish, valid for a while
  READINESS = "readiness",      // session-scoped
  VIN = "vin",                  // effectively static once read this session
  SPEC = "spec",                // OEM/authoritative reference
}

interface Thresholds { liveMs: number; recentMs: number; staleMs: number; }

// Beyond staleMs => HISTORICAL. Absent/negative age => UNKNOWN.
const POLICY: Record<DataClass, Thresholds> = {
  [DataClass.LIVE_PID]: { liveMs: 2_000, recentMs: 15_000, staleMs: 120_000 },
  [DataClass.VOLTAGE]: { liveMs: 5_000, recentMs: 60_000, staleMs: 600_000 },
  [DataClass.DTC]: { liveMs: 30_000, recentMs: 300_000, staleMs: 86_400_000 },
  [DataClass.READINESS]: { liveMs: 30_000, recentMs: 300_000, staleMs: 3_600_000 },
  [DataClass.VIN]: { liveMs: 60_000, recentMs: 3_600_000, staleMs: 31_536_000_000 },
  [DataClass.SPEC]: { liveMs: 0, recentMs: 0, staleMs: Number.MAX_SAFE_INTEGER },
};

/** Least-fresh ordering (higher index = less fresh). */
const ORDER: Freshness[] = [Freshness.LIVE, Freshness.RECENT, Freshness.STALE, Freshness.HISTORICAL, Freshness.UNKNOWN];

export function freshnessRank(f: Freshness): number {
  return ORDER.indexOf(f);
}

/** The least-fresh of a set (used when a calculation combines inputs). */
export function leastFresh(states: Freshness[]): Freshness {
  if (states.length === 0) return Freshness.UNKNOWN;
  return states.reduce((worst, f) => (freshnessRank(f) > freshnessRank(worst) ? f : worst), Freshness.LIVE);
}

/**
 * Compute freshness for a value of a given data class.
 * @param ageMs  now - timestamp. Pass null/undefined/NaN/negative for UNKNOWN.
 */
export function computeFreshness(ageMs: number | null | undefined, cls: DataClass): Freshness {
  if (ageMs == null || Number.isNaN(ageMs) || ageMs < 0) return Freshness.UNKNOWN;
  const t = POLICY[cls];
  if (cls === DataClass.SPEC) return Freshness.HISTORICAL; // specs are never "live"
  if (ageMs <= t.liveMs) return Freshness.LIVE;
  if (ageMs <= t.recentMs) return Freshness.RECENT;
  if (ageMs <= t.staleMs) return Freshness.STALE;
  return Freshness.HISTORICAL;
}

/** True if the reading may be shown as a LIVE value on a live screen. */
export function isPresentableAsLive(f: Freshness): boolean {
  return f === Freshness.LIVE; // RECENT/STALE/HISTORICAL/UNKNOWN are NOT live
}

// --- Session boundaries ------------------------------------------------------
let _sessionSeq = 0;
/** Start a new vehicle-data session (call on connect / validated reconnect). */
export function beginSession(prefix = "sess"): string {
  _sessionSeq = (_sessionSeq + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${_sessionSeq.toString(36)}`;
}

/** A reading belongs to the active session only if its sessionId matches. */
export function isInSession(recordSessionId: string | null | undefined, activeSessionId: string | null | undefined): boolean {
  return !!recordSessionId && !!activeSessionId && recordSessionId === activeSessionId;
}
