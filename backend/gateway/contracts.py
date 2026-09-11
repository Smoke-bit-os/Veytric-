"""VEYTRIC — Prompt 3 Central AI Gateway & Research Gateway contracts (Phase 3A).

Versioned, typed request/response contracts + the structured failure model.
This module is PURE (no DB, no provider calls, no FastAPI). It is the single
source of truth for the shape of every gateway request/response and is imported
by the gateway service (3B+), the metering ledger (3C), and the tests.

Protected-contract notes (do NOT weaken):
  - AI/research output is NEVER measured vehicle evidence (see evidence Zone-3).
  - Ownership is ALWAYS server-derived; client-supplied owner ids are advisory
    only and are overwritten server-side.
  - BYOK/Local requests MUST NOT silently fall back to paid VEYTRIC Cloud.
"""
from __future__ import annotations

from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

# Bump when the wire shape changes. Frontend mirror: src/gateway/contracts.ts.
AI_CONTRACT_VERSION = 1
RESEARCH_CONTRACT_VERSION = 1
AI_RESPONSE_SCHEMA_VERSION = 1
RESEARCH_RESULT_SCHEMA_VERSION = 1


# --------------------------------------------------------------------------- #
#  Provider modes & categories                                                #
# --------------------------------------------------------------------------- #
class ProviderMode(str, Enum):
    CLOUD = "CLOUD"          # VEYTRIC-managed key (metered + billed to VEYTRIC/credits)
    BYOK = "BYOK"            # user OpenAI key, device-direct (user pays; classified, not charged)
    LOCAL = "LOCAL"          # Ollama/local (free; classified, not charged)


# --------------------------------------------------------------------------- #
#  AI request purposes (allowlist)                                            #
# --------------------------------------------------------------------------- #
class AIPurpose(str, Enum):
    EXPLAIN_CODE = "EXPLAIN_CODE"
    SUMMARIZE_SCAN = "SUMMARIZE_SCAN"
    EXPLAIN_EVIDENCE_RELATIONSHIPS = "EXPLAIN_EVIDENCE_RELATIONSHIPS"
    COMPARE_SESSIONS = "COMPARE_SESSIONS"
    GENERATE_HYPOTHESES = "GENERATE_HYPOTHESES"
    EXPLAIN_CALCULATION = "EXPLAIN_CALCULATION"
    CUSTOMER_EXPLANATION = "CUSTOMER_EXPLANATION"
    TECHNICIAN_SUMMARY = "TECHNICIAN_SUMMARY"
    REPORT_NARRATIVE = "REPORT_NARRATIVE"
    RESEARCH_VEHICLE_ISSUE = "RESEARCH_VEHICLE_ISSUE"
    EXPLAIN_REPAIR_PROCEDURE = "EXPLAIN_REPAIR_PROCEDURE"
    SUGGEST_ADDITIONAL_EVIDENCE = "SUGGEST_ADDITIONAL_EVIDENCE"
    VALIDATE_NARRATIVE_SUPPORT = "VALIDATE_NARRATIVE_SUPPORT"
    ASSISTANT_CHAT = "ASSISTANT_CHAT"
    VEHICLE_HEALTH_NARRATIVE = "VEHICLE_HEALTH_NARRATIVE"
    TREND_EXPLANATION = "TREND_EXPLANATION"
    SPEECH_TO_TEXT = "SPEECH_TO_TEXT"
    TEXT_TO_SPEECH = "TEXT_TO_SPEECH"


class PrivacyClass(str, Enum):
    """How aggressively the privacy redactor minimizes the payload."""
    MINIMAL = "MINIMAL"                # evidence subset only; no identifiers
    VEHICLE_TECHNICAL = "VEHICLE_TECHNICAL"  # + year/make/model/engine, VIN tokenized
    VIN_REQUIRED = "VIN_REQUIRED"      # full VIN allowed (approved workflows only, recorded)


class CachePolicy(str, Enum):
    NONE = "NONE"
    READ = "READ"
    READ_WRITE = "READ_WRITE"


