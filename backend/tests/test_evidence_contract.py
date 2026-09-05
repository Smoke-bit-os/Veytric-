"""VEYTRIC — Evidence contract tests (Prompt 1, Phase 1A).

Run: cd /app/backend && python -m pytest tests/test_evidence_contract.py -v

Proves:
  - The shared canonical sample (docs/evidence_sample.json) validates on the
    backend Pydantic mirror (cross-runtime schema compatibility with the TS layer).
  - Provenance/authority invariants are ENFORCED (AI cannot be MEASURED, research
    cannot be telemetry, recommendations cannot be measured condition, calculations
    keep input refs, UNAVAILABLE has a reason and no value).
  - One-way references: MEASURED cannot depend on Zone-3 evidence.
"""
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from evidence.evidence import (
    AuthorityZone,
    EvidenceRecord,
    Freshness,
    ProvenanceLabel,
    Quality,
    RedactionState,
    RetentionClass,
    SourceType,
    UnavailableReason,
    validate_reference_graph,
    EVIDENCE_SCHEMA_VERSION,
)

SAMPLE = Path("/app/docs/evidence_sample.json")


def _base(**over):
    d = dict(
        schemaVersion=EVIDENCE_SCHEMA_VERSION,
        evidenceId="ev_x", userId="user_1", timestamp=1, receivedAt=1,
        sourceType=SourceType.VEHICLE_OBD, authorityZone=AuthorityZone.ZONE1_VEHICLE,
        provenanceLabel=ProvenanceLabel.MEASURED, providerId="ble.elm327",
        decodedName="RPM", decodedValue=1000, freshness=Freshness.LIVE,
        quality=Quality.HIGH, retentionClass=RetentionClass.DIAGNOSTIC,
        redactionState=RedactionState.NONE, createdAt=1, updatedAt=1,
        inputEvidenceIds=[],
    )
    d.update(over)
    return d


# ---------------------- shared canonical sample ------------------------------
def test_shared_sample_validates_on_backend():
    data = json.loads(SAMPLE.read_text())
    assert data["schemaVersion"] == EVIDENCE_SCHEMA_VERSION
    records = [EvidenceRecord(**r) for r in data["records"]]
    labels = {r.provenanceLabel for r in records}
    # sample exercises every provenance class
    assert labels == set(ProvenanceLabel)
    assert validate_reference_graph(records) == []


# ---------------------- provenance enforcement -------------------------------
def test_ai_cannot_be_measured():
    with pytest.raises(ValidationError):
        EvidenceRecord(**_base(sourceType=SourceType.AI_MODEL))


def test_research_cannot_be_measured():
    with pytest.raises(ValidationError):
        EvidenceRecord(**_base(sourceType=SourceType.OPEN_RESEARCH))


def test_measured_requires_provider_and_zone1():
    with pytest.raises(ValidationError):
        EvidenceRecord(**_base(providerId=None))
    with pytest.raises(ValidationError):
        EvidenceRecord(**_base(authorityZone=AuthorityZone.ZONE3_RESEARCH_AI))


def test_measured_cannot_depend_on_other_evidence():
    with pytest.raises(ValidationError):
        EvidenceRecord(**_base(inputEvidenceIds=["ev_ai_1"]))


def test_calculated_requires_inputs_and_calc_id():
    with pytest.raises(ValidationError):
        EvidenceRecord(**_base(
            provenanceLabel=ProvenanceLabel.CALCULATED,
            sourceType=SourceType.DETERMINISTIC_CALCULATION,
            calculationId=None, inputEvidenceIds=["a"], providerId=None))
    with pytest.raises(ValidationError):
        EvidenceRecord(**_base(
            provenanceLabel=ProvenanceLabel.CALCULATED,
            sourceType=SourceType.DETERMINISTIC_CALCULATION,
            calculationId="c@1", inputEvidenceIds=[], providerId=None))


def test_calculated_valid_with_inputs():
    r = EvidenceRecord(**_base(
        provenanceLabel=ProvenanceLabel.CALCULATED,
        sourceType=SourceType.DETERMINISTIC_CALCULATION,
        calculationId="calc.avg@1", inputEvidenceIds=["ev_meas_1", "ev_meas_2"],
        providerId=None, authorityZone=AuthorityZone.ZONE1_VEHICLE))
    assert r.calculationId == "calc.avg@1"


def test_recommended_cannot_claim_zone1_or_vehicle_source():
    with pytest.raises(ValidationError):
        EvidenceRecord(**_base(
            provenanceLabel=ProvenanceLabel.RECOMMENDED,
            authorityZone=AuthorityZone.ZONE1_VEHICLE,
            sourceType=SourceType.OEM_SPECIFICATION, providerId=None,
            decodedName="Oil interval"))


def test_unavailable_requires_reason_and_no_value():
    with pytest.raises(ValidationError):
        EvidenceRecord(**_base(
            provenanceLabel=ProvenanceLabel.UNAVAILABLE,
            sourceType=SourceType.NONE, providerId=None, decodedValue=None,
            limitations=None))
    with pytest.raises(ValidationError):
        # has a reason but ALSO a value -> rejected (no guessing)
        EvidenceRecord(**_base(
            provenanceLabel=ProvenanceLabel.UNAVAILABLE,
            sourceType=SourceType.NONE, providerId=None, decodedValue=1234,
            limitations={"reason": UnavailableReason.MISSING}))


def test_unavailable_valid():
    r = EvidenceRecord(**_base(
        provenanceLabel=ProvenanceLabel.UNAVAILABLE, sourceType=SourceType.NONE,
        providerId=None, decodedValue=None, decodedName="VIN",
        quality=Quality.UNKNOWN, freshness=Freshness.UNKNOWN,
        limitations={"reason": UnavailableReason.TIMEOUT}))
    assert r.limitations.reason == UnavailableReason.TIMEOUT


def test_reference_graph_blocks_measured_depending_on_zone3():
    ai = EvidenceRecord(**_base(
        evidenceId="ev_ai", provenanceLabel=ProvenanceLabel.AI_INTERPRETATION,
        sourceType=SourceType.AI_MODEL, authorityZone=AuthorityZone.ZONE3_RESEARCH_AI,
        providerId=None, decodedValue="guess", decodedName="hyp"))
    # construct a MEASURED that (illegally) lists the AI id — model allows empty,
    # so we bypass by building via dict and post-hoc setting the list for the graph check
    meas = EvidenceRecord(**_base(evidenceId="ev_meas"))
    meas.inputEvidenceIds = ["ev_ai"]  # simulate a bad graph edge
    errs = validate_reference_graph([ai, meas])
    assert errs and "illegally depends" in errs[0]
