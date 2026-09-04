"""
Backend tests for the new AI provider system.

Focus:
  - POST /api/ai/analyze (JARVIS Cloud provider backend)
  - Regression: /api/chat, /api/dtc/analyze, /api/subscription still work.

Auth: registers a fresh TEST_ user per session, uses returned JWT.
"""
import os
import time
import uuid
import pytest
import requests
from _helpers import seed_session

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://jarvis-ai-1486.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# ------------------------------ fixtures ------------------------------
@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def user_token(client):
    _, token, _ = seed_session("AI Tester")
    return token


@pytest.fixture
def auth(user_token):
    return {"Authorization": f"Bearer {user_token}"}


# ============================================================
#  POST /api/ai/analyze
# ============================================================
class TestAIAnalyze:
    def test_no_auth_returns_401(self, client):
        r = client.post(f"{API}/ai/analyze", json={"prompt": "hi"})
        assert r.status_code in (401, 403), f"expected 401/403, got {r.status_code} {r.text}"

    def test_minimal_prompt_ok(self, client, auth):
        r = client.post(
            f"{API}/ai/analyze",
            json={"prompt": "In one short sentence: what does DTC P0300 usually indicate?"},
            headers=auth,
            timeout=60,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert "text" in body and isinstance(body["text"], str) and len(body["text"]) > 0
        assert "model" in body and isinstance(body["model"], str) and len(body["model"]) > 0

    def test_full_context_ok(self, client, auth):
        payload = {
            "prompt": "Given the DTCs and RPM, is this likely a misfire? Reply in <=2 sentences.",
            "vehicle": {"year": 2018, "make": "Toyota", "model": "Camry", "engine": "2.5L I4"},
            "telemetry": {"rpm": 780, "coolantC": 92, "shortFuelTrim": 12.5},
            "diagnostics": {"dtcs": ["P0300", "P0171"], "healthScore": 62},
            "history": [
                {"role": "user", "content": "Rough idle after start."},
                {"role": "assistant", "content": "Noted; will check fuel trims."},
            ],
        }
        r = client.post(f"{API}/ai/analyze", json=payload, headers=auth, timeout=90)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body["text"], "expected non-empty text"
        assert body["model"], "expected model string"

    def test_long_prompt_ok(self, client, auth):
        long_prompt = ("Explain in 1 sentence. " + "OBD sensor variance. ") * 40
        r = client.post(
            f"{API}/ai/analyze",
            json={"prompt": long_prompt},
            headers=auth,
            timeout=90,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        assert r.json().get("text")

    def test_missing_prompt_field_returns_422(self, client, auth):
        r = client.post(f"{API}/ai/analyze", json={}, headers=auth)
        assert r.status_code == 422, f"expected 422 for missing prompt, got {r.status_code}"


# ============================================================
#  Regression: /api/chat still works
# ============================================================
class TestChatRegression:
    def test_chat_requires_auth(self, client):
        r = client.post(f"{API}/chat", json={"message": "hi"})
        assert r.status_code in (401, 403)

    def test_chat_returns_reply_and_persists(self, client, auth):
        sid = f"TEST_ai_sess_{uuid.uuid4().hex[:8]}"
        r = client.post(
            f"{API}/chat",
            json={"message": "What is OBD-II PID 0C?", "session_id": sid},
            headers=auth,
            timeout=60,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert "reply" in body and isinstance(body["reply"], str) and body["reply"].strip()

        # History persists — /api/chat/history/{session_id}
        r2 = client.get(f"{API}/chat/history/{sid}", headers=auth)
        assert r2.status_code == 200, f"history {r2.status_code} {r2.text}"
        hist = r2.json()
        assert isinstance(hist, list) and len(hist) >= 2  # user + assistant


# ============================================================
#  Regression: /api/dtc/analyze
# ============================================================
class TestDTCAnalyzeRegression:
    def test_requires_auth(self, client):
        r = client.post(f"{API}/dtc/analyze", json={"code": "P0300"})
        assert r.status_code in (401, 403)

    def test_analyze_returns_result(self, client, auth):
        r = client.post(
            f"{API}/dtc/analyze",
            json={"code": "P0300", "desc": "Random misfire detected"},
            headers=auth,
            timeout=90,
        )
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert body.get("code") == "P0300"
        assert isinstance(body.get("analysis"), str) and body["analysis"].strip()


# ============================================================
#  Regression: /api/subscription
# ============================================================
class TestSubscriptionRegression:
    def test_requires_auth(self, client):
        r = client.get(f"{API}/subscription")
        assert r.status_code in (401, 403)

    def test_returns_entitlement(self, client, auth):
        r = client.get(f"{API}/subscription", headers=auth)
        assert r.status_code == 200, f"{r.status_code} {r.text}"
        body = r.json()
        assert "entitlement" in body
        ent = body["entitlement"]
        for k in ("tier", "status"):
            assert k in ent, f"missing {k} in entitlement: {ent}"
        assert body.get("env") in ("development", "production", "staging", None) or isinstance(body.get("env"), str)
        assert isinstance(body.get("trialDays"), int)
        assert isinstance(body.get("graceDays"), int)