# --------------------------------------------------------------------------- #
#  Per-purpose policy (permissions, budgets, output schema requirements)       #
# --------------------------------------------------------------------------- #
class PurposePolicy(BaseModel):
    purpose: AIPurpose
    allowed_capabilities: List[str]     # capability router names permitted
    privacy: PrivacyClass
    research_allowed: bool = False
    cache_allowed: bool = False
    requires_session: bool = False      # must belong to a diagnostic session
    requires_confirmation: bool = False
    max_input_chars: int = 24000
    max_output_tokens: int = 1200
    max_token_budget: int = 8000
    max_duration_ms: int = 45000
    max_retries: int = 1
    initiating_agents: List[str] = Field(default_factory=list)  # empty = any authorized caller


# --------------------------------------------------------------------------- #
#  AI gateway request contract                                                #
# --------------------------------------------------------------------------- #
class AIGatewayRequest(BaseModel):
    contract_version: int = AI_CONTRACT_VERSION
    gateway_request_id: Optional[str] = None   # server-assigned if missing
    idempotency_key: Optional[str] = None
    # ownership: server-derived; any client value here is overwritten server-side
    owner_id: Optional[str] = None
    diagnostic_session_id: Optional[str] = None
    orchestrator_task_id: Optional[str] = None
    vehicle_id: Optional[str] = None

    purpose: AIPurpose
    provider_mode: ProviderMode = ProviderMode.CLOUD
    model_class: Optional[str] = None           # e.g. "reasoning" | "fast"; provider picks concrete model
    prompt_template_id: Optional[str] = None
    prompt_template_version: Optional[int] = None
    prompt: str = ""
    system: Optional[str] = None
    history: List[Dict[str, str]] = Field(default_factory=list)

    evidence_envelope_ref: Optional[str] = None  # task_id whose stored envelope to use
    evidence_fields: List[str] = Field(default_factory=list)
    evidence_max_age_ms: Optional[int] = None    # freshness requirement
    privacy_class: PrivacyClass = PrivacyClass.MINIMAL

    max_input_chars: Optional[int] = None
    max_output_tokens: Optional[int] = None
    max_token_budget: Optional[int] = None
    max_cost_micros: Optional[int] = None        # 1e-6 USD; None = policy default
    max_duration_ms: Optional[int] = None
    max_retries: Optional[int] = None

    cache_policy: CachePolicy = CachePolicy.NONE
    require_response_schema: bool = True
    created_at: Optional[str] = None


# --------------------------------------------------------------------------- #
#  Structured AI response contract                                            #
# --------------------------------------------------------------------------- #
class ConfidenceLevel(str, Enum):
    STRONGLY_SUPPORTED = "STRONGLY_SUPPORTED"
    SUPPORTED = "SUPPORTED"
    PLAUSIBLE = "PLAUSIBLE"
    WEAKLY_SUPPORTED = "WEAKLY_SUPPORTED"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    CONTRADICTED = "CONTRADICTED"
    UNAVAILABLE = "UNAVAILABLE"


class CompletionState(str, Enum):
    COMPLETED = "COMPLETED"
    PARTIAL = "PARTIAL"
    UNAVAILABLE = "UNAVAILABLE"
    CANCELLED = "CANCELLED"
    FAILED = "FAILED"


class Hypothesis(BaseModel):
    statement: str
    confidence: ConfidenceLevel
    supporting_evidence_ids: List[str] = Field(default_factory=list)


class AIGatewayResponse(BaseModel):
    schema_version: int = AI_RESPONSE_SCHEMA_VERSION
    gateway_request_id: str
    provider_mode: ProviderMode
    model: Optional[str] = None
    provider_request_id: Optional[str] = None
    purpose: AIPurpose
    completion_state: CompletionState
    generated_at: str

    evidence_references: List[str] = Field(default_factory=list)
    research_references: List[str] = Field(default_factory=list)
    supported_findings: List[str] = Field(default_factory=list)
    hypotheses: List[Hypothesis] = Field(default_factory=list)
    uncertainties: List[str] = Field(default_factory=list)
    missing_evidence: List[str] = Field(default_factory=list)
    contradictions: List[str] = Field(default_factory=list)
    recommended_next_evidence: List[str] = Field(default_factory=list)
    safety_notices: List[str] = Field(default_factory=list)

    user_explanation: str = ""
    technician_detail: Optional[str] = None
    overall_confidence: ConfidenceLevel = ConfidenceLevel.INSUFFICIENT_EVIDENCE

    usage_event_ref: Optional[str] = None
    cache_status: str = "MISS"          # HIT | MISS | BYPASS
    error_reason: Optional[str] = None


