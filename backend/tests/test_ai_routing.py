"""JARVIS AI — 'Route All AI to your key' provider-aware routing tests.

Verifies for every heavy AI endpoint:
  - `?prepare=true` returns {system, prompt} and does NOT consume the Cloud
    monthly quota.
  - The plain Cloud path DOES consume exactly 1 quota per call.
  - Dedicated BYOK/Local save endpoints persist provider metadata & text
    WITHOUT consuming quota (and continue to work when quota is exhausted).
  - Quota exhaustion (seed 20/20) returns 429 detail.code=cloud_quota_exceeded
    ONLY for the actual Cloud LLM branch — prepare + save endpoints keep
    working (this is the acceptance test for BYOK/Local with 0 free quota).
  - All these endpoints require a valid token (401 without).
"""
import os
import uuid
import asyncio
import pytest
import requests
from _helpers import seed_session
from motor.motor_asyncio import AsyncIOMotorClient

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://jarvis-ai-1486.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


def _fresh_email(tag: str) -> str:
    return f"TEST_{tag}_{uuid.uuid4().hex[:8]}@jarvis.ai"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _register(client, tag: str):
    email, token, uid = seed_session(tag)
    return token, uid, email


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def _usage(client, token):
    r = client.get(f"{API}/ai/usage", headers=_auth(token), timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["requests_used"]


def _month_key_now():
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    return f"{now.year:04d}-{now.month:02d}"


def _seed_quota_max(user_id: str, used: int = 20):
    """Directly seed db.ai_usage requests_used=used for current month."""
    async def _do():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        await db.ai_usage.update_one(
            {"user_id": user_id, "month": _month_key_now()},
            {"$set": {"requests_used": used, "provider": "cloud"}},
            upsert=True,
        )
        cli.close()
    asyncio.run(_do())


# --------------------------- Vehicle / scan / recording seed helpers -------
def _make_vehicle(client, token) -> str:
    r = client.post(f"{API}/vehicles", json={
        "name": f"TEST_HR_{uuid.uuid4().hex[:6]}",
        "make": "Jeep", "model": "Wrangler", "year": 2018, "engine": "3.6L V6",
        "mileage": 68210, "vin": "1C4HJXEG9JW174532",
    }, headers=_auth(token), timeout=30)
    assert r.status_code == 200, r.text
    vid = r.json()["id"]
    client.post(f"{API}/vehicles/{vid}/health", json={"score": 78}, headers=_auth(token))
    return vid


def _make_scan(client, token, vehicle_id: str) -> str:
    payload = {
        "vehicle_id": vehicle_id, "vehicle": "2018 Jeep Wrangler",
        "workflow": "quick",
        "dtcs": [{"code": "P0300", "desc": "Random misfire", "type": "confirmed"}],
        "readiness": [], "modules": [], "systems": [],
        "metrics": {"rpm": 780}, "overall_score": 78,
    }
    r = client.post(f"{API}/scans", json=payload, headers=_auth(token), timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _make_recording(client, token, vehicle_id: str, user_id: str) -> str:
    """Insert a recording directly for the given user_id (no public POST endpoint)."""
    async def _do():
        cli = AsyncIOMotorClient(MONGO_URL)
        db = cli[DB_NAME]
        rid = str(uuid.uuid4())
        await db.recordings.insert_one({
            "_id": rid,
            "user_id": user_id,
            "vehicle_id": vehicle_id, "vin": "1C4HJXEG9JW174532",
            "name": "TEST session", "summary": {"avgRpm": 900},
            "duration": 300, "distance": 8.2, "events": [], "samples": [],
            "created_at": "2026-01-01T00:00:00Z",
        })
        cli.close()
        return rid
    return asyncio.run(_do())


# ==========================================================================
#                       AUTH-REQUIRED (401 without token)
# ==========================================================================
class TestAuthRequired:
    def test_dtc_analyze_401(self, client):
        assert client.post(f"{API}/dtc/analyze", json={"code": "P0300"}).status_code == 401

    def test_scan_analyze_401(self, client):
        assert client.post(f"{API}/scans/any/analyze").status_code == 401

    def test_health_report_401(self, client):
        assert client.post(f"{API}/vehicles/any/health-report").status_code == 401

    def test_trends_explain_401(self, client):
        assert client.post(f"{API}/vehicles/any/trends/explain").status_code == 401

    def test_recording_analyze_401(self, client):
        assert client.post(f"{API}/recordings/any/analyze").status_code == 401

    def test_diag_interpret_401(self, client):
        assert client.post(f"{API}/diagnostics/interpret", json={"kind": "system", "title": "x"}).status_code == 401

    def test_reports_create_401(self, client):
        assert client.post(f"{API}/reports", json={"vehicle": ""}).status_code == 401

    def test_save_ai_401(self, client):
        assert client.post(f"{API}/scans/any/save-ai", json={"ai_report": "x"}).status_code == 401
        assert client.post(f"{API}/recordings/any/save-analysis", json={"analysis": "x"}).status_code == 401
        assert client.post(f"{API}/vehicles/any/health-report/save", json={"report": "x"}).status_code == 401


# ==========================================================================
#                       PREPARE=TRUE → NO QUOTA CONSUMED
# ==========================================================================
class TestPrepareNoQuota:
    @pytest.fixture(scope="class")
    def ctx(self, client):
        token, uid, _ = _register(client, "prep")
        vid = _make_vehicle(client, token)
        sid = _make_scan(client, token, vid)
        rid = _make_recording(client, token, vid, uid)
        return {"token": token, "uid": uid, "vid": vid, "sid": sid, "rid": rid}

    def _assert_prepare(self, r):
        assert r.status_code == 200, r.text
        b = r.json()
        assert "system" in b and "prompt" in b
        assert isinstance(b["system"], str) and len(b["system"]) > 5
        assert isinstance(b["prompt"], str) and len(b["prompt"]) > 20

    def test_dtc_prepare_no_quota(self, client, ctx):
        before = _usage(client, ctx["token"])
        r = client.post(f"{API}/dtc/analyze?prepare=true",
                        json={"code": "P0300", "desc": "misfire",
                              "vehicle": {"year": 2018, "make": "Jeep"},
                              "telemetry": {"rpm": 780}},
                        headers=_auth(ctx["token"]), timeout=15)
        self._assert_prepare(r)
        assert _usage(client, ctx["token"]) == before

    def test_scan_prepare_no_quota(self, client, ctx):
        before = _usage(client, ctx["token"])
        r = client.post(f"{API}/scans/{ctx['sid']}/analyze?prepare=true",
                        headers=_auth(ctx["token"]), timeout=15)
        self._assert_prepare(r)
        assert _usage(client, ctx["token"]) == before

    def test_health_report_prepare_no_quota(self, client, ctx):
        before = _usage(client, ctx["token"])
        r = client.post(f"{API}/vehicles/{ctx['vid']}/health-report?prepare=true",
                        headers=_auth(ctx["token"]), timeout=15)
        self._assert_prepare(r)
        assert _usage(client, ctx["token"]) == before

    def test_trends_explain_prepare_no_quota(self, client, ctx):
        before = _usage(client, ctx["token"])
        r = client.post(f"{API}/vehicles/{ctx['vid']}/trends/explain?prepare=true",
                        headers=_auth(ctx["token"]), timeout=15)
        # Trends may return 200 either with {system,prompt} OR {explanation}
        # (when there is not enough historical data). Both must NOT consume quota.
        assert r.status_code == 200, r.text
        body = r.json()
        assert ("prompt" in body and "system" in body) or "explanation" in body
        assert _usage(client, ctx["token"]) == before

    def test_recording_prepare_no_quota(self, client, ctx):
        before = _usage(client, ctx["token"])
        r = client.post(f"{API}/recordings/{ctx['rid']}/analyze?prepare=true",
                        headers=_auth(ctx["token"]), timeout=15)
        self._assert_prepare(r)
        assert _usage(client, ctx["token"]) == before

    def test_interpret_prepare_no_quota(self, client, ctx):
        before = _usage(client, ctx["token"])
        r = client.post(f"{API}/diagnostics/interpret?prepare=true",
                        json={"kind": "system", "title": "Cooling",
                              "vehicle": "2018 Jeep Wrangler",
                              "context": {"coolant_c": 92}},
                        headers=_auth(ctx["token"]), timeout=15)
        self._assert_prepare(r)
        assert _usage(client, ctx["token"]) == before

    def test_reports_prepare_no_quota(self, client, ctx):
        before = _usage(client, ctx["token"])
        r = client.post(f"{API}/reports?prepare=true",
                        json={"vehicle": "2018 Jeep Wrangler",
                              "dtcs": [{"code": "P0300", "desc": "misfire", "type": "confirmed"}],
                              "signals_summary": {"rpm": 780},
                              "health_score": 78},
                        headers=_auth(ctx["token"]), timeout=15)
        self._assert_prepare(r)
        assert _usage(client, ctx["token"]) == before


# ==========================================================================
#           CLOUD (no prepare) CONSUMES QUOTA + PERSISTS AI + PROVIDER
# ==========================================================================
class TestCloudConsumesQuota:
    @pytest.fixture(scope="class")
    def ctx(self, client):
        token, uid, _ = _register(client, "cloud")
        vid = _make_vehicle(client, token)
        sid = _make_scan(client, token, vid)
        return {"token": token, "uid": uid, "vid": vid, "sid": sid}

    def test_dtc_cloud_consumes_one(self, client, ctx):
        before = _usage(client, ctx["token"])
        r = client.post(f"{API}/dtc/analyze",
                        json={"code": "P0300", "desc": "misfire",
                              "vehicle": {"year": 2018, "make": "Jeep"},
                              "telemetry": {"rpm": 780}},
                        headers=_auth(ctx["token"]), timeout=120)
        assert r.status_code == 200, r.text
        assert len(r.json()["analysis"]) > 20
        assert _usage(client, ctx["token"]) == before + 1

    def test_reports_cloud_consumes_one_and_stores_provider(self, client, ctx):
        before = _usage(client, ctx["token"])
        r = client.post(f"{API}/reports",
                        json={"vehicle": "2018 Jeep Wrangler",
                              "dtcs": [{"code": "P0300", "desc": "misfire", "type": "confirmed"}],
                              "signals_summary": {"rpm": 780},
                              "health_score": 78},
                        headers=_auth(ctx["token"]), timeout=120)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("ai_provider") == "cloud"
        assert isinstance(body.get("ai_findings"), str) and len(body["ai_findings"]) > 10
        assert _usage(client, ctx["token"]) == before + 1

    def test_scan_cloud_consumes_one_and_persists(self, client, ctx):
        before = _usage(client, ctx["token"])
        r = client.post(f"{API}/scans/{ctx['sid']}/analyze",
                        headers=_auth(ctx["token"]), timeout=120)
        assert r.status_code == 200, r.text
        assert len(r.json()["ai_report"]) > 20
        assert _usage(client, ctx["token"]) == before + 1
        # Verify persisted with provider=cloud
        g = client.get(f"{API}/scans/{ctx['sid']}", headers=_auth(ctx["token"]), timeout=15)
        assert g.status_code == 200
        assert g.json().get("ai_provider") == "cloud"

    def test_interpret_cloud_consumes_one(self, client, ctx):
        before = _usage(client, ctx["token"])
        r = client.post(f"{API}/diagnostics/interpret",
                        json={"kind": "system", "title": "Cooling",
                              "vehicle": "2018 Jeep Wrangler",
                              "context": {"coolant_c": 92}},
                        headers=_auth(ctx["token"]), timeout=120)
        assert r.status_code == 200, r.text
        assert len(r.json()["interpretation"]) > 20
        assert _usage(client, ctx["token"]) == before + 1


# ==========================================================================
#            BYOK/LOCAL SAVE ENDPOINTS — NO QUOTA, PROVIDER METADATA
# ==========================================================================
class TestSaveEndpoints:
    @pytest.fixture(scope="class")
    def ctx(self, client):
        token, uid, _ = _register(client, "save")
        vid = _make_vehicle(client, token)
        sid = _make_scan(client, token, vid)
        rid = _make_recording(client, token, vid, uid)
        return {"token": token, "uid": uid, "vid": vid, "sid": sid, "rid": rid}

    def test_save_scan_ai_no_quota(self, client, ctx):
        before = _usage(client, ctx["token"])
        r = client.post(f"{API}/scans/{ctx['sid']}/save-ai",
                        json={"ai_report": "BYOK generated scan report body.",
                              "provider": "byok", "model": "gpt-4o"},
                        headers=_auth(ctx["token"]), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["provider"] == "byok"
        assert _usage(client, ctx["token"]) == before

        # GET scan and confirm persisted
        g = client.get(f"{API}/scans/{ctx['sid']}", headers=_auth(ctx["token"]))
        assert g.status_code == 200
        b = g.json()
        assert b["ai_report"] == "BYOK generated scan report body."
        assert b["ai_provider"] == "byok"

    def test_save_recording_analysis_no_quota(self, client, ctx):
        before = _usage(client, ctx["token"])
        r = client.post(f"{API}/recordings/{ctx['rid']}/save-analysis",
                        json={"analysis": "Local Ollama recording analysis.",
                              "provider": "local", "model": "llama3.1"},
                        headers=_auth(ctx["token"]), timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["provider"] == "local"
        assert _usage(client, ctx["token"]) == before

    def test_save_health_report_no_quota_and_provider(self, client, ctx):
        before = _usage(client, ctx["token"])
        r = client.post(f"{API}/vehicles/{ctx['vid']}/health-report/save",
                        json={"report": "BYOK generated health report full text.",
                              "provider": "byok", "model": "gpt-4o"},
                        headers=_auth(ctx["token"]), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ai_provider"] == "byok"
        assert body["ai_model"] == "gpt-4o"
        assert body["report"] == "BYOK generated health report full text."
        # Server-recomputed heuristics must be present
        assert "predictions" in body and "trends" in body
        assert _usage(client, ctx["token"]) == before

        # GET latest health report
        g = client.get(f"{API}/vehicles/{ctx['vid']}/health-report",
                       headers=_auth(ctx["token"]), timeout=15)
        assert g.status_code == 200
        gg = g.json()
        assert gg.get("report") == "BYOK generated health report full text."
        assert gg.get("ai_provider") == "byok"

    def test_reports_ai_findings_no_quota_and_provider(self, client, ctx):
        before = _usage(client, ctx["token"])
        r = client.post(f"{API}/reports",
                        json={"vehicle": "2018 Jeep Wrangler",
                              "dtcs": [{"code": "P0300", "desc": "misfire", "type": "confirmed"}],
                              "signals_summary": {"rpm": 780},
                              "health_score": 78,
                              "ai_findings": "BYOK-generated findings body.",
                              "ai_provider": "byok",
                              "ai_model": "gpt-4o"},
                        headers=_auth(ctx["token"]), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ai_findings"] == "BYOK-generated findings body."
        assert body["ai_provider"] == "byok"
        assert body.get("ai_model") == "gpt-4o"
        assert _usage(client, ctx["token"]) == before


# ==========================================================================
#     QUOTA-EXHAUSTED REGRESSION: cloud=429, prepare=200, save=200 (BYOK OK)
# ==========================================================================
class TestQuotaExhausted:
    @pytest.fixture(scope="class")
    def ctx(self, client):
        token, uid, _ = _register(client, "cap")
        vid = _make_vehicle(client, token)
        sid = _make_scan(client, token, vid)
        rid = _make_recording(client, token, vid, uid)
        _seed_quota_max(uid, used=20)
        return {"token": token, "uid": uid, "vid": vid, "sid": sid, "rid": rid}

    def test_usage_shows_exhausted(self, client, ctx):
        r = client.get(f"{API}/ai/usage", headers=_auth(ctx["token"]))
        assert r.status_code == 200
        body = r.json()
        assert body["requests_used"] == 20
        assert body["remaining"] == 0

    def test_dtc_cloud_429(self, client, ctx):
        r = client.post(f"{API}/dtc/analyze",
                        json={"code": "P0300"},
                        headers=_auth(ctx["token"]), timeout=15)
        assert r.status_code == 429, r.text
        det = r.json().get("detail") or {}
        assert (det.get("code") if isinstance(det, dict) else None) == "cloud_quota_exceeded"

    def test_reports_cloud_429(self, client, ctx):
        r = client.post(f"{API}/reports",
                        json={"vehicle": "x", "dtcs": [], "signals_summary": {}, "health_score": 50},
                        headers=_auth(ctx["token"]), timeout=15)
        assert r.status_code == 429, r.text
        det = r.json().get("detail") or {}
        assert (det.get("code") if isinstance(det, dict) else None) == "cloud_quota_exceeded"

    def test_scan_cloud_429(self, client, ctx):
        r = client.post(f"{API}/scans/{ctx['sid']}/analyze",
                        headers=_auth(ctx["token"]), timeout=15)
        assert r.status_code == 429, r.text

    def test_health_report_cloud_429(self, client, ctx):
        r = client.post(f"{API}/vehicles/{ctx['vid']}/health-report",
                        headers=_auth(ctx["token"]), timeout=15)
        assert r.status_code == 429, r.text

    def test_interpret_cloud_429(self, client, ctx):
        r = client.post(f"{API}/diagnostics/interpret",
                        json={"kind": "system", "title": "Cooling",
                              "vehicle": "x", "context": {"coolant_c": 90}},
                        headers=_auth(ctx["token"]), timeout=15)
        assert r.status_code == 429, r.text

    # ---- Acceptance tests 4 & 5: BYOK/Local still works with quota=exhausted --

    def test_prepare_still_works_at_quota_zero(self, client, ctx):
        r = client.post(f"{API}/dtc/analyze?prepare=true",
                        json={"code": "P0300",
                              "vehicle": {"year": 2018, "make": "Jeep"},
                              "telemetry": {"rpm": 780}},
                        headers=_auth(ctx["token"]), timeout=15)
        assert r.status_code == 200, r.text
        b = r.json()
        assert "system" in b and "prompt" in b

    def test_scan_prepare_still_works_at_quota_zero(self, client, ctx):
        r = client.post(f"{API}/scans/{ctx['sid']}/analyze?prepare=true",
                        headers=_auth(ctx["token"]), timeout=15)
        assert r.status_code == 200, r.text
        assert "prompt" in r.json()

    def test_reports_prepare_still_works_at_quota_zero(self, client, ctx):
        r = client.post(f"{API}/reports?prepare=true",
                        json={"vehicle": "x", "dtcs": [], "signals_summary": {}, "health_score": 50},
                        headers=_auth(ctx["token"]), timeout=15)
        assert r.status_code == 200, r.text
        assert "prompt" in r.json()

    def test_save_scan_ai_still_works_at_quota_zero(self, client, ctx):
        r = client.post(f"{API}/scans/{ctx['sid']}/save-ai",
                        json={"ai_report": "BYOK save at 20/20", "provider": "byok"},
                        headers=_auth(ctx["token"]), timeout=15)
        assert r.status_code == 200, r.text
        # quota must still be exactly 20
        assert _usage(client, ctx["token"]) == 20

    def test_save_recording_analysis_still_works_at_quota_zero(self, client, ctx):
        r = client.post(f"{API}/recordings/{ctx['rid']}/save-analysis",
                        json={"analysis": "Local at 20/20", "provider": "local"},
                        headers=_auth(ctx["token"]), timeout=15)
        assert r.status_code == 200, r.text
        assert _usage(client, ctx["token"]) == 20

    def test_save_health_report_still_works_at_quota_zero(self, client, ctx):
        r = client.post(f"{API}/vehicles/{ctx['vid']}/health-report/save",
                        json={"report": "BYOK HR at 20/20", "provider": "byok"},
                        headers=_auth(ctx["token"]), timeout=30)
        assert r.status_code == 200, r.text
        assert _usage(client, ctx["token"]) == 20

    def test_reports_ai_findings_still_works_at_quota_zero(self, client, ctx):
        r = client.post(f"{API}/reports",
                        json={"vehicle": "x", "dtcs": [], "signals_summary": {},
                              "health_score": 50,
                              "ai_findings": "BYOK findings at 20/20",
                              "ai_provider": "byok"},
                        headers=_auth(ctx["token"]), timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ai_findings"] == "BYOK findings at 20/20"
        assert body["ai_provider"] == "byok"
        assert _usage(client, ctx["token"]) == 20
