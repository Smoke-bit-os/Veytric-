// VEYTRIC — Normalized evidence envelope for AI + reports (Prompt 1, Phase 1F)
// One shared, READ-ONLY envelope handed to AI and report consumers. It preserves
// provenance, freshness, quality, limitations, units, source refs and explicit
// UNAVAILABLE items. Consumers CANNOT mutate source evidence (records are frozen).
//
// AI rules enforced here:
//   - AI output is AI_INTERPRETATION and is APPENDED, never overwrites source.
//   - AI must cite evidence IDs (validated to exist in the envelope).
//   - Facts / calculations / recommendations / hypotheses are separated.
//   - Insufficiency is explicit (unavailableItems).
import {
  EvidenceRecord,
  Freshness,
  ProvenanceLabel,
  PROVENANCE_DISPLAY,
  UnavailableReason,
} from "./evidenceTypes";
import { validateEvidence } from "./evidenceValidators";
import { redactRaw } from "./rawCapture";

export interface EnvelopeOwner {
  userId: string;
  vehicleId?: string | null;
  sessionId?: string | null;
}

export interface EnvelopeTask {
  requested: string;
  safetyRestrictions?: string[];
}

export interface EvidenceEnvelope {
  schemaVersion: number;
  generatedAt: number;
  owner: EnvelopeOwner;
  task: EnvelopeTask;
  records: readonly EvidenceRecord[];
  unavailableItems: { name: string; reason: UnavailableReason | undefined; notes?: string }[];
}

function stripRaw(r: EvidenceRecord, includeRaw: boolean): EvidenceRecord {
  const copy: EvidenceRecord = { ...r };
  if (!includeRaw) {
    copy.rawRequest = null; copy.rawResponse = null; copy.rawBytes = null;
  } else {
    if (copy.rawRequest) copy.rawRequest = redactRaw(copy.rawRequest);
    if (copy.rawResponse) copy.rawResponse = redactRaw(copy.rawResponse);
    if (copy.rawBytes) copy.rawBytes = redactRaw(copy.rawBytes);
  }
  return Object.freeze(copy);
}

/** Build a validated, read-only envelope. Invalid records are rejected (throws). */
export function buildEvidenceEnvelope(args: {
  owner: EnvelopeOwner;
  task: EnvelopeTask;
  records: EvidenceRecord[];
  includeRaw?: boolean;
}): EvidenceEnvelope {
  const includeRaw = args.includeRaw ?? false;
  const frozen: EvidenceRecord[] = [];
  const unavailableItems: EvidenceEnvelope["unavailableItems"] = [];
  for (const r of args.records) {
    // Ownership guard: only this user's evidence may enter the envelope.
    if (r.userId !== args.owner.userId)
      throw new Error(`Evidence ${r.evidenceId} belongs to another user`);
    const v = validateEvidence(r);
    if (!v.ok) throw new Error(`Invalid evidence ${r.evidenceId}: ${v.errors.join("; ")}`);
    if (r.provenanceLabel === ProvenanceLabel.UNAVAILABLE)
      unavailableItems.push({ name: r.decodedName || "value", reason: r.limitations?.reason, notes: r.limitations?.notes });
    frozen.push(stripRaw(r, includeRaw));
  }
  return Object.freeze({
    schemaVersion: 1,
    generatedAt: Date.now(),
    owner: args.owner,
    task: args.task,
    records: Object.freeze(frozen),
    unavailableItems,
  });
}

function by(env: EvidenceEnvelope, label: ProvenanceLabel): EvidenceRecord[] {
  return env.records.filter((r) => r.provenanceLabel === label);
}

/** Structured AI context — facts vs calculations vs specs vs recommendations vs
 *  prior hypotheses vs explicit unavailable — with a mandatory citation rule. */
export function toAIContext(env: EvidenceEnvelope) {
  const ref = (r: EvidenceRecord) => ({
    id: r.evidenceId, name: r.decodedName, value: r.displayValue ?? r.decodedValue,
    unit: r.displayUnit ?? r.decodedUnit, freshness: r.freshness, quality: r.quality,
    provenance: PROVENANCE_DISPLAY[r.provenanceLabel],
  });
  return {
    owner: env.owner,
    task: env.task.requested,
    safetyRestrictions: env.task.safetyRestrictions ?? [],
    facts_measured: by(env, ProvenanceLabel.MEASURED).map(ref),
    facts_calculated: by(env, ProvenanceLabel.CALCULATED).map(ref),
    specifications: by(env, ProvenanceLabel.OEM_SPECIFICATION).map(ref),
    recommendations: by(env, ProvenanceLabel.RECOMMENDED).map(ref),
    user_provided: by(env, ProvenanceLabel.USER_PROVIDED).map(ref),
    prior_hypotheses: by(env, ProvenanceLabel.AI_INTERPRETATION).map(ref),
    unavailable: env.unavailableItems,
    instructions:
      "Cite evidence IDs for every diagnostic claim. Distinguish facts, calculations, " +
      "recommendations and hypotheses. Do NOT present a recommendation as a measured " +
      "condition. If evidence is insufficient, say so explicitly. You cannot change any measured value.",
  };
}

/** Append an AI interpretation WITHOUT mutating source evidence. */
export function attachAiInterpretation(env: EvidenceEnvelope, ai: EvidenceRecord): EvidenceEnvelope {
  if (ai.provenanceLabel !== ProvenanceLabel.AI_INTERPRETATION)
    throw new Error("Only AI_INTERPRETATION records may be attached by AI");
  const v = validateEvidence(ai);
  if (!v.ok) throw new Error(`Invalid AI record: ${v.errors.join("; ")}`);
  const known = new Set(env.records.map((r) => r.evidenceId));
  for (const cite of ai.inputEvidenceIds || [])
    if (!known.has(cite)) throw new Error(`AI cited unknown evidence id: ${cite}`);
  // Return a NEW envelope; the original frozen records are untouched.
  return Object.freeze({ ...env, records: Object.freeze([...env.records, Object.freeze({ ...ai })]) });
}

/** Report sections that preserve provenance, freshness and UNAVAILABLE items. */
export function toReportSections(env: EvidenceEnvelope) {
  const line = (r: EvidenceRecord) => ({
    label: r.decodedName,
    value: r.displayValue ?? r.decodedValue,
    unit: r.displayUnit ?? r.decodedUnit ?? "",
    provenance: PROVENANCE_DISPLAY[r.provenanceLabel],
    freshness: r.freshness,
    // Live only when truly LIVE; everything else is marked as stale/historical.
    presentedAs: r.freshness === Freshness.LIVE ? "live" : r.freshness === Freshness.HISTORICAL ? "historical" : "not-live",
  });
  return {
    measured: by(env, ProvenanceLabel.MEASURED).map(line),
    calculated: by(env, ProvenanceLabel.CALCULATED).map(line),
    specifications: by(env, ProvenanceLabel.OEM_SPECIFICATION).map(line),
    recommendations: by(env, ProvenanceLabel.RECOMMENDED).map((r) => ({ ...line(r), note: "recommendation — not a measured condition" })),
    aiInterpretations: by(env, ProvenanceLabel.AI_INTERPRETATION).map(line),
    unavailable: env.unavailableItems, // never removed from the report
  };
}