# --------------------------------------------------------------------------- #
#  Research gateway request / result                                          #
# --------------------------------------------------------------------------- #
class ResearchPurpose(str, Enum):
    DOCUMENTED_ISSUE = "DOCUMENTED_ISSUE"
    REPAIR_PROCEDURE = "REPAIR_PROCEDURE"
    TSB_RECALL_LOOKUP = "TSB_RECALL_LOOKUP"
    PART_COMPATIBILITY = "PART_COMPATIBILITY"
    VIN_DECODE = "VIN_DECODE"


class SourceQuality(str, Enum):
    AUTHORITATIVE = "AUTHORITATIVE"   # OEM/NHTSA/regulatory
    REPUTABLE = "REPUTABLE"
    COMMUNITY = "COMMUNITY"           # forums
    RETAIL = "RETAIL"                 # listings/aggregators
    UNVERIFIED = "UNVERIFIED"


class ResearchGatewayRequest(BaseModel):
    contract_version: int = RESEARCH_CONTRACT_VERSION
    research_request_id: Optional[str] = None
    idempotency_key: Optional[str] = None
    owner_id: Optional[str] = None
    diagnostic_session_id: Optional[str] = None
    vehicle_id: Optional[str] = None

    purpose: ResearchPurpose
    query: str = ""
    applicability: Dict[str, Any] = Field(default_factory=dict)  # vin/year/make/model/engine…
    max_results: int = 5
    max_queries: int = 3
    max_duration_ms: int = 20000
    max_cost_micros: Optional[int] = None
    cache_policy: CachePolicy = CachePolicy.READ_WRITE
    created_at: Optional[str] = None


class ResearchSource(BaseModel):
    url: Optional[str] = None
    title: Optional[str] = None
    quality: SourceQuality = SourceQuality.UNVERIFIED
    retrieved_at: Optional[str] = None
    applicability_verified: bool = False
    excerpt: Optional[str] = None


class ResearchGatewayResult(BaseModel):
    schema_version: int = RESEARCH_RESULT_SCHEMA_VERSION
    research_request_id: str
    owner_id: str
    diagnostic_session_id: Optional[str] = None
    purpose: ResearchPurpose
    sanitized_query: str = ""
    sources: List[ResearchSource] = Field(default_factory=list)
    structured_facts: List[Dict[str, Any]] = Field(default_factory=list)
    conflicts: List[str] = Field(default_factory=list)
    missing_information: List[str] = Field(default_factory=list)
    applicability_constraints: Dict[str, Any] = Field(default_factory=dict)
    freshness_expires_at: Optional[str] = None
    usage_event_ref: Optional[str] = None
    state: CompletionState = CompletionState.UNAVAILABLE
    cache_status: str = "MISS"
    error_reason: Optional[str] = None


# --------------------------------------------------------------------------- #
#  Structured failure model                                                   #
# --------------------------------------------------------------------------- #
class GatewayErrorCode(str, Enum):
    AUTH_REQUIRED = "AUTH_REQUIRED"
    FORBIDDEN = "FORBIDDEN"
    INVALID_REQUEST = "INVALID_REQUEST"
    UNSUPPORTED_CAPABILITY = "UNSUPPORTED_CAPABILITY"
    PROVIDER_NOT_CONFIGURED = "PROVIDER_NOT_CONFIGURED"
    PROVIDER_DISABLED = "PROVIDER_DISABLED"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    RATE_LIMITED = "RATE_LIMITED"
    BUDGET_EXHAUSTED = "BUDGET_EXHAUSTED"
    ALLOWANCE_EXHAUSTED = "ALLOWANCE_EXHAUSTED"
    TIMEOUT = "TIMEOUT"
    CANCELLED = "CANCELLED"
    EVIDENCE_UNAVAILABLE = "EVIDENCE_UNAVAILABLE"
    EVIDENCE_STALE = "EVIDENCE_STALE"
    EVIDENCE_MALFORMED = "EVIDENCE_MALFORMED"
    SCHEMA_VALIDATION_FAILED = "SCHEMA_VALIDATION_FAILED"
    RESEARCH_UNAVAILABLE = "RESEARCH_UNAVAILABLE"
    PRIVACY_POLICY_BLOCKED = "PRIVACY_POLICY_BLOCKED"
    INTERNAL_ERROR = "INTERNAL_ERROR"


