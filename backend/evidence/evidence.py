"""VEYTRIC — Normalized Automotive Evidence Contract (backend mirror).

Prompt 1, Phase 1A. This is the Python/Pydantic mirror of
`frontend/src/evidence/evidenceTypes.ts`. A shared canonical sample
(`docs/evidence_sample.json`) is validated by BOTH sides to prove
cross-runtime compatibility (see tests/test_evidence_contract.py).

Core rule: VEYTRIC never guesses what the vehicle said. Only Zone-1 vehicle
providers create MEASURED evidence; AI is interpretation, research is evidence,
and anything missing/unsupported/stale/malformed/unauthorized -> UNAVAILABLE.

This module is additive and imports nothing from server.py — it does not change
any existing route or model.
"""
from __future__ import annotations

from enum import Enum
from typing import List, Optional, Union

from pydantic import BaseModel, Field, model_validator

EVIDENCE_SCHEMA_VERSION = 1


class ProvenanceLabel(str, Enum):
    MEASURED = "MEASURED"
    CALCULATED = "CALCULATED"
    USER_PROVIDED = "USER_PROVIDED"
    OEM_SPECIFICATION = "OEM_SPECIFICATION"
    RECOMMENDED = "RECOMMENDED"
    AI_INTERPRETATION = "AI_INTERPRETATION"
    UNAVAILABLE = "UNAVAILABLE"


class AuthorityZone(str, Enum):
    ZONE1_VEHICLE = "ZONE1_VEHICLE"
    ZONE2_AUTHORITATIVE = "ZONE2_AUTHORITATIVE"
    ZONE3_RESEARCH_AI = "ZONE3_RESEARCH_AI"


class SourceType(str, Enum):
    VEHICLE_OBD = "vehicle_obd"
    VEHICLE_CAN = "vehicle_can"
    MEASUREMENT_DEVICE = "measurement_device"
    DETERMINISTIC_CALCULATION = "deterministic_calculation"
    USER_INPUT = "user_input"
    OEM_SPECIFICATION = "oem_specification"
    LICENSED_SERVICE_DATA = "licensed_service_data"
    GOVERNMENT_VIN = "government_vin"
    OPEN_RESEARCH = "open_research"
    AI_MODEL = "ai_model"
    NONE = "none"


class Freshness(str, Enum):
    LIVE = "LIVE"
    RECENT = "RECENT"
    STALE = "STALE"
    HISTORICAL = "HISTORICAL"
    UNKNOWN = "UNKNOWN"


