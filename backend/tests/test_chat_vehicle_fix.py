"""
Iteration 13 — Verify ChatInput.vehicle Optional[Any] fix.

Confirms:
- POST /api/chat with `vehicle` as STRING (platformSummary style) returns 200 (was 422)
- POST /api/chat with `vehicle` as None returns 200
- POST /api/chat with `vehicle` omitted returns 200
- Regression: Free monthly Cloud quota still enforces -> 429 cloud_quota_exceeded
- Sanity: /api/ai/analyze and /api/dtc/analyze return 200 under quota
"""
import os
import time
import uuid
from datetime import datetime, timezone

import pytest
import requests
from _helpers import seed_session
from pymongo import MongoClient

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") \
    if os.environ.get("EXPO_PUBLIC_BACKEND_URL") \
    else "https://jarvis-ai-1486.preview.emergentagent.com"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _register(api):
    email, token, uid = seed_session("T")
    return token, uid, email


@pytest.fixture(scope="module")
def user_a(api):
    """User for happy-path chat tests (kept under quota)."""
    token, uid, email = _register(api)
    return {"token": token, "id": uid, "email": email,
            "headers": {"Authorization": f"Bearer {token}",
                        "Content-Type": "application/json"}}


@pytest.fixture(scope="module")
def user_b(api):
    """User for quota-exhaust regression test."""
    token, uid, email = _register(api)
    return {"token": token, "id": uid, "email": email,
            "headers": {"Authorization": f"Bearer {token}",
                        "Content-Type": "application/json"}}


# ---------- BUG FIX: ChatInput.vehicle Optional[Any] ----------
class TestChatVehicleContract:

    def test_chat_with_vehicle_as_string(self, api, user_a):
        payload = {
            "message": "What could cause a rough idle?",
            "session_id": f"s-{uuid.uuid4().hex[:8]}",
            "vehicle": "2018 Jeep Wrangler 3.6L V6",
            "telemetry": {"rpm": 780, "coolant": 92},
        }
        r = api.post(f"{BASE_URL}/api/chat", json=payload, headers=user_a["headers"])
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        body = r.json()
        assert "reply" in body and isinstance(body["reply"], str) and body["reply"].strip()

    def test_chat_with_vehicle_none(self, api, user_a):
        payload = {
            "message": "Hi",
            "session_id": f"s-{uuid.uuid4().hex[:8]}",
            "vehicle": None,
        }
        r = api.post(f"{BASE_URL}/api/chat", json=payload, headers=user_a["headers"])
        assert r.status_code == 200, r.text
        assert "reply" in r.json()

    def test_chat_with_vehicle_omitted(self, api, user_a):
        payload = {
            "message": "Hello",
            "session_id": f"s-{uuid.uuid4().hex[:8]}",
        }
        r = api.post(f"{BASE_URL}/api/chat", json=payload, headers=user_a["headers"])
        assert r.status_code == 200, r.text
        assert "reply" in r.json()

    def test_chat_with_vehicle_as_dict_still_works(self, api, user_a):
        payload = {
            "message": "Diagnose",
            "session_id": f"s-{uuid.uuid4().hex[:8]}",
            "vehicle": {"make": "Jeep", "model": "Wrangler", "year": 2018},
        }
        r = api.post(f"{BASE_URL}/api/chat", json=payload, headers=user_a["headers"])
        assert r.status_code == 200, r.text


# ---------- Regression: Free quota still enforces ----------
class TestFreeQuotaRegression:

    def test_quota_enforced_after_seed(self, api, user_b):
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        client = MongoClient(MONGO_URL)
        db = client[DB_NAME]
        # Seed usage to 20 for this user + current month
        db.ai_usage.update_one(
            {"user_id": user_b["id"], "month": month, "provider": "cloud"},
            {"$set": {"user_id": user_b["id"], "month": month,
                      "provider": "cloud", "requests_used": 20}},
            upsert=True,
        )
        client.close()
        time.sleep(0.3)

        r = api.post(f"{BASE_URL}/api/chat",
                     json={"message": "quota check",
                           "session_id": "s-quota",
                           "vehicle": "2018 Jeep Wrangler"},
                     headers=user_b["headers"])
        assert r.status_code == 429, f"Expected 429, got {r.status_code}: {r.text}"
        detail = r.json().get("detail", {})
        # HTTPException may serialize detail as dict or object
        code = detail.get("code") if isinstance(detail, dict) else None
        assert code == "cloud_quota_exceeded", f"Expected code cloud_quota_exceeded, got {detail}"


# ---------- Sanity: other AI endpoints still work ----------
class TestOtherAIEndpoints:

    def test_ai_analyze_ok(self, api, user_a):
        r = api.post(f"{BASE_URL}/api/ai/analyze",
                     json={"prompt": "Explain rough idle briefly",
                           "vehicle": "2018 Jeep Wrangler",
                           "telemetry": {"rpm": 800, "coolant": 90}},
                     headers=user_a["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body, dict) and body

    def test_dtc_analyze_ok(self, api, user_a):
        r = api.post(f"{BASE_URL}/api/dtc/analyze",
                     json={"code": "P0300",
                           "vehicle": "2018 Jeep Wrangler"},
                     headers=user_a["headers"])
        assert r.status_code == 200, r.text
        assert isinstance(r.json(), dict)
