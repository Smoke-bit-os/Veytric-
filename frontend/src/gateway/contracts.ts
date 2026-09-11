// VEYTRIC — Prompt 3 gateway contracts (frontend mirror of backend/gateway/contracts.py).
// Types only. Keep in sync with the backend; bump versions together.

export const AI_CONTRACT_VERSION = 1;
export const AI_RESPONSE_SCHEMA_VERSION = 1;
export const RESEARCH_CONTRACT_VERSION = 1;

export enum ProviderMode {
  CLOUD = "CLOUD",
  BYOK = "BYOK",
  LOCAL = "LOCAL",
}

export enum AIPurpose {
  EXPLAIN_CODE = "EXPLAIN_CODE",
  SUMMARIZE_SCAN = "SUMMARIZE_SCAN",
  EXPLAIN_EVIDENCE_RELATIONSHIPS = "EXPLAIN_EVIDENCE_RELATIONSHIPS",
  COMPARE_SESSIONS = "COMPARE_SESSIONS",
  GENERATE_HYPOTHESES = "GENERATE_HYPOTHESES",
  EXPLAIN_CALCULATION = "EXPLAIN_CALCULATION",
  CUSTOMER_EXPLANATION = "CUSTOMER_EXPLANATION",
  TECHNICIAN_SUMMARY = "TECHNICIAN_SUMMARY",
  REPORT_NARRATIVE = "REPORT_NARRATIVE",
  RESEARCH_VEHICLE_ISSUE = "RESEARCH_VEHICLE_ISSUE",
  EXPLAIN_REPAIR_PROCEDURE = "EXPLAIN_REPAIR_PROCEDURE",
  SUGGEST_ADDITIONAL_EVIDENCE = "SUGGEST_ADDITIONAL_EVIDENCE",
  VALIDATE_NARRATIVE_SUPPORT = "VALIDATE_NARRATIVE_SUPPORT",
  ASSISTANT_CHAT = "ASSISTANT_CHAT",
  VEHICLE_HEALTH_NARRATIVE = "VEHICLE_HEALTH_NARRATIVE",
  TREND_EXPLANATION = "TREND_EXPLANATION",
  SPEECH_TO_TEXT = "SPEECH_TO_TEXT",
  TEXT_TO_SPEECH = "TEXT_TO_SPEECH",
}

export enum PrivacyClass {
  MINIMAL = "MINIMAL",
  VEHICLE_TECHNICAL = "VEHICLE_TECHNICAL",
  VIN_REQUIRED = "VIN_REQUIRED",
}

export enum CachePolicy {
  NONE = "NONE",
  READ = "READ",
  READ_WRITE = "READ_WRITE",
}

export enum ConfidenceLevel {
  STRONGLY_SUPPORTED = "STRONGLY_SUPPORTED",
  SUPPORTED = "SUPPORTED",
  PLAUSIBLE = "PLAUSIBLE",
  WEAKLY_SUPPORTED = "WEAKLY_SUPPORTED",
  INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE",
  CONTRADICTED = "CONTRADICTED",
  UNAVAILABLE = "UNAVAILABLE",
}

export enum CompletionState {
  COMPLETED = "COMPLETED",
  PARTIAL = "PARTIAL",
  UNAVAILABLE = "UNAVAILABLE",
  CANCELLED = "CANCELLED",
  FAILED = "FAILED",
}

export enum GatewayErrorCode {
  AUTH_REQUIRED = "AUTH_REQUIRED",
  FORBIDDEN = "FORBIDDEN",
  INVALID_REQUEST = "INVALID_REQUEST",
  UNSUPPORTED_CAPABILITY = "UNSUPPORTED_CAPABILITY",
  PROVIDER_NOT_CONFIGURED = "PROVIDER_NOT_CONFIGURED",
  PROVIDER_DISABLED = "PROVIDER_DISABLED",
  PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE",
  RATE_LIMITED = "RATE_LIMITED",
  BUDGET_EXHAUSTED = "BUDGET_EXHAUSTED",
  ALLOWANCE_EXHAUSTED = "ALLOWANCE_EXHAUSTED",
  TIMEOUT = "TIMEOUT",
  CANCELLED = "CANCELLED",
  EVIDENCE_UNAVAILABLE = "EVIDENCE_UNAVAILABLE",
  EVIDENCE_STALE = "EVIDENCE_STALE",
  EVIDENCE_MALFORMED = "EVIDENCE_MALFORMED",
  SCHEMA_VALIDATION_FAILED = "SCHEMA_VALIDATION_FAILED",
  RESEARCH_UNAVAILABLE = "RESEARCH_UNAVAILABLE",
  PRIVACY_POLICY_BLOCKED = "PRIVACY_POLICY_BLOCKED",
  INTERNAL_ERROR = "INTERNAL_ERROR",
}

export interface AIGatewayRequest {
  contract_version?: number;
  gateway_request_id?: string;
  idempotency_key?: string;
  diagnostic_session_id?: string | null;
  orchestrator_task_id?: string | null;
  vehicle_id?: string | null;
  purpose: AIPurpose;
  provider_mode?: ProviderMode;
  model_class?: string;
  prompt_template_id?: string;
  prompt_template_version?: number;
  prompt?: string;
  system?: string;
  history?: { role: string; content: string }[];
  evidence_envelope_ref?: string | null;
  evidence_fields?: string[];
  evidence_max_age_ms?: number | null;
  privacy_class?: PrivacyClass;
  max_output_tokens?: number;
  max_token_budget?: number;
  max_duration_ms?: number;
  max_retries?: number;
  cache_policy?: CachePolicy;
  require_response_schema?: boolean;
}

export interface Hypothesis {
  statement: string;
  confidence: ConfidenceLevel;
  supporting_evidence_ids: string[];
}

export interface AIGatewayResponse {
  schema_version: number;
  gateway_request_id: string;
  provider_mode: ProviderMode;
  model?: string;
  purpose: AIPurpose;
  completion_state: CompletionState;
  generated_at: string;
  evidence_references: string[];
  research_references: string[];
  supported_findings: string[];
  hypotheses: Hypothesis[];
  uncertainties: string[];
  missing_evidence: string[];
  contradictions: string[];
  recommended_next_evidence: string[];
  safety_notices: string[];
  user_explanation: string;
  technician_detail?: string | null;
  overall_confidence: ConfidenceLevel;
  usage_event_ref?: string | null;
  cache_status: string;
  error_reason?: string | null;
}

export interface GatewayFailure {
  code: GatewayErrorCode;
  message: string;
  retryable: boolean;
  user_action_required: boolean;
  provider_spend_occurred: boolean;
  partial_results_available: boolean;
  workflow_may_continue: boolean;
  correlation_id?: string | null;
  http_status: number;
}