# code -> (retryable, user_action_required, http_status)
_ERROR_META = {
    GatewayErrorCode.AUTH_REQUIRED: (False, True, 401),
    GatewayErrorCode.FORBIDDEN: (False, True, 403),
    GatewayErrorCode.INVALID_REQUEST: (False, True, 400),
    GatewayErrorCode.UNSUPPORTED_CAPABILITY: (False, False, 400),
    GatewayErrorCode.PROVIDER_NOT_CONFIGURED: (False, True, 400),
    GatewayErrorCode.PROVIDER_DISABLED: (False, False, 503),
    GatewayErrorCode.PROVIDER_UNAVAILABLE: (True, False, 503),
    GatewayErrorCode.RATE_LIMITED: (True, False, 429),
    GatewayErrorCode.BUDGET_EXHAUSTED: (False, True, 402),
    GatewayErrorCode.ALLOWANCE_EXHAUSTED: (False, True, 429),
    GatewayErrorCode.TIMEOUT: (True, False, 504),
    GatewayErrorCode.CANCELLED: (False, False, 499),
    GatewayErrorCode.EVIDENCE_UNAVAILABLE: (False, True, 409),
    GatewayErrorCode.EVIDENCE_STALE: (False, True, 409),
    GatewayErrorCode.EVIDENCE_MALFORMED: (False, True, 409),
    GatewayErrorCode.SCHEMA_VALIDATION_FAILED: (True, False, 502),
    GatewayErrorCode.RESEARCH_UNAVAILABLE: (True, False, 503),
    GatewayErrorCode.PRIVACY_POLICY_BLOCKED: (False, True, 400),
    GatewayErrorCode.INTERNAL_ERROR: (False, False, 500),
}

# Non-retryable failure classes (mirrors Prompt 3 §11).
NON_RETRYABLE = {c for c, m in _ERROR_META.items() if not m[0]}


class GatewayFailure(BaseModel):
    code: GatewayErrorCode
    message: str                      # safe, user-facing language (no stack/secret)
    retryable: bool = False
    user_action_required: bool = False
    provider_spend_occurred: bool = False
    partial_results_available: bool = False
    workflow_may_continue: bool = True
    correlation_id: Optional[str] = None
    http_status: int = 500

    @classmethod
    def of(cls, code: GatewayErrorCode, message: str, *,
           provider_spend_occurred: bool = False,
           partial_results_available: bool = False,
           workflow_may_continue: bool = True,
           correlation_id: Optional[str] = None) -> "GatewayFailure":
        retryable, action, status = _ERROR_META[code]
        return cls(
            code=code, message=message, retryable=retryable,
            user_action_required=action, provider_spend_occurred=provider_spend_occurred,
            partial_results_available=partial_results_available,
            workflow_may_continue=workflow_may_continue,
            correlation_id=correlation_id, http_status=status,
        )


class GatewayError(Exception):
    """Raised inside the gateway; carries a structured GatewayFailure."""
    def __init__(self, failure: GatewayFailure):
        super().__init__(failure.message)
        self.failure = failure


# --------------------------------------------------------------------------- #
#  Purpose policy registry (server-authoritative; clients may only tighten)   #
# --------------------------------------------------------------------------- #
def _p(purpose, caps, privacy, **kw) -> PurposePolicy:
    return PurposePolicy(purpose=purpose, allowed_capabilities=caps, privacy=privacy, **kw)

