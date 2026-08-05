"""Advanced Diagnostics & ECU Intelligence — pytest suite (iter-8).

Covers:
- POST /api/diagnostics/interpret (kind=system|module)
- POST /api/scans (all 6 workflows) — persists doc with ai_report
- GET  /api/scans and ?vehicle_id= (excludes modules/systems)
- GET  /api/scans/{id} — full incl modules/systems
- DELETE /api/scans/{id}
- Auth guards (401 without token) and 404 for missing scan
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "mechanic@jarvis.ai"
TEST_PASSWORD = "Jarvis2026!"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(client):
    r = client.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    if r.status_code == 200:
        return r.json()["token"]
    r = client.post(f"{API}/auth/register", json={"name": "Mechanic", "email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---------- payload builders ----------
def _sample_modules():
    return [
        {"key": "pcm", "name": "PCM", "status": "ONLINE", "score": 82, "commRate": 98, "dtcs": ["P0300", "P0171"], "functions": ["Fuel Trim", "Ignition"], "issues": {"active": ["P0300"], "historical": []}},
        {"key": "tcm", "name": "TCM", "status": "NO-RESP", "score": 0, "commRate": 0, "dtcs": [], "functions": ["Shift"], "issues": {"active": [], "historical": ["P0700"]}},
    ]

def _sample_dtcs():
    return [
        {"code": "P0300", "desc": "Random Misfire", "class": "Stored"},
        {"code": "P0171", "desc": "System Too Lean B1", "class": "Stored"},
        {"code": "P0128", "desc": "Coolant Temp Below Thermostat", "class": "Pending"},
        {"code": "P0456", "desc": "Small Evap Leak", "class": "Permanent"},
    ]

def _sample_readiness():
    return [
        {"monitor": "Misfire", "state": "READY"},
        {"monitor": "Catalyst", "state": "NOT_READY"},
        {"monitor": "EVAP", "state": "READY"},
    ]

def _sample_systems():
    return [
        {"key": "engine", "name": "Engine", "score": 78, "status": "WARN"},
        {"key": "charging", "name": "Charging", "score": 92, "status": "OK"},
    ]

def _sample_metrics():
    return {"commReliability": 96, "avgResp": 42, "bus": "CAN-C"}


# ============================================================================
# Diagnostics — /api/diagnostics/interpret
# ============================================================================
class TestInterpret:
    def test_interpret_requires_auth(self, client):
        r = client.post(f"{API}/diagnostics/interpret", json={"kind": "system", "title": "Engine", "vehicle": "2018 Jeep Wrangler", "context": {}})
        assert r.status_code == 401

    def test_interpret_system(self, client, auth):
        r = client.post(f"{API}/diagnostics/interpret", headers=auth, json={
            "kind": "system", "title": "Engine", "vehicle": "2018 Jeep Wrangler",
            "context": {"rpm": 820, "coolant": 92, "stft": 3.2, "dtcs": ["P0300"]},
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert "interpretation" in body
        assert isinstance(body["interpretation"], str) and len(body["interpretation"]) > 20

    def test_interpret_module(self, client, auth):
        r = client.post(f"{API}/diagnostics/interpret", headers=auth, json={
            "kind": "module", "title": "PCM", "vehicle": "2018 Jeep Wrangler",
            "context": {"commRate": 98, "dtcs": ["P0300", "P0171"], "score": 78},
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert isinstance(body.get("interpretation"), str) and len(body["interpretation"]) > 20


# ============================================================================
# Scans — POST /api/scans (all 6 workflows) + persistence checks
# ============================================================================
WORKFLOWS = ["full", "quick", "health", "prepurchase", "charging", "cooling"]


class TestScansCreate:
    def test_create_requires_auth(self, client):
        r = client.post(f"{API}/scans", json={"workflow": "quick", "vehicle": "x"})
        assert r.status_code == 401

    @pytest.mark.parametrize("wf", WORKFLOWS)
    def test_create_workflow(self, client, auth, wf):
        payload = {
            "workflow": wf,
            "vehicle": "2018 Jeep Wrangler",
            "vin": "1C4HJXEG9JW174532",
            "modules": _sample_modules(),
            "dtcs": _sample_dtcs(),
            "readiness": _sample_readiness(),
            "systems": _sample_systems(),
            "metrics": _sample_metrics(),
            "overall_score": 79,
        }
        r = client.post(f"{API}/scans", headers=auth, json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        # id + persisted fields
        assert body.get("id")
        assert body["workflow"] == wf
        assert body["overall_score"] == 79
        # ai_report should be non-empty (GPT or graceful fallback)
        assert isinstance(body.get("ai_report"), str) and len(body["ai_report"]) > 10
        # verify GET returns the same doc with modules+systems (full form)
        gid = body["id"]
        g = client.get(f"{API}/scans/{gid}", headers=auth)
        assert g.status_code == 200
        gb = g.json()
        assert gb["id"] == gid
        assert gb["workflow"] == wf
        assert len(gb["modules"]) == 2
        assert len(gb["systems"]) == 2
        assert len(gb["dtcs"]) == 4
        # cleanup
        d = client.delete(f"{API}/scans/{gid}", headers=auth)
        assert d.status_code == 200


# ============================================================================
# Scans — list + list?vehicle_id + list excludes modules/systems
# ============================================================================
class TestScansList:
    def test_list_requires_auth(self, client):
        r = client.get(f"{API}/scans")
        assert r.status_code == 401

    def test_list_excludes_modules_and_systems(self, client, auth):
        # create a scan tied to a specific vehicle_id
        vid = f"veh-{uuid.uuid4().hex[:8]}"
        payload = {
            "workflow": "quick", "vehicle": "TEST Car", "vin": "TESTVIN01",
            "vehicle_id": vid,
            "modules": _sample_modules(), "dtcs": _sample_dtcs(),
            "readiness": _sample_readiness(), "systems": _sample_systems(),
            "metrics": _sample_metrics(), "overall_score": 88,
        }
        c = client.post(f"{API}/scans", headers=auth, json=payload)
        assert c.status_code == 200
        sid = c.json()["id"]
        try:
            r = client.get(f"{API}/scans", headers=auth)
            assert r.status_code == 200
            items = r.json()
            assert isinstance(items, list)
            hit = next((x for x in items if x["id"] == sid), None)
            assert hit is not None, "created scan should appear in list"
            # projection should exclude modules & systems
            assert "modules" not in hit
            assert "systems" not in hit
            # but keep summary-ish fields
            assert hit["workflow"] == "quick"
            assert hit["overall_score"] == 88

            # filter by vehicle_id
            r2 = client.get(f"{API}/scans?vehicle_id={vid}", headers=auth)
            assert r2.status_code == 200
            items2 = r2.json()
            assert len(items2) >= 1
            assert all(x["vehicle_id"] == vid for x in items2)
        finally:
            client.delete(f"{API}/scans/{sid}", headers=auth)


# ============================================================================
# Scans — 404 / auth on single-scan endpoints
# ============================================================================
class TestScanSingle:
    def test_get_random_returns_404(self, client, auth):
        r = client.get(f"{API}/scans/{uuid.uuid4()}", headers=auth)
        assert r.status_code == 404

    def test_get_requires_auth(self, client):
        r = client.get(f"{API}/scans/{uuid.uuid4()}")
        assert r.status_code == 401

    def test_delete_requires_auth(self, client):
        r = client.delete(f"{API}/scans/{uuid.uuid4()}")
        assert r.status_code == 401

    def test_delete_verifies_gone(self, client, auth):
        # create and delete, then GET => 404
        payload = {
            "workflow": "health", "vehicle": "TEST DEL",
            "modules": [], "dtcs": [], "readiness": [], "systems": [],
            "metrics": {}, "overall_score": 100,
        }
        c = client.post(f"{API}/scans", headers=auth, json=payload)
        assert c.status_code == 200
        sid = c.json()["id"]
        d = client.delete(f"{API}/scans/{sid}", headers=auth)
        assert d.status_code == 200
        g = client.get(f"{API}/scans/{sid}", headers=auth)
        assert g.status_code == 404
