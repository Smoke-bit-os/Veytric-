"""
Backend tests for Phase 1 increment:
- POST /api/subscription/developer/set guard exists (blocks non-development APP_ENV -> 403).
  In THIS preview APP_ENV=development so the endpoint responds 200; verify the code path is
  reachable and the guard block only fails when APP_ENV != development (guard is present in code).
- Auth register/login sanity for the JWT flow used by Guided Repairs.
- AI endpoint used by Guided Repairs (POST /api/ai/analyze) returns a text body when authed.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://jarvis-ai-1486.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def user_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"gr_{uuid.uuid4().hex[:10]}@example.com"
    r = s.post(f"{API}/auth/register", json={"name": "GR Tester", "email": email, "password": "Jarvis2026!"})
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    body = r.json()
    tok = body.get("token") or body.get("access_token")
    assert tok, f"No token in register response: {body}"
    s.headers.update({"Authorization": f"Bearer {tok}"})
    return s, email


# ---- Security: dev endpoint guard ----
class TestDevEndpointGuard:
    def test_endpoint_exists_and_authed(self, user_session):
        s, _ = user_session
        # In THIS preview APP_ENV=development, so the endpoint should NOT be 403.
        r = s.post(f"{API}/subscription/developer/set", json={"action": "free"})
        # Guard is APP_ENV != 'development' -> 403. Here dev -> 200.
        assert r.status_code == 200, f"expected 200 in dev preview, got {r.status_code}: {r.text}"

    def test_requires_auth(self):
        # Anonymous -> 401 or 403 (must not silently succeed)
        r = requests.post(f"{API}/subscription/developer/set", json={"action": "pro"})
        assert r.status_code in (401, 403), f"anon must be rejected, got {r.status_code}"

    def test_guard_present_in_source(self):
        """Static check: confirm the APP_ENV != development guard exists in server.py."""
        with open("/app/backend/server.py", "r") as f:
            src = f.read()
        assert 'APP_ENV != "development"' in src, "Guard string not found in server.py"
        # Confirm it is in the developer_set handler
        assert '/subscription/developer/set' in src


# ---- Auth (used by Guided Repair via useAI/session token) ----
class TestAuthBasics:
    def test_register_login_roundtrip(self):
        email = f"gr2_{uuid.uuid4().hex[:10]}@example.com"
        r = requests.post(f"{API}/auth/register", json={"name": "X", "email": email, "password": "Jarvis2026!"})
        assert r.status_code == 200, r.text
        r2 = requests.post(f"{API}/auth/login", json={"email": email, "password": "Jarvis2026!"})
        assert r2.status_code == 200, r2.text
        assert (r2.json().get("token") or r2.json().get("access_token"))


# ---- AI Analyze used by Guided Repair ----
class TestAIAnalyzeForGuidedRepair:
    def test_ai_analyze_returns_text(self, user_session):
        s, _ = user_session
        prompt = "Trouble code P0300 — Misfire on a 2018 Honda Civic. Give a very short summary."
        r = s.post(f"{API}/ai/analyze", json={"prompt": prompt})
        # Endpoint may be /ai/analyze; if 404 fall back to alternate names
        if r.status_code == 404:
            for alt in ("/ai/chat", "/ai"):
                r = s.post(f"{API}{alt}", json={"prompt": prompt})
                if r.status_code != 404:
                    break
        assert r.status_code == 200, f"AI analyze failed: {r.status_code} {r.text[:300]}"
        body = r.json()
        # Accept various response shapes
        text = body.get("text") or body.get("output") or body.get("response") or body.get("content")
        assert text, f"No text in AI response: {body}"
        assert isinstance(text, str) and len(text) > 5
