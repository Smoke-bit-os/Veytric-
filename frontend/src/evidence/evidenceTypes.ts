// VEYTRIC — Normalized Automotive Evidence Contract (Prompt 1, Phase 1A)
// =============================================================================
// One versioned, additive contract describing the ORIGIN, FRESHNESS, QUALITY,
// AUTHORITY and LIMITATIONS of every diagnostic value.
//
// Core rule: VEYTRIC never guesses what the vehicle said.
//   - Only a real vehicle transport/provider may produce MEASURED evidence.
//   - Research is evidence, never telemetry. AI is interpretation, never measurement.
//   - Missing/unsupported/stale/malformed/unauthorized -> UNAVAILABLE (never a guess).
//
// This module is a PURE type + factory + validator layer. It does NOT modify any
// protected interface (VehicleDataProvider, AI gateway, BLE engine). Phase 1B
// adapters translate existing provider outputs INTO EvidenceRecord objects.
// A canonical JSON sample (docs/evidence_sample.json) is validated by BOTH this
// TS layer and the backend Pydantic mirror to prove cross-runtime compatibility.

/** Bump on any breaking field change; migrations key off this. */
export const EVIDENCE_SCHEMA_VERSION = 1 as const;

// --- Provenance (exact classes required by the spec; underscore enum values) --
export enum ProvenanceLabel {
  MEASURED = "MEASURED",
  CALCULATED = "CALCULATED",
  USER_PROVIDED = "USER_PROVIDED",
  OEM_SPECIFICATION = "OEM_SPECIFICATION",
  RECOMMENDED = "RECOMMENDED",
  AI_INTERPRETATION = "AI_INTERPRETATION",
  UNAVAILABLE = "UNAVAILABLE",
}

/** Human-readable label for UI/reports (spec spelling with spaces). */
export const PROVENANCE_DISPLAY: Record<ProvenanceLabel, string> = {
  [ProvenanceLabel.MEASURED]: "MEASURED",
  [ProvenanceLabel.CALCULATED]: "CALCULATED",
  [ProvenanceLabel.USER_PROVIDED]: "USER PROVIDED",
  [ProvenanceLabel.OEM_SPECIFICATION]: "OEM SPECIFICATION",
  [ProvenanceLabel.RECOMMENDED]: "RECOMMENDED",
  [ProvenanceLabel.AI_INTERPRETATION]: "AI INTERPRETATION",
  [ProvenanceLabel.UNAVAILABLE]: "UNAVAILABLE",
};

// --- Trust zones (authority) --------------------------------------------------
export enum AuthorityZone {
  /** Zone 1 — the ONLY zone that may create vehicle MEASURED evidence. */
  ZONE1_VEHICLE = "ZONE1_VEHICLE",
  /** Zone 2 — authoritative/trusted info (OEM specs, licensed data, gov VIN). */
  ZONE2_AUTHORITATIVE = "ZONE2_AUTHORITATIVE",
  /** Zone 3 — open research + AI reasoning. May cite Zone 1/2, never mutate it. */
  ZONE3_RESEARCH_AI = "ZONE3_RESEARCH_AI",
}

export enum SourceType {
  VEHICLE_OBD = "vehicle_obd",
  VEHICLE_CAN = "vehicle_can",
  MEASUREMENT_DEVICE = "measurement_device",
  DETERMINISTIC_CALCULATION = "deterministic_calculation",
  USER_INPUT = "user_input",
  OEM_SPECIFICATION = "oem_specification",
  LICENSED_SERVICE_DATA = "licensed_service_data",
  GOVERNMENT_VIN = "government_vin",
  OPEN_RESEARCH = "open_research",
  AI_MODEL = "ai_model",
  NONE = "none",
}

export enum Freshness {
  LIVE = "LIVE",
  RECENT = "RECENT",
  STALE = "STALE",
  HISTORICAL = "HISTORICAL",
  UNKNOWN = "UNKNOWN",
}

export enum Quality {
  HIGH = "high",
  MEDIUM = "medium",
  LOW = "low",
  UNKNOWN = "unknown",
}

export enum RetentionClass {
  EPHEMERAL = "ephemeral",       // live stream frame, not persisted long-term
  DIAGNOSTIC = "diagnostic",     // saved scan/report evidence
  SENSITIVE = "sensitive",       // VIN / identity-linked
  TRANSIENT_DEBUG = "transient_debug",
}

export enum RedactionState {
  NONE = "none",
  REDACTED = "redacted",         // sensitive fields already stripped
  PENDING = "pending",           // must be redacted before logging/persist
}

export type EngineState = "off" | "cranking" | "running" | "unknown";
export type IgnitionState = "off" | "accessory" | "on" | "unknown";
export type VehicleState = "parked" | "moving" | "unknown";

