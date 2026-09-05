# VEYTRIC — Evidence Contract

_Prompt 1, Phase 1A._ Versioned, additive contract for the origin, freshness,
quality, authority and limitations of every diagnostic value.

- TS: `frontend/src/evidence/` (`evidenceTypes.ts`, `evidenceValidators.ts`,
  `evidenceFactory.ts`, `index.ts`).
- Python mirror: `backend/evidence/evidence.py`.
- Shared canonical sample (validated by both runtimes):
  `docs/evidence_sample.json`.
- Tests: `frontend/src/__tests__/evidenceContract.test.mjs`,
  `backend/tests/test_evidence_contract.py`.

## Core rule
**VEYTRIC never guesses what the vehicle said.** Only a real vehicle
provider/measurement device (Zone 1) creates MEASURED evidence. Research is
evidence, AI is interpretation. Missing/unsupported/stale/malformed/unauthorized
→ **UNAVAILABLE** with a structured reason — never a believable default.

## Schema version
`EVIDENCE_SCHEMA_VERSION = 1`. Every record carries `schemaVersion`. Migrations
key off this (Phase 1E). Unknown versions fail safely.

## EvidenceRecord fields
See `evidenceTypes.ts :: EvidenceRecord` (identical field set in the Python
mirror): identity (`evidenceId,userId,vehicleId,sessionId`), timing
(`timestamp,receivedAt`), classification (`sourceType,authorityZone,
provenanceLabel`), provider (`providerId,providerVersion`), transport
(`transport,protocol,ecuAddress,ecuName`), request (`requestMode,pid,did,
monitorId,testId`), raw (`rawRequest,rawResponse,rawBytes`), decoded
(`decodedName,decodedValue,decodedUnit`), original (`originalValue,originalUnit`),
display (`displayValue,displayUnit`), vehicle state (`engineState,ignitionState,
vehicleState`), trust (`freshness,quality,confidence,limitations`), links
(`inputEvidenceIds,calculationId,researchCitationIds`), governance
(`retentionClass,redactionState`), audit (`createdAt,updatedAt`).

Optional fields must be **explicitly absent** and safely handled — never filled
with an invented value.

## Provenance labels (enforced)
`MEASURED · CALCULATED · USER_PROVIDED · OEM_SPECIFICATION · RECOMMENDED ·
AI_INTERPRETATION · UNAVAILABLE` (UI display uses the spaced spelling via
`PROVENANCE_DISPLAY`). Enforcement matrix (`validateEvidence` / Pydantic
`_enforce_provenance`):

| Label | Zone | Allowed source(s) | Extra rules |
|---|---|---|---|
| MEASURED | ZONE1 | vehicle_obd / vehicle_can / measurement_device | requires `providerId` + decoded value; `inputEvidenceIds` must be empty; AI/research can NEVER create it |
| CALCULATED | ZONE1 (derived) | deterministic_calculation | requires `calculationId` + ≥1 `inputEvidenceIds`; inherits stale limitation |
| USER_PROVIDED | ZONE2 | user_input | never auto-promoted to MEASURED/OEM |
| OEM_SPECIFICATION | ZONE2 | oem_specification / licensed_service_data / government_vin | requires source `providerId`; not from open-web inference |
| RECOMMENDED | ZONE2/ZONE3 | non-vehicle | must state its basis; must not use a vehicle source or claim ZONE1 |
| AI_INTERPRETATION | ZONE3 | ai_model | cites evidence; cannot overwrite source; distinguishable from vehicle facts |
| UNAVAILABLE | any | none | requires `limitations.reason`; must carry NO decoded value |

## One-way references
`validateReferenceGraph` / `validate_reference_graph`: a MEASURED (Zone 1) record
must never depend on a Zone-3 (AI/research) record. Interpretations may cite
measured evidence; measured evidence never depends on an interpretation.

## Freshness (thresholds finalized in Phase 1C)
`LIVE · RECENT · STALE · HISTORICAL · UNKNOWN`. A record marked LIVE cannot carry
a stale limitation. UNKNOWN freshness must never be presented as LIVE.

## Redaction & retention (enforced in Phase 1D)
`retentionClass ∈ {ephemeral,diagnostic,sensitive,transient_debug}`,
`redactionState ∈ {none,redacted,pending}`. VIN/user identifiers must be redacted
before logging/persist; secrets/tokens/payment data are never logged.

## Factories (safe constructors, `evidenceFactory.ts`)
`makeMeasured · makeCalculated · makeUserProvided · makeOemSpecification ·
makeRecommended · makeAiInterpretation · makeUnavailable`. Each stamps the schema
version + defaults and validates before returning, so an incompatible
provenance/zone/source combination can never be constructed.