class Quality(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    UNKNOWN = "unknown"


class RetentionClass(str, Enum):
    EPHEMERAL = "ephemeral"
    DIAGNOSTIC = "diagnostic"
    SENSITIVE = "sensitive"
    TRANSIENT_DEBUG = "transient_debug"


class RedactionState(str, Enum):
    NONE = "none"
    REDACTED = "redacted"
    PENDING = "pending"


class UnavailableReason(str, Enum):
    MISSING = "missing"
    UNSUPPORTED = "unsupported"
    STALE_BEYOND_POLICY = "stale_beyond_policy"
    MALFORMED = "malformed"
    PARTIAL = "partial"
    INACCESSIBLE = "inaccessible"
    UNAUTHORIZED = "unauthorized"
    DISCONNECTED = "disconnected"
    TIMEOUT = "timeout"
    PROVIDER_ERROR = "provider_error"
    NOT_YET_READ = "not_yet_read"


_VEHICLE_SOURCES = {SourceType.VEHICLE_OBD, SourceType.VEHICLE_CAN, SourceType.MEASUREMENT_DEVICE}
_ZONE2_SOURCES = {SourceType.OEM_SPECIFICATION, SourceType.LICENSED_SERVICE_DATA, SourceType.GOVERNMENT_VIN}

Scalar = Union[float, int, str, bool]


class EvidenceLimitations(BaseModel):
    reason: Optional[UnavailableReason] = None
    notes: Optional[str] = None
    staleSinceMs: Optional[int] = None
    policyThresholdMs: Optional[int] = None
    degraded: Optional[bool] = None


class EvidenceRecord(BaseModel):
    schemaVersion: int
    evidenceId: str
    userId: str
    vehicleId: Optional[str] = None
    sessionId: Optional[str] = None

    timestamp: int
    receivedAt: Optional[int] = None

    sourceType: SourceType
    authorityZone: AuthorityZone
    provenanceLabel: ProvenanceLabel

    providerId: Optional[str] = None
    providerVersion: Optional[str] = None

    transport: Optional[str] = None
    protocol: Optional[str] = None
    ecuAddress: Optional[str] = None
    ecuName: Optional[str] = None

    requestMode: Optional[str] = None
    pid: Optional[str] = None
    did: Optional[str] = None
    monitorId: Optional[str] = None
    testId: Optional[str] = None

    rawRequest: Optional[str] = None
    rawResponse: Optional[str] = None
    rawBytes: Optional[str] = None

    decodedName: Optional[str] = None
    decodedValue: Optional[Scalar] = None
    decodedUnit: Optional[str] = None

    originalValue: Optional[Scalar] = None
    originalUnit: Optional[str] = None

    displayValue: Optional[Scalar] = None
    displayUnit: Optional[str] = None

    engineState: Optional[str] = None
    ignitionState: Optional[str] = None
    vehicleState: Optional[str] = None

    freshness: Freshness
    quality: Quality
    confidence: Optional[float] = None

    limitations: Optional[EvidenceLimitations] = None

    inputEvidenceIds: List[str] = Field(default_factory=list)
    calculationId: Optional[str] = None
    researchCitationIds: List[str] = Field(default_factory=list)

    retentionClass: RetentionClass
    redactionState: RedactionState

    createdAt: int
    updatedAt: int

    @model_validator(mode="after")
    def _enforce_provenance(self) -> "EvidenceRecord":
        errs: List[str] = []
        p = self.provenanceLabel
        if p == ProvenanceLabel.MEASURED:
            if self.authorityZone != AuthorityZone.ZONE1_VEHICLE:
                errs.append("MEASURED must be ZONE1_VEHICLE")
            if self.sourceType not in _VEHICLE_SOURCES:
                errs.append("MEASURED must use a vehicle/measurement source")
            if self.sourceType in (SourceType.AI_MODEL, SourceType.OPEN_RESEARCH):
                errs.append("AI/research can never be MEASURED")
            if not self.providerId:
                errs.append("MEASURED requires providerId")
            if self.decodedValue is None:
                errs.append("MEASURED must carry a decoded value")
            if self.inputEvidenceIds:
                errs.append("MEASURED must not depend on other evidence")
        elif p == ProvenanceLabel.CALCULATED:
            if self.sourceType != SourceType.DETERMINISTIC_CALCULATION:
                errs.append("CALCULATED must use deterministic_calculation")
            if not self.calculationId:
                errs.append("CALCULATED requires calculationId")
            if not self.inputEvidenceIds:
                errs.append("CALCULATED must reference inputEvidenceIds")
        elif p == ProvenanceLabel.USER_PROVIDED:
            if self.sourceType != SourceType.USER_INPUT:
                errs.append("USER_PROVIDED must use user_input")
        elif p == ProvenanceLabel.OEM_SPECIFICATION:
            if self.authorityZone != AuthorityZone.ZONE2_AUTHORITATIVE:
                errs.append("OEM_SPECIFICATION must be ZONE2_AUTHORITATIVE")
            if self.sourceType not in _ZONE2_SOURCES:
                errs.append("OEM_SPECIFICATION must use an authoritative source")
            if not self.providerId:
                errs.append("OEM_SPECIFICATION requires a source/providerId")
        elif p == ProvenanceLabel.RECOMMENDED:
            if self.authorityZone == AuthorityZone.ZONE1_VEHICLE:
                errs.append("RECOMMENDED cannot claim ZONE1 authority")
            if self.sourceType in _VEHICLE_SOURCES:
                errs.append("RECOMMENDED must not use a vehicle source")
            if not self.decodedName and not (self.limitations and self.limitations.notes):
                errs.append("RECOMMENDED must state its basis")
        elif p == ProvenanceLabel.AI_INTERPRETATION:
            if self.authorityZone != AuthorityZone.ZONE3_RESEARCH_AI:
                errs.append("AI_INTERPRETATION must be ZONE3_RESEARCH_AI")
            if self.sourceType != SourceType.AI_MODEL:
                errs.append("AI_INTERPRETATION must use ai_model")
        elif p == ProvenanceLabel.UNAVAILABLE:
            if not self.limitations or not self.limitations.reason:
                errs.append("UNAVAILABLE requires limitations.reason")
            if self.decodedValue is not None:
                errs.append("UNAVAILABLE must not carry a decoded value")
        if errs:
            raise ValueError("Invalid EvidenceRecord: " + "; ".join(errs))
        return self


def validate_reference_graph(records: List[EvidenceRecord]) -> List[str]:
    """A MEASURED (Zone 1) record must never depend on a Zone-3 (AI/research) record."""
    by_id = {r.evidenceId: r for r in records}
    errors: List[str] = []
    for r in records:
        if r.provenanceLabel != ProvenanceLabel.MEASURED:
            continue
        for in_id in r.inputEvidenceIds:
            dep = by_id.get(in_id)
            if dep and dep.authorityZone == AuthorityZone.ZONE3_RESEARCH_AI:
                errors.append(f"MEASURED {r.evidenceId} illegally depends on Zone-3 {in_id}")
    return errors
