// VEYTRIC — Evidence contract VALIDATORS (Prompt 1, Phase 1A)
// Runtime enforcement of the non-negotiable provenance/authority invariants.
// These run at contract boundaries (adapters, calculators, AI/report envelopes)
// so incompatible evidence types can never be casually mixed.
import {
  AuthorityZone,
  EvidenceRecord,
  Freshness,
  ProvenanceLabel,
  SourceType,
} from "./evidenceTypes";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const VEHICLE_SOURCES = new Set<SourceType>([
  SourceType.VEHICLE_OBD,
  SourceType.VEHICLE_CAN,
  SourceType.MEASUREMENT_DEVICE,
]);

const ZONE2_SOURCES = new Set<SourceType>([
  SourceType.OEM_SPECIFICATION,
  SourceType.LICENSED_SERVICE_DATA,
  SourceType.GOVERNMENT_VIN,
]);

/**
 * Validate a single EvidenceRecord against the provenance/authority rules.
 * Returns structured errors instead of throwing so callers can decide policy.
 */
export function validateEvidence(r: EvidenceRecord): ValidationResult {
  const errors: string[] = [];
  const push = (m: string) => errors.push(m);

  if (r.schemaVersion == null) push("schemaVersion is required");
  if (!r.evidenceId) push("evidenceId is required");
  if (!r.userId) push("userId is required (ownership)");
  if (typeof r.timestamp !== "number") push("timestamp (epoch ms) is required");
  if (!r.provenanceLabel) push("provenanceLabel is required");
  if (!r.authorityZone) push("authorityZone is required");
  if (!r.sourceType) push("sourceType is required");
  if (!r.freshness) push("freshness is required");
  if (!r.quality) push("quality is required");

  switch (r.provenanceLabel) {
    case ProvenanceLabel.MEASURED: {
      // ONLY Zone 1 (a real vehicle / measurement device) can create MEASURED.
      if (r.authorityZone !== AuthorityZone.ZONE1_VEHICLE)
        push("MEASURED evidence must be in ZONE1_VEHICLE");
      if (!VEHICLE_SOURCES.has(r.sourceType))
        push("MEASURED evidence must come from a vehicle/measurement source");
      if (r.sourceType === SourceType.AI_MODEL || r.sourceType === SourceType.OPEN_RESEARCH)
        push("AI/research can NEVER produce MEASURED evidence");
      if (!r.providerId) push("MEASURED evidence requires providerId");
      if (r.decodedValue === undefined || r.decodedValue === null)
        push("MEASURED evidence must carry a decoded value (else use UNAVAILABLE)");
      if (typeof r.decodedValue === "number" && !Number.isFinite(r.decodedValue))
        push("MEASURED numeric value must be finite (no NaN/Infinity) — use UNAVAILABLE instead");
      // Measurement does not DERIVE from other evidence (one-way references).
      if (r.inputEvidenceIds && r.inputEvidenceIds.length > 0)
        push("MEASURED evidence must not depend on other evidence (inputEvidenceIds must be empty)");
      break;
    }
    case ProvenanceLabel.CALCULATED: {
      if (r.sourceType !== SourceType.DETERMINISTIC_CALCULATION)
        push("CALCULATED evidence must use the deterministic_calculation source");
      if (!r.calculationId) push("CALCULATED evidence requires a calculationId");
      if (!r.inputEvidenceIds || r.inputEvidenceIds.length === 0)
        push("CALCULATED evidence must reference inputEvidenceIds");
      break;
    }
    case ProvenanceLabel.USER_PROVIDED: {
      if (r.sourceType !== SourceType.USER_INPUT)
        push("USER_PROVIDED evidence must use the user_input source");
      break;
    }
    case ProvenanceLabel.OEM_SPECIFICATION: {
      if (r.authorityZone !== AuthorityZone.ZONE2_AUTHORITATIVE)
        push("OEM_SPECIFICATION must be in ZONE2_AUTHORITATIVE");
      if (!ZONE2_SOURCES.has(r.sourceType))
        push("OEM_SPECIFICATION must come from an authoritative/licensed/gov source");
      if (r.sourceType === SourceType.OPEN_RESEARCH)
        push("OEM_SPECIFICATION must not be created from open-web inference");
      if (!r.providerId) push("OEM_SPECIFICATION requires a source/providerId");
      break;
    }
    case ProvenanceLabel.RECOMMENDED: {
      if (r.authorityZone === AuthorityZone.ZONE1_VEHICLE)
        push("RECOMMENDED evidence cannot claim ZONE1 (vehicle) authority");
      if (!r.decodedName && !(r.limitations && r.limitations.notes))
        push("RECOMMENDED evidence must state the basis of the recommendation");
      // A recommendation must never masquerade as a measured component condition.
      if (VEHICLE_SOURCES.has(r.sourceType))
        push("RECOMMENDED evidence must not use a vehicle measurement source");
      break;
    }
    case ProvenanceLabel.AI_INTERPRETATION: {
      if (r.authorityZone !== AuthorityZone.ZONE3_RESEARCH_AI)
        push("AI_INTERPRETATION must be in ZONE3_RESEARCH_AI");
      if (r.sourceType !== SourceType.AI_MODEL)
        push("AI_INTERPRETATION must use the ai_model source");
      if (VEHICLE_SOURCES.has(r.sourceType))
        push("AI can NEVER be classified as vehicle-measured");
      break;
    }
    case ProvenanceLabel.UNAVAILABLE: {
      if (!r.limitations || !r.limitations.reason)
        push("UNAVAILABLE evidence must include a structured limitations.reason");
      if (r.decodedValue !== undefined && r.decodedValue !== null)
        push("UNAVAILABLE evidence must not carry a decoded value (no guessing)");
      break;
    }
    default:
      push(`Unknown provenanceLabel: ${(r as any).provenanceLabel}`);
  }

  // Freshness sanity: UNKNOWN freshness can never be presented as LIVE elsewhere;
  // here we only reject the impossible combo of LIVE + stale limitation.
  if (r.freshness === Freshness.LIVE && r.limitations?.staleSinceMs)
    push("A record marked LIVE cannot also carry a stale limitation");

  return { ok: errors.length === 0, errors };
}

/** Throwing variant for internal boundaries that must fail closed. */
export function assertEvidence(r: EvidenceRecord): EvidenceRecord {
  const { ok, errors } = validateEvidence(r);
  if (!ok) throw new Error("Invalid EvidenceRecord: " + errors.join("; "));
  return r;
}

/**
 * Enforce the one-way reference rule across a set: a MEASURED (Zone 1) record
 * must never list a Zone-3 (AI/research) record among its inputs.
 */
export function validateReferenceGraph(records: EvidenceRecord[]): ValidationResult {
  const byId = new Map(records.map((r) => [r.evidenceId, r]));
  const errors: string[] = [];
  for (const r of records) {
    if (r.provenanceLabel !== ProvenanceLabel.MEASURED) continue;
    for (const inId of r.inputEvidenceIds || []) {
      const dep = byId.get(inId);
      if (dep && dep.authorityZone === AuthorityZone.ZONE3_RESEARCH_AI)
        errors.push(`MEASURED ${r.evidenceId} illegally depends on Zone-3 ${inId}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
