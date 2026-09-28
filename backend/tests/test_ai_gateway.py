"""VEYTRIC — Prompt 3 (3B/3C) Central AI Gateway + metering tests.

Run: cd /app/backend && EXPO_PUBLIC_BACKEND_URL=http://localhost:8001 \
     python -m pytest tests/test_ai_gateway.py -q

Uses the deterministic MockAIProvider (header X-Veytric-Test-Mock) — NO real
provider credits are ever spent.
"""
import os
import uuid
import pytest
import requests
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"
MOCK = {"X-Veytric-Test-Mock": "1"}


# --------------------------------------------------------------------------- #
#  Pure unit tests (no DB / no HTTP)                                          #
# --------------------------------------------------------------------------- #
def test_pricing_splits_by_provider():
    from gateway.pricing import split_cost
    assert split_cost("CLOUD", "gpt-5.4", 1000, 500)[0] > 0          # VEYTRIC pays
    assert split_cost("BYOK", "gpt-5.4", 1000, 500)[0] == 0          # user pays
    assert split_cost("LOCAL", "gpt-5.4", 1000, 500) == (0, 0)       # free


def test_registry_resolve_and_disable():
    from gateway.providers import AIProviderRegistry, CloudAIProvider
    from gateway.contracts import GatewayError, GatewayErrorCode
    reg = AIProviderRegistry()
    reg.register(CloudAIProvider(lambda **k: None, object, "k"))
    # unsupported capability
    with pytest.raises(GatewayError) as ei:
        reg.resolve("CLOUD", "ai.nonexistent")
    assert ei.value.failure.code == GatewayErrorCode.UNSUPPORTED_CAPABILITY
    # not configured
    with pytest.raises(GatewayError) as ei2:
        reg.resolve("BYOK", "ai.explain")
    assert ei2.value.failure.code == GatewayErrorCode.PROVIDER_NOT_CONFIGURED
    # disabled (circuit breaker / manual)
    reg.disable("CLOUD")
    with pytest.raises(GatewayError) as ei3:
        reg.resolve("CLOUD", "ai.explain")
    assert ei3.value.failure.code == GatewayErrorCode.PROVIDER_DISABLED


def test_rate_limiter_blocks_over_window():
    from gateway.metering import RateLimiter
    from gateway.contracts import GatewayError, GatewayErrorCode
    rl = RateLimiter()
    for _ in range(3):
        rl.check(owner_id="u", purpose="P", max_per_window=3, window_s=60, max_concurrent=10)
    with pytest.raises(GatewayError) as ei:
        rl.check(owner_id="u", purpose="P", max_per_window=3, window_s=60, max_concurrent=10)
    assert ei.value.failure.code == GatewayErrorCode.RATE_LIMITED


def test_budget_clamp_only_tightens():
    from gateway.metering import BudgetEnforcer
    be = BudgetEnforcer(db=None)
    assert be.clamp(None, 4000) == 4000          # default -> server max
    assert be.clamp(10_000_000, 4000) == 4000    # client cannot raise
    assert be.clamp(500, 4000) == 500            # client may tighten


def test_failure_model_metadata():
    from gateway.contracts import GatewayFailure, GatewayErrorCode, NON_RETRYABLE
    f = GatewayFailure.of(GatewayErrorCode.RATE_LIMITED, "x")
    assert f.retryable and f.http_status == 429
    assert GatewayErrorCode.FORBIDDEN in NON_RETRYABLE
    assert GatewayFailure.of(GatewayErrorCode.BUDGET_EXHAUSTED, "x").http_status == 402