/** Structured reasons an evidence value is UNAVAILABLE (never a guessed value). */
export enum UnavailableReason {
  MISSING = "missing",
  UNSUPPORTED = "unsupported",
  STALE_BEYOND_POLICY = "stale_beyond_policy",
  MALFORMED = "malformed",
  PARTIAL = "partial",
  INACCESSIBLE = "inaccessible",
  UNAUTHORIZED = "unauthorized",
  DISCONNECTED = "disconnected",
  TIMEOUT = "timeout",
  PROVIDER_ERROR = "provider_error",
  NOT_YET_READ = "not_yet_read",
}

/** Limitations attached to any record (esp. UNAVAILABLE and stale CALCULATED). */
export interface EvidenceLimitations {
  reason?: UnavailableReason;
  notes?: string;
  staleSinceMs?: number;
  policyThresholdMs?: number;
  degraded?: boolean;
}

// --- The record ---------------------------------------------------------------
// Fields may be absent where they do not apply; absence must be EXPLICIT and
// safely handled. Never fill an irrelevant field with an invented value.
export interface EvidenceRecord {
  schemaVersion: number;

  evidenceId: string;
  userId: string;
  vehicleId?: string | null;
  sessionId?: string | null;

  timestamp: number;   // epoch ms — when the value was produced/measured
  receivedAt?: number; // epoch ms — when VEYTRIC received it

  sourceType: SourceType;
  authorityZone: AuthorityZone;
  provenanceLabel: ProvenanceLabel;

  providerId?: string | null;
  providerVersion?: string | null;

  transport?: string | null;   // e.g. "ble", "wifi", "usb", "http"
  protocol?: string | null;    // e.g. "ISO 15765-4 CAN (11/500)"
  ecuAddress?: string | null;
  ecuName?: string | null;

  requestMode?: string | null; // OBD mode, e.g. "01","03","06","09"
  pid?: string | null;
  did?: string | null;
  monitorId?: string | null;
  testId?: string | null;

  rawRequest?: string | null;
  rawResponse?: string | null;
  rawBytes?: string | null;    // hex string; sanitized per retention policy

  decodedName?: string | null;
  decodedValue?: number | string | boolean | null;
  decodedUnit?: string | null;

  originalValue?: number | string | boolean | null;
  originalUnit?: string | null;

  displayValue?: number | string | boolean | null;
  displayUnit?: string | null;

  engineState?: EngineState;
  ignitionState?: IgnitionState;
  vehicleState?: VehicleState;

  freshness: Freshness;
  quality: Quality;
  confidence?: number | null;  // 0..1

  limitations?: EvidenceLimitations;

  inputEvidenceIds?: string[];      // CALCULATED inputs / AI citations
  calculationId?: string | null;    // CALCULATED calculator id
  researchCitationIds?: string[];    // Zone-3 research citations

  retentionClass: RetentionClass;
  redactionState: RedactionState;

  createdAt: number;
  updatedAt: number;
}

// --- Provenance-narrowed views (discriminated by provenanceLabel) -------------
export type MeasuredRecord = EvidenceRecord & { provenanceLabel: ProvenanceLabel.MEASURED };
export type CalculatedRecord = EvidenceRecord & { provenanceLabel: ProvenanceLabel.CALCULATED };
export type UserProvidedRecord = EvidenceRecord & { provenanceLabel: ProvenanceLabel.USER_PROVIDED };
export type OemSpecRecord = EvidenceRecord & { provenanceLabel: ProvenanceLabel.OEM_SPECIFICATION };
export type RecommendedRecord = EvidenceRecord & { provenanceLabel: ProvenanceLabel.RECOMMENDED };
export type AiInterpretationRecord = EvidenceRecord & { provenanceLabel: ProvenanceLabel.AI_INTERPRETATION };
export type UnavailableRecord = EvidenceRecord & { provenanceLabel: ProvenanceLabel.UNAVAILABLE };

export function isMeasured(r: EvidenceRecord): r is MeasuredRecord {
  return r.provenanceLabel === ProvenanceLabel.MEASURED;
}
export function isCalculated(r: EvidenceRecord): r is CalculatedRecord {
  return r.provenanceLabel === ProvenanceLabel.CALCULATED;
}
export function isUnavailable(r: EvidenceRecord): r is UnavailableRecord {
  return r.provenanceLabel === ProvenanceLabel.UNAVAILABLE;
}
export function isAiInterpretation(r: EvidenceRecord): r is AiInterpretationRecord {
  return r.provenanceLabel === ProvenanceLabel.AI_INTERPRETATION;
}
