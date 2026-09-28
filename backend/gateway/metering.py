"""VEYTRIC — Prompt 3 metering, cost attribution, budgets, rate limiting (Phase 3C).

Authoritative usage ledger. All writes are idempotent and resistant to
double-charging across restart / retry / replay / duplicate submission via a
unique (owner_id, gateway_request_id) index plus a unique partial
(owner_id, idempotency_key) index.

Prompt 3 establishes the ledger; Prompt 4 will build the customer wallet on top.
"""
from __future__ import annotations

import time
import uuid
from typing import Optional, Dict, Any

from pymongo.errors import DuplicateKeyError

from .contracts import GatewayError, GatewayFailure, GatewayErrorCode
from .pricing import split_cost


def _now_ms() -> int:
    return int(time.time() * 1000)


class UsageMeter:
    """Idempotent usage-event writer. One event per (owner, gateway_request_id)."""

    def __init__(self, db):
        self.db = db

    async def record(
        self, *, owner_id: str, gateway_request_id: str, kind: str,
        provider_mode: str, model: Optional[str], purpose: str,
        input_tokens: int, output_tokens: int,
        started_ms: int, completed_ms: int, final_status: str,
        diagnostic_session_id: Optional[str] = None,
        orchestrator_task_id: Optional[str] = None,
        vehicle_id: Optional[str] = None, idempotency_key: Optional[str] = None,
        retry_count: int = 0, fallback_count: int = 0,
        cache_hit: bool = False, cancelled: bool = False, timed_out: bool = False,
        provider_error: bool = False, schema_failed: bool = False,
        extra: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Insert one usage event; returns its id. Replays return the existing
        id WITHOUT charging again."""
        existing = await self.db.usage_events.find_one(
            {"owner_id": owner_id, "gateway_request_id": gateway_request_id},
            {"_id": 1})
        if existing:
            return existing["_id"]

        veytric_cost, provider_cost = split_cost(
            provider_mode, model or "default", input_tokens, output_tokens)
        # cache hits and non-executed attempts never create provider spend/cost
        if cache_hit:
            veytric_cost = provider_cost = 0

        doc = {
            "_id": str(uuid.uuid4()),
            "owner_id": owner_id,
            "gateway_request_id": gateway_request_id,
            "idempotency_key": idempotency_key,
            "kind": kind,  # "AI" | "RESEARCH"
            "provider_mode": provider_mode,  # CLOUD | BYOK | LOCAL
            "model": model,
            "purpose": purpose,
            "diagnostic_session_id": diagnostic_session_id,
            "orchestrator_task_id": orchestrator_task_id,
            "vehicle_id": vehicle_id,
            "input_tokens": int(input_tokens),
            "output_tokens": int(output_tokens),
            "veytric_cost_micros": int(veytric_cost),   # attributable to VEYTRIC / credits (Prompt 4)
            "provider_cost_micros": int(provider_cost),
            "customer_credit_micros": int(veytric_cost),  # Prompt 4 hook (CLOUD only)
            "byok": provider_mode == "BYOK",
            "local": provider_mode == "LOCAL",
            "retry_count": int(retry_count),
            "fallback_count": int(fallback_count),
            "cache_hit": bool(cache_hit),
            "cancelled": bool(cancelled),
            "timed_out": bool(timed_out),
            "provider_error": bool(provider_error),
            "schema_validation_failed": bool(schema_failed),
            "final_status": final_status,
            "started_ms": int(started_ms),
            "completed_ms": int(completed_ms),
            "latency_ms": max(0, int(completed_ms) - int(started_ms)),
            "created_at": _now_ms(),
            "extra": extra or {},
        }
        try:
            await self.db.usage_events.insert_one(doc)
        except DuplicateKeyError:
            again = await self.db.usage_events.find_one(
                {"owner_id": owner_id, "gateway_request_id": gateway_request_id},
                {"_id": 1})
            return (again or {}).get("_id", doc["_id"])
        return doc["_id"]

    async def summary(self, owner_id: str, month_key: str) -> Dict[str, Any]:
        cur = self.db.usage_events.find({"owner_id": owner_id})
        totals = {
            "CLOUD": {"events": 0, "input_tokens": 0, "output_tokens": 0, "veytric_cost_micros": 0},
            "BYOK": {"events": 0, "input_tokens": 0, "output_tokens": 0, "veytric_cost_micros": 0},
            "LOCAL": {"events": 0, "input_tokens": 0, "output_tokens": 0, "veytric_cost_micros": 0},
        }
        async for e in cur:
            m = e.get("provider_mode", "CLOUD")
            b = totals.setdefault(m, {"events": 0, "input_tokens": 0, "output_tokens": 0, "veytric_cost_micros": 0})
            b["events"] += 1
            b["input_tokens"] += int(e.get("input_tokens", 0))
            b["output_tokens"] += int(e.get("output_tokens", 0))
            b["veytric_cost_micros"] += int(e.get("veytric_cost_micros", 0))
        return {"owner_id": owner_id, "month": month_key, "by_provider": totals}


class BudgetEnforcer:
    """Reserve-then-finalize spending guard. Server limits are authoritative;
    a client may request a stricter (lower) cap but never a higher one."""

    def __init__(self, db):
        self.db = db

    def clamp(self, requested: Optional[int], server_max: int) -> int:
        if requested is None:
            return server_max
        return min(int(requested), server_max)

    async def reserve(self, *, owner_id: str, request_id: str,
                      max_cost_micros: int, max_tokens: int) -> None:
        doc = {
            "_id": request_id, "owner_id": owner_id,
            "max_cost_micros": int(max_cost_micros), "max_tokens": int(max_tokens),
            "state": "RESERVED", "created_at": _now_ms(),
            "finalized_cost_micros": None, "finalized_tokens": None,
        }
        try:
            await self.db.budget_reservations.insert_one(doc)
        except DuplicateKeyError:
            pass  # idempotent: reservation for this request already exists

    async def finalize(self, *, request_id: str, cost_micros: int, tokens: int,
                       state: str = "FINALIZED") -> None:
        await self.db.budget_reservations.update_one(
            {"_id": request_id},
            {"$set": {"state": state, "finalized_cost_micros": int(cost_micros),
                      "finalized_tokens": int(tokens), "finalized_at": _now_ms()}})

    async def enforce_within(self, *, request_id: str, cost_micros: int, tokens: int) -> None:
        r = await self.db.budget_reservations.find_one({"_id": request_id})
        if not r:
            return
        if cost_micros > r["max_cost_micros"] or tokens > r["max_tokens"]:
            raise GatewayError(GatewayFailure.of(
                GatewayErrorCode.BUDGET_EXHAUSTED,
                "This request exceeded its approved budget and was stopped before extra work.",
                provider_spend_occurred=True, partial_results_available=True))


class RateLimiter:
    """In-memory sliding-window limiter + concurrency guard, keyed per
    (owner, purpose). Deterministic within a process; resets on restart (safe:
    it only ever restricts, never grants)."""

    def __init__(self):
        self._events: Dict[str, list] = {}
        self._active: Dict[str, int] = {}

    def check(self, *, owner_id: str, purpose: str, max_per_window: int,
              window_s: int, max_concurrent: int) -> None:
        now = time.time()
        key = f"{owner_id}:{purpose}"
        bucket = [t for t in self._events.get(key, []) if now - t < window_s]
        if len(bucket) >= max_per_window:
            raise GatewayError(GatewayFailure.of(
                GatewayErrorCode.RATE_LIMITED,
                "You're sending AI requests too quickly. Please wait a moment and try again."))
        if self._active.get(key, 0) >= max_concurrent:
            raise GatewayError(GatewayFailure.of(
                GatewayErrorCode.RATE_LIMITED,
                "Too many AI requests are already running. Please wait for them to finish."))
        bucket.append(now)
        self._events[key] = bucket

    def acquire(self, owner_id: str, purpose: str) -> None:
        key = f"{owner_id}:{purpose}"
        self._active[key] = self._active.get(key, 0) + 1

    def release(self, owner_id: str, purpose: str) -> None:
        key = f"{owner_id}:{purpose}"
        self._active[key] = max(0, self._active.get(key, 0) - 1)
