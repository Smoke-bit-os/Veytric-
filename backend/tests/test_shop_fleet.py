"""
Backend tests: Shop Dashboard (Fleet + Customers MVP).

Coverage:
  - Tier gating on GET /api/shop/fleet (free/pro -> 403 shop_required; shop -> 200).
  - PATCH /api/vehicles/{id} customer fields gated Shop-only; regression PATCH name/mileage works for all tiers.
  - Fleet summary shape & bucket math (healthy>=80, attention 60-79, critical<60, unknown w/o health).
  - Vehicle row shape (openIssues from most-recent scan/report dtcs, healthStatus, lastScan, hasRecentScan).
  - Cross-tenant data isolation between two shop users.
  - No duplicate vehicle records created when patching customer fields.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

PW = "Jarvis2026!"


def _register(session: requests.Session):
    email = f"TEST_shop_{uuid.uuid4().hex[:8]}@jarvis.ai"
    r = session.post(f"{API}/auth/register", json={"name": "Tester", "email": email, "password": PW})
    assert r.status_code == 200, f"register failed {r.status_code} {r.text}"
    body = r.json()
    token = body["token"]
    session.headers.update({"Authorization": f"Bearer {token}"})
    return email, body["user"]["id"]


def _set_tier(session: requests.Session, action: str):
    r = session.post(f"{API}/subscription/developer/set", json={"action": action})
    assert r.status_code == 200, f"tier set failed {action}: {r.status_code} {r.text}"


def _add_vehicle(session: requests.Session, year=2020, make="Ford", model="F-150", vin=None, name=None):
    vin = vin or ("TESTVIN" + uuid.uuid4().hex[:10].upper())
    payload = {
        "name": name or f"TEST_{make}_{model}",
        "vin": vin, "year": year, "make": make, "model": model,
    }
    r = session.post(f"{API}/vehicles", json=payload)
    assert r.status_code == 200, f"add vehicle failed {r.status_code} {r.text}"
    return r.json()


@pytest.fixture
def anon_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture
def free_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _register(s)
    _set_tier(s, "free")
    return s


@pytest.fixture
def pro_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _register(s)
    _set_tier(s, "pro")
    return s


@pytest.fixture
def shop_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _register(s)
    _set_tier(s, "shop")
    return s


@pytest.fixture
def second_shop_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    _register(s)
    _set_tier(s, "shop")
    return s


# -------------------------- GET /api/shop/fleet gating ---------------------
class TestFleetGating:
    def test_free_user_forbidden(self, free_client):
        r = free_client.get(f"{API}/shop/fleet")
        assert r.status_code == 403
        detail = r.json().get("detail") or {}
        assert isinstance(detail, dict) and detail.get("code") == "shop_required"

    def test_pro_user_forbidden(self, pro_client):
        r = pro_client.get(f"{API}/shop/fleet")
        assert r.status_code == 403
        detail = r.json().get("detail") or {}
        assert detail.get("code") == "shop_required"

    def test_shop_user_allowed_empty(self, shop_client):
        r = shop_client.get(f"{API}/shop/fleet")
        assert r.status_code == 200
        body = r.json()
        assert "summary" in body and "vehicles" in body
        s = body["summary"]
        for k in ["total", "healthy", "attention", "critical", "unknown", "totalOpenIssues", "noScanCount", "avgHealth"]:
            assert k in s, f"summary missing key {k}"
        assert s["total"] == 0
        assert s["avgHealth"] is None
        assert body["vehicles"] == []


# -------------------------- PATCH customer fields gating -------------------
class TestPatchCustomerGating:
    def test_free_cannot_patch_customer_name(self, free_client):
        v = _add_vehicle(free_client)
        vid = v["id"]
        r = free_client.patch(f"{API}/vehicles/{vid}", json={"customerName": "Alice"})
        assert r.status_code == 403
        detail = r.json().get("detail") or {}
        assert detail.get("code") == "shop_required"

    def test_pro_cannot_patch_customer_notes(self, pro_client):
        v = _add_vehicle(pro_client)
        vid = v["id"]
        r = pro_client.patch(f"{API}/vehicles/{vid}", json={"customerNotes": "notes"})
        assert r.status_code == 403
        assert (r.json().get("detail") or {}).get("code") == "shop_required"

    def test_shop_can_patch_customer_and_persists(self, shop_client):
        v = _add_vehicle(shop_client)
        vid = v["id"]
        r = shop_client.patch(f"{API}/vehicles/{vid}", json={"customerName": "Bob Smith", "customerNotes": "Prefers full synthetic oil"})
        assert r.status_code == 200
        # GET to verify persistence
        r2 = shop_client.get(f"{API}/vehicles/{vid}")
        assert r2.status_code == 200
        body = r2.json()
        assert body.get("customerName") == "Bob Smith"
        assert body.get("customerNotes") == "Prefers full synthetic oil"

    # Regression: PATCH with only name/mileage should still work for all tiers
    def test_free_can_patch_name_mileage(self, free_client):
        v = _add_vehicle(free_client)
        vid = v["id"]
        r = free_client.patch(f"{API}/vehicles/{vid}", json={"name": "My Truck", "mileage": 60000})
        assert r.status_code == 200
        r2 = free_client.get(f"{API}/vehicles/{vid}")
        assert r2.status_code == 200
        b = r2.json()
        assert b.get("name") == "My Truck"
        assert b.get("mileage") == 60000

    def test_pro_can_patch_mileage(self, pro_client):
        v = _add_vehicle(pro_client)
        vid = v["id"]
        r = pro_client.patch(f"{API}/vehicles/{vid}", json={"mileage": 77777})
        assert r.status_code == 200
        r2 = pro_client.get(f"{API}/vehicles/{vid}")
        assert r2.json().get("mileage") == 77777


# -------------------------- Fleet summary math -----------------------------
class TestFleetSummaryMath:
    def test_summary_buckets_and_openIssues(self, shop_client):
        # v1: healthy 90 (>=80)
        v1 = _add_vehicle(shop_client, make="Honda", model="Civic")
        r = shop_client.post(f"{API}/vehicles/{v1['id']}/health", json={"score": 90})
        assert r.status_code == 200
        # v2: attention 70
        v2 = _add_vehicle(shop_client, make="Toyota", model="Camry")
        r = shop_client.post(f"{API}/vehicles/{v2['id']}/health", json={"score": 70})
        assert r.status_code == 200
        # v3: critical 40
        v3 = _add_vehicle(shop_client, make="Chevy", model="Malibu")
        r = shop_client.post(f"{API}/vehicles/{v3['id']}/health", json={"score": 40})
        assert r.status_code == 200
        # v4: unknown (no health)
        v4 = _add_vehicle(shop_client, make="Nissan", model="Altima")

        # Create a report with 3 dtcs for v2 -> openIssues=3
        rep_payload = {
            "vehicle_id": v2["id"],
            "vehicle": f"{v2.get('year','')} {v2.get('make','')} {v2.get('model','')}".strip(),
            "dtcs": [{"code": "P0300"}, {"code": "P0171"}, {"code": "P0420"}],
            "ai_findings": "seed", "ai_provider": "byok",
        }
        rr = shop_client.post(f"{API}/reports", json=rep_payload)
        assert rr.status_code == 200, rr.text

        r = shop_client.get(f"{API}/shop/fleet")
        assert r.status_code == 200
        body = r.json()
        s = body["summary"]
        assert s["total"] == 4
        assert s["healthy"] == 1
        assert s["attention"] == 1
        assert s["critical"] == 1
        assert s["unknown"] == 1
        assert s["totalOpenIssues"] == 3
        # avgHealth = round(mean(90,70,40)) = 67
        assert s["avgHealth"] == 67

        by_id = {v["id"]: v for v in body["vehicles"]}
        assert by_id[v1["id"]]["healthStatus"] == "healthy"
        assert by_id[v2["id"]]["healthStatus"] == "attention"
        assert by_id[v2["id"]]["openIssues"] == 3
        assert by_id[v3["id"]]["healthStatus"] == "critical"
        assert by_id[v4["id"]]["healthStatus"] == "unknown"
        assert by_id[v4["id"]]["healthScore"] is None

        # Shape sanity
        row = by_id[v1["id"]]
        for k in ["id", "vin", "name", "year", "make", "model", "mileage",
                  "customerName", "customerNotes", "healthScore", "healthStatus",
                  "lastScan", "openIssues", "hasRecentScan"]:
            assert k in row, f"vehicle row missing {k}"

    def test_avgHealth_none_when_no_scores(self, shop_client):
        _add_vehicle(shop_client)
        _add_vehicle(shop_client)
        r = shop_client.get(f"{API}/shop/fleet")
        assert r.status_code == 200
        s = r.json()["summary"]
        assert s["total"] == 2
        assert s["unknown"] == 2
        assert s["avgHealth"] is None
        # No recent scan -> noScanCount == total
        assert s["noScanCount"] == 2


# -------------------------- Data isolation ---------------------------------
class TestDataIsolation:
    def test_second_shop_user_does_not_see_first(self, shop_client, second_shop_client):
        v_a = _add_vehicle(shop_client, make="AAA", model="One")
        r = shop_client.patch(f"{API}/vehicles/{v_a['id']}", json={"customerName": "Alpha Corp"})
        assert r.status_code == 200
        v_b = _add_vehicle(second_shop_client, make="BBB", model="Two")

        r_a = shop_client.get(f"{API}/shop/fleet")
        r_b = second_shop_client.get(f"{API}/shop/fleet")
        assert r_a.status_code == 200 and r_b.status_code == 200
        ids_a = {v["id"] for v in r_a.json()["vehicles"]}
        ids_b = {v["id"] for v in r_b.json()["vehicles"]}
        assert v_a["id"] in ids_a and v_a["id"] not in ids_b
        assert v_b["id"] in ids_b and v_b["id"] not in ids_a


# -------------------------- No duplicate rows on customer patch -----------
class TestNoDuplicates:
    def test_patch_customer_does_not_duplicate_vehicle(self, shop_client):
        v = _add_vehicle(shop_client, make="Mazda", model="3")
        vid = v["id"]
        # Patch multiple times
        for i in range(3):
            r = shop_client.patch(f"{API}/vehicles/{vid}", json={"customerName": f"Cust {i}", "customerNotes": f"n{i}"})
            assert r.status_code == 200
        # /shop/fleet lists exactly 1 row with matching id
        r = shop_client.get(f"{API}/shop/fleet")
        assert r.status_code == 200
        rows = [x for x in r.json()["vehicles"] if x["id"] == vid]
        assert len(rows) == 1
        assert rows[0]["customerName"] == "Cust 2"
        assert rows[0]["customerNotes"] == "n2"


# -------------------------- Anonymous ------------------------------------
class TestAnonAuth:
    def test_anon_fleet_401(self, anon_client):
        r = anon_client.get(f"{API}/shop/fleet")
        assert r.status_code in (401, 403)  # depends on auth guard order

    def test_anon_patch_401(self, anon_client):
        r = anon_client.patch(f"{API}/vehicles/does-not-exist", json={"customerName": "x"})
        assert r.status_code in (401, 403)
