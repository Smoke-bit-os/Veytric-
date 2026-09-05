// VEYTRIC — Evidence factory (Prompt 1, Phase 1A)
// Safe constructors that stamp the schema version, defaults, and — critically —
// prevent an incompatible provenance/zone/source combination from ever being
// built. Every constructor validates before returning.
import {
  AuthorityZone,
  EVIDENCE_SCHEMA_VERSION,
  EvidenceLimitations,
  EvidenceRecord,
  Freshness,
  ProvenanceLabel,
  Quality,
  RedactionState,
  RetentionClass,
  SourceType,
  UnavailableReason,
} from "./evidenceTypes";
import { assertEvidence } from "./evidenceValidators";

let _seq = 0;
function newId(prefix: string): string {
  _seq = (_seq + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}_${_seq.toString(36)}`;
}

interface BaseArgs {
  userId: string;
  vehicleId?: string | null;
  sessionId?: string | null;
  timestamp?: number;
  quality?: Quality;
  freshness?: Freshness;
  retentionClass?: RetentionClass;
  redactionState?: RedactionState;
}

function base(args: BaseArgs, prefix: string): EvidenceRecord {
  const now = Date.now();
  const ts = args.timestamp ?? now;
  return {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    evidenceId: newId(prefix),
    userId: args.userId,
    vehicleId: args.vehicleId ?? null,
    sessionId: args.sessionId ?? null,
    timestamp: ts,
    receivedAt: now,
    // placeholders overwritten by each constructor:
    sourceType: SourceType.NONE,
    authorityZone: AuthorityZone.ZONE3_RESEARCH_AI,
    provenanceLabel: ProvenanceLabel.UNAVAILABLE,
    freshness: args.freshness ?? Freshness.UNKNOWN,
    quality: args.quality ?? Quality.UNKNOWN,
    retentionClass: args.retentionClass ?? RetentionClass.DIAGNOSTIC,
    redactionState: args.redactionState ?? RedactionState.NONE,
    createdAt: now,
    updatedAt: now,
  };
}

export function makeMeasured(args: BaseArgs & {
  providerId: string;
  providerVersion?: string;
  sourceType?: SourceType;         // defaults to vehicle_obd
  decodedName: string;
  decodedValue: number | string | boolean;
  decodedUnit?: string;
  originalValue?: number | string | boolean;
  originalUnit?: string;
  requestMode?: string; pid?: string; ecuAddress?: string; ecuName?: string;
  protocol?: string; transport?: string;
  rawRequest?: string; rawResponse?: string; rawBytes?: string;
}): EvidenceRecord {
  const r = base(args, "ev_meas");
  return assertEvidence({
    ...r,
    provenanceLabel: ProvenanceLabel.MEASURED,
    authorityZone: AuthorityZone.ZONE1_VEHICLE,
    sourceType: args.sourceType ?? SourceType.VEHICLE_OBD,
    providerId: args.providerId,
    providerVersion: args.providerVersion ?? null,
    decodedName: args.decodedName,
    decodedValue: args.decodedValue,
    decodedUnit: args.decodedUnit ?? null,
    originalValue: args.originalValue ?? args.decodedValue,
    originalUnit: args.originalUnit ?? args.decodedUnit ?? null,
    displayValue: args.decodedValue,
    displayUnit: args.decodedUnit ?? null,
    requestMode: args.requestMode ?? null,
    pid: args.pid ?? null,
    ecuAddress: args.ecuAddress ?? null,
    ecuName: args.ecuName ?? null,
    protocol: args.protocol ?? null,
    transport: args.transport ?? null,
    rawRequest: args.rawRequest ?? null,
    rawResponse: args.rawResponse ?? null,
    rawBytes: args.rawBytes ?? null,
    freshness: args.freshness ?? Freshness.LIVE,
    quality: args.quality ?? Quality.HIGH,
    inputEvidenceIds: [],
  });
}

export function makeCalculated(args: BaseArgs & {
  calculationId: string;
  inputEvidenceIds: string[];
  decodedName: string;
  decodedValue: number | string;
  decodedUnit?: string;
  limitations?: EvidenceLimitations;
}): EvidenceRecord {
  const r = base(args, "ev_calc");
  return assertEvidence({
    ...r,
    provenanceLabel: ProvenanceLabel.CALCULATED,
    authorityZone: AuthorityZone.ZONE1_VEHICLE, // derived from Zone-1 measurements
    sourceType: SourceType.DETERMINISTIC_CALCULATION,
    calculationId: args.calculationId,
    inputEvidenceIds: args.inputEvidenceIds,
    decodedName: args.decodedName,
    decodedValue: args.decodedValue,
    decodedUnit: args.decodedUnit ?? null,
    displayValue: args.decodedValue,
    displayUnit: args.decodedUnit ?? null,
    limitations: args.limitations,
    quality: args.quality ?? Quality.HIGH,
    freshness: args.freshness ?? Freshness.RECENT,
  });
}

export function makeUserProvided(args: BaseArgs & {
  decodedName: string; decodedValue: number | string | boolean; decodedUnit?: string;
}): EvidenceRecord {
  const r = base(args, "ev_user");
  return assertEvidence({
    ...r,
    provenanceLabel: ProvenanceLabel.USER_PROVIDED,
    authorityZone: AuthorityZone.ZONE2_AUTHORITATIVE,
    sourceType: SourceType.USER_INPUT,
    decodedName: args.decodedName,
    decodedValue: args.decodedValue,
    decodedUnit: args.decodedUnit ?? null,
    displayValue: args.decodedValue,
    displayUnit: args.decodedUnit ?? null,
    quality: args.quality ?? Quality.MEDIUM,
    freshness: args.freshness ?? Freshness.HISTORICAL,
  });
}

export function makeOemSpecification(args: BaseArgs & {
  providerId: string; sourceType?: SourceType; decodedName: string;
  decodedValue: number | string; decodedUnit?: string; notes?: string;
}): EvidenceRecord {
  const r = base(args, "ev_oem");
  return assertEvidence({
    ...r,
    provenanceLabel: ProvenanceLabel.OEM_SPECIFICATION,
    authorityZone: AuthorityZone.ZONE2_AUTHORITATIVE,
    sourceType: args.sourceType ?? SourceType.OEM_SPECIFICATION,
    providerId: args.providerId,
    decodedName: args.decodedName,
    decodedValue: args.decodedValue,
    decodedUnit: args.decodedUnit ?? null,
    displayValue: args.decodedValue,
    displayUnit: args.decodedUnit ?? null,
    limitations: args.notes ? { notes: args.notes } : undefined,
    quality: args.quality ?? Quality.HIGH,
    freshness: args.freshness ?? Freshness.HISTORICAL,
  });
}

export function makeRecommended(args: BaseArgs & {
  decodedName: string; decodedValue: number | string; decodedUnit?: string;
  basis: string; researchCitationIds?: string[];
}): EvidenceRecord {
  const r = base(args, "ev_rec");
  return assertEvidence({
    ...r,
    provenanceLabel: ProvenanceLabel.RECOMMENDED,
    authorityZone: AuthorityZone.ZONE2_AUTHORITATIVE,
    sourceType: SourceType.OEM_SPECIFICATION,
    decodedName: args.decodedName,
    decodedValue: args.decodedValue,
    decodedUnit: args.decodedUnit ?? null,
    displayValue: args.decodedValue,
    displayUnit: args.decodedUnit ?? null,
    limitations: { notes: args.basis },
    researchCitationIds: args.researchCitationIds ?? [],
    quality: args.quality ?? Quality.MEDIUM,
    freshness: args.freshness ?? Freshness.HISTORICAL,
  });
}

export function makeAiInterpretation(args: BaseArgs & {
  providerId?: string; providerVersion?: string;
  decodedName: string; decodedValue: string;
  inputEvidenceIds?: string[]; confidence?: number;
}): EvidenceRecord {
  const r = base(args, "ev_ai");
  return assertEvidence({
    ...r,
    provenanceLabel: ProvenanceLabel.AI_INTERPRETATION,
    authorityZone: AuthorityZone.ZONE3_RESEARCH_AI,
    sourceType: SourceType.AI_MODEL,
    providerId: args.providerId ?? null,
    providerVersion: args.providerVersion ?? null,
    decodedName: args.decodedName,
    decodedValue: args.decodedValue,
    displayValue: args.decodedValue,
    inputEvidenceIds: args.inputEvidenceIds ?? [],
    confidence: args.confidence ?? null,
    quality: args.quality ?? Quality.LOW,
    freshness: args.freshness ?? Freshness.UNKNOWN,
  });
}

export function makeUnavailable(args: BaseArgs & {
  reason: UnavailableReason; decodedName?: string; notes?: string;
  requestMode?: string; pid?: string; providerId?: string;
}): EvidenceRecord {
  const r = base(args, "ev_na");
  return assertEvidence({
    ...r,
    provenanceLabel: ProvenanceLabel.UNAVAILABLE,
    authorityZone: AuthorityZone.ZONE1_VEHICLE,
    sourceType: SourceType.NONE,
    providerId: args.providerId ?? null,
    decodedName: args.decodedName ?? null,
    requestMode: args.requestMode ?? null,
    pid: args.pid ?? null,
    limitations: { reason: args.reason, notes: args.notes },
    quality: Quality.UNKNOWN,
    freshness: args.freshness ?? Freshness.UNKNOWN,
  });
}
