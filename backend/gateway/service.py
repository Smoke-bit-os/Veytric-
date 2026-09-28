"""VEYTRIC — Prompt 3 Central AI Gateway service (Phase 3B + 3C).

The single authoritative path for server-executed AI. Enforces (in order):
auth/ownership -> purpose policy -> capability routing -> idempotency ->
allowance/entitlement (CLOUD) -> rate limit + concurrency -> budget reservation
-> provider execution (with timeout) -> structured-schema validation (one
bounded, metered repair) -> idempotent metering + budget finalize -> persist.

BYOK/LOCAL are NEVER executed here (device-direct). `record_client_usage`
meters them (VEYTRIC cost = 0) so usage totals separate CLOUD/BYOK/LOCAL.
"""
from __future__ import annotations

import time
import uuid
from typing import Optional, Callable, Awaitable

from .contracts import (
    AIGatewayRequest, AIGatewayResponse, ProviderMode, CompletionState,
    ConfidenceLevel, Hypothesis, GatewayError, GatewayFailure, GatewayErrorCode,
    get_purpose_policy, AI_RESPONSE_SCHEMA_VERSION,
)
from .providers import AIProviderRegistry, parse_structured
from .metering import UsageMeter, BudgetEnforcer, RateLimiter, _now_ms

# Server-authoritative hard ceilings (clients may only request stricter).
SERVER_MAX_OUTPUT_TOKENS = 4000
SERVER_MAX_TOKEN_BUDGET = 20000
SERVER_MAX_DURATION_MS = 60000
SERVER_MAX_COST_MICROS = 500000  # 0.50 USD / request hard cap
RATE_MAX_PER_WINDOW = 20
RATE_WINDOW_S = 60
RATE_MAX_CONCURRENT = 4


def _iso_now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


AllowanceFn = Callable[[dict, ProviderMode], Awaitable[dict]]


