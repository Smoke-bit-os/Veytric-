"""Iteration-9 Advanced Scan bug-fix pytest suite.

Verifies:
- POST /api/scans persists INSTANTLY (short latency, ai_report="")
- POST /api/scans/{id}/analyze generates non-empty ai_report and persists it
- Second analyze returns cached ai_report (same string)
- GET /api/scans/{id}, DELETE, 401 & 404 boundaries
- Regression across all 6 workflows for instant create
"""
import os
import time
import uuid
import pytest
import requests
from _helpers import seed_session

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "mechanic@jarvis.ai"
TEST_PASSWORD = "Jarvis2026!"

WORKFLOWS = ["full", "quick", "health", "prepurchase", "charging", "cooling"]


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(client):
    _, tok, _ = seed_session("Mechanic")
    return tok


@pytest.fixture
def auth(token):
    return {"Authorization": f"Bearer {token}"}


def _payload(wf="quick"):
    return {
        "workflow": wf,
        "vehicle": "2018 Jeep Wrangler",
        "vin": "1C4HJXEG9JW174532",
        "modules": [{"key": "pcm", "short": "PCM", "status": "online", "dtcCount": 2}],
        "dtcs": [
            {"code": "P0300", "desc": "Random Misfire", "type": "current"},
            {"code": "P0171", "desc": "System Too Lean", "type": "current"},
        ],
        "readiness": [{"key": "misfire", "name": "Misfire", "status": "ready"}],
        "systems": [{"key": "engine", "name": "Engine", "level": "warn", "note": "Misfire"}],
        "metrics": {"dataQuality": 98, "commQuality": "excellent", "supportedPidCount": 42, "retryRate": 0.02},
        "overall_score": 72,
    }


# ---------------------------------------------------------------------------
# Instant persistence (no AI wait) — the primary bug fix
# ---------------------------------------------------------------------------
class TestScanInstantCreate:
    def test_create_returns_quickly_with_empty_ai(self, client, auth):
        t0 = time.time()
        r = client.post(f"{API}/scans", headers=auth, json=_payload("quick"))
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("id")
        # bug-fix contract: ai_report is empty at create time
        assert body.get("ai_report") == ""
        # should be fast — well below the ~10s GPT window that caused the user issue
        assert elapsed < 5.0, f"POST /api/scans took {elapsed:.2f}s (expected <5s, was blocking on GPT)"
        # cleanup
        client.delete(f"{API}/scans/{body['id']}", headers=auth)

    @pytest.mark.parametrize("wf", WORKFLOWS)
    def test_all_workflows_instant(self, client, auth, wf):
        t0 = time.time()
        r = client.post(f"{API}/scans", headers=auth, json=_payload(wf))
        elapsed = time.time() - t0
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["workflow"] == wf
        assert body["ai_report"] == ""
        assert elapsed < 5.0, f"{wf} POST took {elapsed:.2f}s"
        client.delete(f"{API}/scans/{body['id']}", headers=auth)


# ---------------------------------------------------------------------------
# Deferred AI analysis
# ---------------------------------------------------------------------------
class TestAnalyze:
    def test_analyze_generates_and_persists(self, client, auth):
        c = client.post(f"{API}/scans", headers=auth, json=_payload("quick"))
        assert c.status_code == 200
        sid = c.json()["id"]
        try:
            r = client.post(f"{API}/scans/{sid}/analyze", headers=auth, timeout=60)
            assert r.status_code == 200, r.text
            ai = r.json().get("ai_report")
            assert isinstance(ai, str) and len(ai) > 40, f"ai_report too short: {ai!r}"
            # verify persisted via GET
            g = client.get(f"{API}/scans/{sid}", headers=auth)
            assert g.status_code == 200
            assert g.json().get("ai_report") == ai
        finally:
            client.delete(f"{API}/scans/{sid}", headers=auth)

    def test_analyze_returns_cached_on_second_call(self, client, auth):
        c = client.post(f"{API}/scans", headers=auth, json=_payload("health"))
        sid = c.json()["id"]
        try:
            first = client.post(f"{API}/scans/{sid}/analyze", headers=auth, timeout=60).json()["ai_report"]
            t0 = time.time()
            second = client.post(f"{API}/scans/{sid}/analyze", headers=auth, timeout=15).json()["ai_report"]
            elapsed = time.time() - t0
            assert first == second
            # cached path should be near-instant (< 3s)
            assert elapsed < 3.0, f"cached analyze took {elapsed:.2f}s"
        finally:
            client.delete(f"{API}/scans/{sid}", headers=auth)

    def test_analyze_unknown_id_404(self, client, auth):
        r = client.post(f"{API}/scans/{uuid.uuid4()}/analyze", headers=auth)
        assert r.status_code == 404

    def test_analyze_requires_auth(self, client):
        r = client.post(f"{API}/scans/{uuid.uuid4()}/analyze")
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# List / GET / DELETE regression
# ---------------------------------------------------------------------------
class TestScanCrudRegression:
    def test_list_and_get_and_delete(self, client, auth):
        c = client.post(f"{API}/scans", headers=auth, json=_payload("quick"))
        sid = c.json()["id"]

        r = client.get(f"{API}/scans", headers=auth)
        assert r.status_code == 200
        assert any(x["id"] == sid for x in r.json())

        g = client.get(f"{API}/scans/{sid}", headers=auth)
        assert g.status_code == 200
        assert g.json()["id"] == sid

        d = client.delete(f"{API}/scans/{sid}", headers=auth)
        assert d.status_code == 200
        g2 = client.get(f"{API}/scans/{sid}", headers=auth)
        assert g2.status_code == 404

    def test_get_unknown_404(self, client, auth):
        r = client.get(f"{API}/scans/{uuid.uuid4()}", headers=auth)
        assert r.status_code == 404

    def test_list_requires_auth(self, client):
        assert client.get(f"{API}/scans").status_code == 401