PURPOSE_POLICIES: Dict[AIPurpose, PurposePolicy] = {
    AIPurpose.EXPLAIN_CODE: _p(AIPurpose.EXPLAIN_CODE, ["ai.explain"], PrivacyClass.VEHICLE_TECHNICAL,
                               research_allowed=True, cache_allowed=True, max_output_tokens=900),
    AIPurpose.SUMMARIZE_SCAN: _p(AIPurpose.SUMMARIZE_SCAN, ["ai.summarize"], PrivacyClass.VEHICLE_TECHNICAL,
                                 requires_session=True, max_output_tokens=1000),
    AIPurpose.EXPLAIN_EVIDENCE_RELATIONSHIPS: _p(AIPurpose.EXPLAIN_EVIDENCE_RELATIONSHIPS, ["ai.explain"], PrivacyClass.VEHICLE_TECHNICAL, requires_session=True),
    AIPurpose.COMPARE_SESSIONS: _p(AIPurpose.COMPARE_SESSIONS, ["ai.compare"], PrivacyClass.VEHICLE_TECHNICAL, requires_session=True),
    AIPurpose.GENERATE_HYPOTHESES: _p(AIPurpose.GENERATE_HYPOTHESES, ["ai.reason"], PrivacyClass.VEHICLE_TECHNICAL, requires_session=True, research_allowed=True),
    AIPurpose.EXPLAIN_CALCULATION: _p(AIPurpose.EXPLAIN_CALCULATION, ["ai.explain"], PrivacyClass.MINIMAL, cache_allowed=True),
    AIPurpose.CUSTOMER_EXPLANATION: _p(AIPurpose.CUSTOMER_EXPLANATION, ["ai.narrate"], PrivacyClass.MINIMAL),
    AIPurpose.TECHNICIAN_SUMMARY: _p(AIPurpose.TECHNICIAN_SUMMARY, ["ai.narrate"], PrivacyClass.VEHICLE_TECHNICAL),
    AIPurpose.REPORT_NARRATIVE: _p(AIPurpose.REPORT_NARRATIVE, ["ai.narrate"], PrivacyClass.VEHICLE_TECHNICAL, requires_session=True),
    AIPurpose.RESEARCH_VEHICLE_ISSUE: _p(AIPurpose.RESEARCH_VEHICLE_ISSUE, ["ai.reason"], PrivacyClass.VEHICLE_TECHNICAL, research_allowed=True, cache_allowed=True),
    AIPurpose.EXPLAIN_REPAIR_PROCEDURE: _p(AIPurpose.EXPLAIN_REPAIR_PROCEDURE, ["ai.explain"], PrivacyClass.VEHICLE_TECHNICAL, research_allowed=True, cache_allowed=True, requires_confirmation=True),
    AIPurpose.SUGGEST_ADDITIONAL_EVIDENCE: _p(AIPurpose.SUGGEST_ADDITIONAL_EVIDENCE, ["ai.reason"], PrivacyClass.VEHICLE_TECHNICAL, requires_session=True),
    AIPurpose.VALIDATE_NARRATIVE_SUPPORT: _p(AIPurpose.VALIDATE_NARRATIVE_SUPPORT, ["ai.validate"], PrivacyClass.MINIMAL, requires_session=True),
    AIPurpose.ASSISTANT_CHAT: _p(AIPurpose.ASSISTANT_CHAT, ["ai.chat"], PrivacyClass.VEHICLE_TECHNICAL, max_output_tokens=1400),
    AIPurpose.VEHICLE_HEALTH_NARRATIVE: _p(AIPurpose.VEHICLE_HEALTH_NARRATIVE, ["ai.narrate"], PrivacyClass.VEHICLE_TECHNICAL),
    AIPurpose.TREND_EXPLANATION: _p(AIPurpose.TREND_EXPLANATION, ["ai.explain"], PrivacyClass.VEHICLE_TECHNICAL),
    AIPurpose.SPEECH_TO_TEXT: _p(AIPurpose.SPEECH_TO_TEXT, ["ai.stt"], PrivacyClass.MINIMAL, max_output_tokens=2000),
    AIPurpose.TEXT_TO_SPEECH: _p(AIPurpose.TEXT_TO_SPEECH, ["ai.tts"], PrivacyClass.MINIMAL, max_output_tokens=1),
}


def get_purpose_policy(purpose: AIPurpose) -> PurposePolicy:
    policy = PURPOSE_POLICIES.get(purpose)
    if policy is None:
        raise GatewayError(GatewayFailure.of(
            GatewayErrorCode.INVALID_REQUEST, "Unsupported AI purpose."))
    return policy