class CentralAIGateway:
    def __init__(self, db, registry: AIProviderRegistry,
                 allowance_fn: Optional[AllowanceFn] = None):
        self.db = db
        self.registry = registry
        self.meter = UsageMeter(db)
        self.budget = BudgetEnforcer(db)
        self.limiter = RateLimiter()
        self._allowance_fn = allowance_fn

    # -- ownership helpers (server-derived; another user's resource -> 404) --
    async def _assert_vehicle(self, owner_id, vehicle_id):
        v = await self.db.vehicles.find_one({"_id": vehicle_id, "user_id": owner_id}) \
            or await self.db.vehicles.find_one({"id": vehicle_id, "user_id": owner_id})
        if not v:
            raise GatewayError(GatewayFailure.of(
                GatewayErrorCode.FORBIDDEN, "Vehicle not found."))

    async def _assert_session(self, owner_id, session_id):
        s = await self.db.diagnostic_sessions.find_one({"_id": session_id, "user_id": owner_id})
        if not s:
            raise GatewayError(GatewayFailure.of(
                GatewayErrorCode.FORBIDDEN, "Diagnostic session not found."))

    async def _load_owned_envelope(self, owner_id, task_id):
        d = await self.db.evidence_records.find_one({"_id": task_id, "user_id": owner_id})
        if not d:
            raise GatewayError(GatewayFailure.of(
                GatewayErrorCode.EVIDENCE_UNAVAILABLE,
                "The requested evidence is unavailable for this account."))
        return d

    def _build_response(self, req: AIGatewayRequest, gw_id: str, model: str,
                        parsed: Optional[dict], raw_text: str,
                        provider_mode: ProviderMode) -> AIGatewayResponse:
        parsed = parsed or {}
        hyps = []
        for h in parsed.get("hypotheses", []) or []:
            try:
                hyps.append(Hypothesis(
                    statement=str(h.get("statement", "")),
                    confidence=ConfidenceLevel(h.get("confidence", "INSUFFICIENT_EVIDENCE")),
                    supporting_evidence_ids=list(h.get("supporting_evidence_ids", []) or [])))
            except Exception:
                continue
        try:
            conf = ConfidenceLevel(parsed.get("overall_confidence", "INSUFFICIENT_EVIDENCE"))
        except Exception:
            conf = ConfidenceLevel.INSUFFICIENT_EVIDENCE
        return AIGatewayResponse(
            schema_version=AI_RESPONSE_SCHEMA_VERSION,
            gateway_request_id=gw_id, provider_mode=provider_mode, model=model,
            purpose=req.purpose, completion_state=CompletionState.COMPLETED,
            generated_at=_iso_now(),
            evidence_references=[req.evidence_envelope_ref] if req.evidence_envelope_ref else [],
            supported_findings=list(parsed.get("supported_findings", []) or []),
            hypotheses=hyps,
            uncertainties=list(parsed.get("uncertainties", []) or []),
            missing_evidence=list(parsed.get("missing_evidence", []) or []),
            contradictions=list(parsed.get("contradictions", []) or []),
            recommended_next_evidence=list(parsed.get("recommended_next_evidence", []) or []),
            safety_notices=list(parsed.get("safety_notices", []) or []),
            user_explanation=str(parsed.get("user_explanation", "") or raw_text[:4000]),
            technician_detail=parsed.get("technician_detail"),
            overall_confidence=conf, cache_status="MISS")

    async def execute(self, req: AIGatewayRequest, user: dict, *,
                      mock=None) -> AIGatewayResponse:
        owner_id = user["_id"]                    # server-derived; overwrite client value
        req.owner_id = owner_id
        gw_id = req.gateway_request_id or str(uuid.uuid4())
        req.gateway_request_id = gw_id

        # 1) purpose policy + provider mode
        policy = get_purpose_policy(req.purpose)
        if req.provider_mode != ProviderMode.CLOUD:
            raise GatewayError(GatewayFailure.of(
                GatewayErrorCode.INVALID_REQUEST,
                "BYOK and Local requests run on your device and are metered via the record "
                "endpoint. VEYTRIC Cloud is never used as an automatic fallback."))
        capability = policy.allowed_capabilities[0]

        # 2) input size + structural validation
        if len(req.prompt or "") > policy.max_input_chars:
            raise GatewayError(GatewayFailure.of(
                GatewayErrorCode.INVALID_REQUEST, "Request is too large."))
        if policy.requires_session and not req.diagnostic_session_id:
            raise GatewayError(GatewayFailure.of(
                GatewayErrorCode.INVALID_REQUEST,
                "This request must belong to a diagnostic session."))

        # 3) ownership
        if req.diagnostic_session_id:
            await self._assert_session(owner_id, req.diagnostic_session_id)
        if req.vehicle_id:
            await self._assert_vehicle(owner_id, req.vehicle_id)
        if req.evidence_envelope_ref:
            await self._load_owned_envelope(owner_id, req.evidence_envelope_ref)

        # 4) idempotency: prior terminal result -> replay, no re-charge
        if req.idempotency_key:
            prior = await self.db.ai_gateway_requests.find_one(
                {"owner_id": owner_id, "idempotency_key": req.idempotency_key})
            if prior and prior.get("status") == "COMPLETED" and prior.get("response"):
                resp = AIGatewayResponse(**prior["response"])
                resp.cache_status = "HIT"
                return resp

        # 5) capability routing (also enforces provider-disable)
        provider = self.registry.resolve(ProviderMode.CLOUD.value, capability)

        # 6) allowance / entitlement (CLOUD only)
        if self._allowance_fn:
            await self._allowance_fn(user, ProviderMode.CLOUD)

        # 7) rate limit + concurrency
        self.limiter.check(owner_id=owner_id, purpose=req.purpose.value,
                           max_per_window=RATE_MAX_PER_WINDOW, window_s=RATE_WINDOW_S,
                           max_concurrent=RATE_MAX_CONCURRENT)

        # 8) budget reservation (server ceilings; client may only tighten)
        max_out = self.budget.clamp(req.max_output_tokens or policy.max_output_tokens, SERVER_MAX_OUTPUT_TOKENS)
        max_tok = self.budget.clamp(req.max_token_budget or policy.max_token_budget, SERVER_MAX_TOKEN_BUDGET)
        max_dur = self.budget.clamp(req.max_duration_ms or policy.max_duration_ms, SERVER_MAX_DURATION_MS)
        max_cost = self.budget.clamp(req.max_cost_micros, SERVER_MAX_COST_MICROS)
        await self.budget.reserve(owner_id=owner_id, request_id=gw_id,
                                  max_cost_micros=max_cost, max_tokens=max_tok)

        # 9) persist RUNNING
        started = _now_ms()
        await self.db.ai_gateway_requests.update_one(
            {"_id": gw_id},
            {"$set": {"_id": gw_id, "owner_id": owner_id,
                      "idempotency_key": req.idempotency_key, "purpose": req.purpose.value,
                      "provider_mode": "CLOUD", "status": "RUNNING",
                      "diagnostic_session_id": req.diagnostic_session_id,
                      "orchestrator_task_id": req.orchestrator_task_id,
                      "vehicle_id": req.vehicle_id, "started_ms": started}},
            upsert=True)

        self.limiter.acquire(owner_id, req.purpose.value)
        retry_count = 0
        schema_failed = False
        provider_error = False
        timed_out = False
        try:
            active = mock if mock is not None else provider
            system = req.system or "You are VEYTRIC, an automotive diagnostic assistant. Respond as compact JSON."
            result = await active.generate(system=system, prompt=req.prompt or "",
                                           max_output_tokens=max_out, timeout_ms=max_dur)
            parsed = parse_structured(result.text)
            # one bounded, metered repair attempt for schema failures
            if parsed is None and req.require_response_schema:
                schema_failed = True
                retry_count = 1
                repair_prompt = (req.prompt or "") + "\n\nReturn ONLY a valid compact JSON object."
                result2 = await active.generate(system=system, prompt=repair_prompt,
                                                 max_output_tokens=max_out, timeout_ms=max_dur)
                result.input_tokens += result2.input_tokens
                result.output_tokens += result2.output_tokens
                parsed = parse_structured(result2.text)
                result.text = result2.text
                if parsed is None:
                    raise GatewayError(GatewayFailure.of(
                        GatewayErrorCode.SCHEMA_VALIDATION_FAILED,
                        "The AI response could not be validated and was rejected — no diagnosis was produced.",
                        provider_spend_occurred=True))

            in_tok, out_tok = result.input_tokens, result.output_tokens
            from .pricing import cloud_cost_micros
            actual_cost = cloud_cost_micros(result.model, in_tok, out_tok)
            await self.budget.enforce_within(request_id=gw_id, cost_micros=actual_cost, tokens=in_tok + out_tok)

            resp = self._build_response(req, gw_id, result.model, parsed, result.text, ProviderMode.CLOUD)
            completed = _now_ms()
            usage_ref = await self.meter.record(
                owner_id=owner_id, gateway_request_id=gw_id, kind="AI",
                provider_mode="CLOUD", model=result.model, purpose=req.purpose.value,
                input_tokens=in_tok, output_tokens=out_tok,
                started_ms=started, completed_ms=completed, final_status="COMPLETED",
                diagnostic_session_id=req.diagnostic_session_id,
                orchestrator_task_id=req.orchestrator_task_id, vehicle_id=req.vehicle_id,
                idempotency_key=req.idempotency_key, retry_count=retry_count,
                schema_failed=schema_failed)
            resp.usage_event_ref = usage_ref
            await self.budget.finalize(request_id=gw_id, cost_micros=actual_cost, tokens=in_tok + out_tok)
            await self.db.ai_gateway_requests.update_one(
                {"_id": gw_id}, {"$set": {"status": "COMPLETED", "completed_ms": completed,
                                          "response": resp.model_dump(mode="json")}})
            return resp
        except GatewayError as ge:
            # meter attempts that actually contacted the provider
            spend = ge.failure.provider_spend_occurred
            if ge.failure.code == GatewayErrorCode.TIMEOUT:
                timed_out = True
            if ge.failure.code == GatewayErrorCode.SCHEMA_VALIDATION_FAILED:
                schema_failed = True
            if spend:
                await self.meter.record(
                    owner_id=owner_id, gateway_request_id=gw_id, kind="AI",
                    provider_mode="CLOUD", model="gpt-5.4", purpose=req.purpose.value,
                    input_tokens=0, output_tokens=0, started_ms=started,
                    completed_ms=_now_ms(), final_status=ge.failure.code.value,
                    diagnostic_session_id=req.diagnostic_session_id,
                    idempotency_key=req.idempotency_key, retry_count=retry_count,
                    timed_out=timed_out, schema_failed=schema_failed, provider_error=True)
            await self.budget.finalize(request_id=gw_id, cost_micros=0, tokens=0, state="ABORTED")
            await self.db.ai_gateway_requests.update_one(
                {"_id": gw_id}, {"$set": {"status": "FAILED", "error": ge.failure.code.value}})
            raise
        except Exception as e:  # unexpected provider failure
            provider_error = True
            await self.budget.finalize(request_id=gw_id, cost_micros=0, tokens=0, state="ABORTED")
            await self.db.ai_gateway_requests.update_one(
                {"_id": gw_id}, {"$set": {"status": "FAILED", "error": "PROVIDER_UNAVAILABLE"}})
            raise GatewayError(GatewayFailure.of(
                GatewayErrorCode.PROVIDER_UNAVAILABLE,
                "The AI provider is temporarily unavailable. Core diagnostics still work.",
                provider_spend_occurred=False)) from e
        finally:
            self.limiter.release(owner_id, req.purpose.value)

    async def record_client_usage(self, req: AIGatewayRequest, user: dict, *,
                                   input_tokens: int, output_tokens: int,
                                   model: str, final_status: str = "COMPLETED") -> dict:
        """Meter a BYOK/LOCAL request executed on-device. VEYTRIC cost = 0.
        Never touches the Cloud allowance and never falls back to Cloud."""
        owner_id = user["_id"]
        if req.provider_mode == ProviderMode.CLOUD:
            raise GatewayError(GatewayFailure.of(
                GatewayErrorCode.INVALID_REQUEST,
                "Cloud requests must be executed through the gateway, not recorded."))
        get_purpose_policy(req.purpose)  # validate purpose allowlist
        if req.diagnostic_session_id:
            await self._assert_session(owner_id, req.diagnostic_session_id)
        if req.vehicle_id:
            await self._assert_vehicle(owner_id, req.vehicle_id)
        gw_id = req.gateway_request_id or str(uuid.uuid4())
        now = _now_ms()
        usage_ref = await self.meter.record(
            owner_id=owner_id, gateway_request_id=gw_id, kind="AI",
            provider_mode=req.provider_mode.value, model=model, purpose=req.purpose.value,
            input_tokens=max(0, int(input_tokens)), output_tokens=max(0, int(output_tokens)),
            started_ms=now, completed_ms=now, final_status=final_status,
            diagnostic_session_id=req.diagnostic_session_id, vehicle_id=req.vehicle_id,
            idempotency_key=req.idempotency_key)
        return {"gateway_request_id": gw_id, "usage_event_ref": usage_ref,
                "provider_mode": req.provider_mode.value, "veytric_cost_micros": 0}
