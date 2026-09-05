// VEYTRIC — Evidence schema migration (Prompt 1, Phase 1E)
// Backward-compatible, idempotent, fail-safe migration of stored evidence.
//
// Guarantees:
//   - New writes use EVIDENCE_SCHEMA_VERSION.
//   - Existing records remain readable.
//   - Unknown/future schema versions FAIL SAFE (skipped, never guessed).
//   - Legacy data WITHOUT provable provenance is NEVER reclassified as MEASURED —
//     it is downgraded to UNAVAILABLE with the original value preserved in notes.
//   - Original timestamp + ownership (userId) are preserved.
//   - Records without an owner are dropped (no ownerless / cross-user records).
//   - Idempotent: migrating an already-current valid record is a no-op in value.
//   - Can be disabled/rolled back safely (pass { enabled:false } to pass through
//     only already-current valid records).
import {
  EVIDENCE_SCHEMA_VERSION,
  EvidenceRecord,
  Freshness,
  Quality,
  RedactionState,
  RetentionClass,
  UnavailableReason,
} from "./evidenceTypes";
import { validateEvidence } from "./evidenceValidators";
import { makeUnavailable } from "./evidenceFactory";

export interface MigrationOptions {
  enabled?: boolean; // default true; false => rollback/passthrough mode
}

export interface MigrationBatchResult {
  migrated: EvidenceRecord[];
  skipped: { raw: any; reason: string }[];
}

/** Migrate one stored record. Returns a valid current-schema record or null. */
export function migrateEvidence(raw: any, opts: MigrationOptions = {}): EvidenceRecord | null {
  const enabled = opts.enabled !== false;
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;

  const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;

  // Future/unknown versions: fail safe.
  if (version > EVIDENCE_SCHEMA_VERSION) return null;

  // Ownership is mandatory — never fabricate an owner.
  if (!raw.userId) return null;

  // Already current: validate; idempotent (return as-is when valid).
  if (version === EVIDENCE_SCHEMA_VERSION) {
    return validateEvidence(raw as EvidenceRecord).ok ? (raw as EvidenceRecord) : downgrade(raw);
  }

  // Rollback/disabled mode: do not upgrade legacy records.
  if (!enabled) return null;

  // Legacy (v0) upgrade: fill defaults WITHOUT inventing classification.
  const now = Date.now();
  const upgraded: any = {
    ...raw,
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    inputEvidenceIds: Array.isArray(raw.inputEvidenceIds) ? raw.inputEvidenceIds : [],
    researchCitationIds: Array.isArray(raw.researchCitationIds) ? raw.researchCitationIds : [],
    quality: raw.quality ?? Quality.UNKNOWN,
    freshness: raw.freshness ?? Freshness.HISTORICAL, // old data is not "live"
    retentionClass: raw.retentionClass ?? RetentionClass.DIAGNOSTIC,
    redactionState: raw.redactionState ?? RedactionState.NONE,
    createdAt: raw.createdAt ?? raw.timestamp ?? now,
    updatedAt: now,
    evidenceId: raw.evidenceId ?? `ev_mig_${(raw.timestamp ?? now).toString(36)}`,
    timestamp: raw.timestamp ?? now,
  };

  // If the legacy record carried a valid, self-consistent provenance, keep it.
  if (validateEvidence(upgraded as EvidenceRecord).ok) return upgraded as EvidenceRecord;

  // Otherwise we cannot prove what it was -> downgrade (never claim MEASURED).
  return downgrade(raw);
}

/** Downgrade an unprovable/invalid record to UNAVAILABLE, preserving value+owner+ts. */
function downgrade(raw: any): EvidenceRecord | null {
  if (!raw.userId) return null;
  return makeUnavailable({
    userId: raw.userId,
    vehicleId: raw.vehicleId ?? undefined,
    sessionId: raw.sessionId ?? undefined,
    timestamp: raw.timestamp ?? undefined,
    reason: UnavailableReason.MISSING,
    decodedName: raw.decodedName ?? undefined,
    notes: `legacy/unverified record (schemaVersion=${raw.schemaVersion ?? 0})`
      + (raw.decodedValue != null ? `; original value: ${JSON.stringify(raw.decodedValue)}${raw.decodedUnit ? " " + raw.decodedUnit : ""}` : ""),
  });
}

export function migrateBatch(records: any[], opts: MigrationOptions = {}): MigrationBatchResult {
  const migrated: EvidenceRecord[] = [];
  const skipped: { raw: any; reason: string }[] = [];
  for (const r of records) {
    const m = migrateEvidence(r, opts);
    if (m) migrated.push(m);
    else skipped.push({ raw: r, reason: r == null ? "null" : (typeof r !== "object" ? "not-object" : (!r.userId ? "no-owner" : "unknown-version/disabled")) });
  }
  return { migrated, skipped };
}