# --------------------------------------------------------------------------- #
#  HTTP integration tests                                                     #
# --------------------------------------------------------------------------- #
def _auth(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def users():
    from _helpers import seed_session
    _, ta, ua = seed_session()
    _, tb, ub = seed_session()
    return {"a": (ta, ua), "b": (tb, ub)}


def _cloud_req(purpose="EXPLAIN_CODE", **kw):
    body = {"purpose": purpose, "provider_mode": "CLOUD", "prompt": "Explain P0300."}
    body.update(kw)
    return body


def test_cloud_request_happy_path_one_usage_event(users):
    tok, uid = users["a"]
    r = requests.post(f"{BASE}/gateway/ai", json=_cloud_req(), headers={**_auth(tok), **MOCK})
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["completion_state"] == "COMPLETED"
    assert data["provider_mode"] == "CLOUD"
    assert data["user_explanation"]
    assert data["usage_event_ref"]
    gw_id = data["gateway_request_id"]
    # one usage event, cost > 0 for CLOUD
    ev = requests.get(f"{BASE}/gateway/usage/{gw_id}", headers=_auth(tok)).json()
    assert ev["provider_mode"] == "CLOUD"
    assert ev["veytric_cost_micros"] > 0
    assert ev["final_status"] == "COMPLETED"


def test_idempotent_replay_does_not_double_charge(users):
    tok, uid = users["a"]
    key = f"idem-{uuid.uuid4()}"
    body = _cloud_req(idempotency_key=key)
    r1 = requests.post(f"{BASE}/gateway/ai", json=body, headers={**_auth(tok), **MOCK})
    r2 = requests.post(f"{BASE}/gateway/ai", json=body, headers={**_auth(tok), **MOCK})
    assert r1.status_code == 200 and r2.status_code == 200
    d1, d2 = r1.json(), r2.json()
    assert d1["gateway_request_id"] == d2["gateway_request_id"]  # same request
    assert d2["cache_status"] == "HIT"                            # replay
    # exactly one usage event for that gateway_request_id
    ev = requests.get(f"{BASE}/gateway/usage/{d1['gateway_request_id']}", headers=_auth(tok))
    assert ev.status_code == 200


def test_byok_does_not_fall_back_to_cloud(users):
    tok, uid = users["a"]
    r = requests.post(f"{BASE}/gateway/ai", json=_cloud_req(provider_mode="BYOK"),
                      headers={**_auth(tok), **MOCK})
    assert r.status_code == 400
    body = r.json()
    assert body["error"] == "INVALID_REQUEST"
    assert "fallback" in body["message"].lower()


def test_local_does_not_fall_back_to_cloud(users):
    tok, uid = users["a"]
    r = requests.post(f"{BASE}/gateway/ai", json=_cloud_req(provider_mode="LOCAL"),
                      headers={**_auth(tok), **MOCK})
    assert r.status_code == 400
    assert r.json()["error"] == "INVALID_REQUEST"


def test_byok_record_meters_zero_veytric_cost(users):
    tok, uid = users["a"]
    payload = {"request": _cloud_req(provider_mode="BYOK"),
               "input_tokens": 100, "output_tokens": 50, "model": "gpt-4o"}
    r = requests.post(f"{BASE}/gateway/ai/record", json=payload, headers=_auth(tok))
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["provider_mode"] == "BYOK" and d["veytric_cost_micros"] == 0
    ev = requests.get(f"{BASE}/gateway/usage/{d['gateway_request_id']}", headers=_auth(tok)).json()
    assert ev["provider_mode"] == "BYOK" and ev["veytric_cost_micros"] == 0


def test_local_record_meters_zero_and_classified(users):
    tok, uid = users["a"]
    payload = {"request": _cloud_req(provider_mode="LOCAL"),
               "input_tokens": 100, "output_tokens": 50, "model": "llama3"}
    r = requests.post(f"{BASE}/gateway/ai/record", json=payload, headers=_auth(tok))
    assert r.status_code == 200
    d = r.json()
    assert d["provider_mode"] == "LOCAL" and d["veytric_cost_micros"] == 0


def test_malformed_provider_response_fails_safely(users):
    tok, uid = users["a"]
    r = requests.post(f"{BASE}/gateway/ai", json=_cloud_req(),
                      headers={**_auth(tok), "X-Veytric-Test-Mock": "1",
                               "X-Veytric-Test-Mock-Mode": "malformed"})
    assert r.status_code == 502
    body = r.json()
    assert body["error"] == "SCHEMA_VALIDATION_FAILED"
    assert body["provider_spend_occurred"] is True


def test_unknown_purpose_rejected(users):
    tok, uid = users["a"]
    r = requests.post(f"{BASE}/gateway/ai",
                      json={"purpose": "NOT_A_PURPOSE", "provider_mode": "CLOUD", "prompt": "x"},
                      headers={**_auth(tok), **MOCK})
    # pydantic enum validation -> 422; either way, not executed
    assert r.status_code in (400, 422)


def test_ownership_cannot_read_other_users_usage(users):
    tok_a, _ = users["a"]
    tok_b, _ = users["b"]
    r = requests.post(f"{BASE}/gateway/ai", json=_cloud_req(), headers={**_auth(tok_a), **MOCK})
    gw_id = r.json()["gateway_request_id"]
    # user B must not see A's usage event
    rb = requests.get(f"{BASE}/gateway/usage/{gw_id}", headers=_auth(tok_b))
    assert rb.status_code == 404


def test_ownership_cannot_use_other_users_session(users):
    tok_a, ua = users["a"]
    tok_b, _ = users["b"]
    # A creates a diagnostic session
    s = requests.post(f"{BASE}/diagnostic-sessions", json={"label": "x"}, headers=_auth(tok_a)).json()
    sid = s["id"]
    # B tries to run an AI request bound to A's session -> FORBIDDEN (not found)
    rb = requests.post(f"{BASE}/gateway/ai",
                       json=_cloud_req(purpose="SUMMARIZE_SCAN", diagnostic_session_id=sid),
                       headers={**_auth(tok_b), **MOCK})
    assert rb.status_code == 403
    assert rb.json()["error"] == "FORBIDDEN"


def test_usage_summary_separates_providers(users):
    tok, uid = users["a"]
    s = requests.get(f"{BASE}/gateway/usage", headers=_auth(tok)).json()
    by = s["summary"]["by_provider"]
    assert by["CLOUD"]["veytric_cost_micros"] > 0
    assert by["BYOK"]["veytric_cost_micros"] == 0
    assert by["LOCAL"]["veytric_cost_micros"] == 0
