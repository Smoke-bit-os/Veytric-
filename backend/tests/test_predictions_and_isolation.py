"""Backend regression tests for:
1) Predictive maintenance HONESTY — never fabricate component condition.
2) Per-user data ISOLATION across vehicles / scans / reports / predictions.

Run: pytest /app/backend/tests/test_predictions_and_isolation.py -v --tb=short \
     --junitxml=/app/test_reports/pytest/iteration_16.xml
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "EXPO_PUBLIC_BACKEND_URL must be set in frontend/.env"

TIMEOUT = 20


# --------------------------------------------------------------------------- helpers
def _register(session: requests.Session, name: str = "T"):
    email = f"test_{uuid.uuid4().hex[:10]}@example.com"
    r = session.post(
        f"{BASE_URL}/api/auth/register",
        json={"name": name, "email": email, "password": "Jarvis2026!"},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    return data["token"], data["user"], email


def _client(token: str | None = None) -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    return s


def _create_vehicle(session: requests.Session, name: str = "TEST_car"):
    payload = {
        "name": name,
        "make": "Honda",
        "model": "Civic",
        "year": 2018,
    }
    r = session.post(f"{BASE_URL}/api/vehicles", json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, f"create vehicle: {r.status_code} {r.text}"
    return r.json()


# ============================================================================
# Predictions HONESTY
# ============================================================================
class TestPredictionsHonesty:
    """A brand-new vehicle with no mileage/history must NEVER return a
    fabricated %/urgency. Every item must carry a data SOURCE."""

    @classmethod
    def setup_class(cls):
        cls.token, _, cls.email = _register(_client(), "Honesty")
        cls.client = _client(cls.token)
        cls.vehicle = _create_vehicle(cls.client, "TEST_honesty_car")
        cls.vid = cls.vehicle["id"]

    def test_no_mileage_no_history_returns_unknown_or_inspect_or_test(self):
        r = self.client.get(
            f"{BASE_URL}/api/vehicles/{self.vid}/predictions", timeout=TIMEOUT
        )
        assert r.status_code == 200, r.text
        body = r.json()
        # Top-level honesty contract
        assert body.get("mileageKnown") is False
        assert body.get("mileage") is None
        items = body.get("items")
        assert isinstance(items, list) and len(items) > 0

        allowed = {"unknown", "inspect", "test"}
        for it in items:
            assert it["urgency"] in allowed, (
                f"item {it['key']} urgency must be in {allowed} without any data, "
                f"got {it['urgency']}"
            )
            assert it["source"] == "UNAVAILABLE", (
                f"item {it['key']} must be UNAVAILABLE without data, got {it['source']}"
            )
            assert it["remainingLifePct"] is None, (
                f"item {it['key']} remainingLifePct must be None, got {it['remainingLifePct']}"
            )
            assert it["remainingKm"] is None
            assert it["dueMileage"] is None
            assert it["confidence"] is None

    def test_brakes_inspect_and_battery_test_are_hard_rules(self):
        r = self.client.get(
            f"{BASE_URL}/api/vehicles/{self.vid}/predictions", timeout=TIMEOUT
        )
        items_by_key = {it["key"]: it for it in r.json()["items"]}
        assert items_by_key["brakes"]["urgency"] == "inspect"
        assert items_by_key["brakes"]["source"] == "UNAVAILABLE"
        assert items_by_key["battery"]["urgency"] == "test"
        assert items_by_key["battery"]["source"] == "UNAVAILABLE"

    def test_with_mileage_interval_items_become_manufacturer_but_brakes_battery_unchanged(self):
        # PATCH mileage to activate manufacturer-interval predictions
        r = self.client.patch(
            f"{BASE_URL}/api/vehicles/{self.vid}",
            json={"mileage": 95000},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text

        r = self.client.get(
            f"{BASE_URL}/api/vehicles/{self.vid}/predictions", timeout=TIMEOUT
        )
        body = r.json()
        assert body["mileageKnown"] is True
        assert body["mileage"] == 95000
        items = {it["key"]: it for it in body["items"]}

        # brakes MUST still be inspect / UNAVAILABLE (OBD-II can't measure pads)
        assert items["brakes"]["urgency"] == "inspect", items["brakes"]
        assert items["brakes"]["source"] == "UNAVAILABLE"
        assert items["brakes"]["remainingLifePct"] is None
        # battery MUST still be test / UNAVAILABLE (requires physical load test)
        assert items["battery"]["urgency"] == "test", items["battery"]
        assert items["battery"]["source"] == "UNAVAILABLE"
        assert items["battery"]["remainingLifePct"] is None

        # All OTHER (interval) items must now carry GENERAL_INDUSTRY_INTERVAL
        # (we ship no manufacturer-specific tables). With mileage but NO service
        # history there is no baseline, so we do NOT fabricate a due/overdue or a
        # % life — urgency is "unknown" and remainingLifePct/dueMileage are null.
        interval_keys = [
            k for k in items if k not in ("brakes", "battery")
        ]
        for k in interval_keys:
            it = items[k]
            assert it["source"] == "GENERAL_INDUSTRY_INTERVAL", (k, it)
            assert it["remainingLifePct"] is None, (k, it)  # never fabricated
            assert it["dueMileage"] is None, (k, it)         # no baseline -> no due
            assert it["urgency"] == "unknown", (k, it)
            assert it["confidence"] is not None

    def test_service_history_promotes_source_to_user_service_history(self):
        # Log a real oil-change service at 80,000 km (mileage is 95k)
        r = self.client.post(
            f"{BASE_URL}/api/vehicles/{self.vid}/history/maintenance",
            json={
                "title": "Oil change",
                "detail": "Full synthetic oil & filter",
                "meta": {"mileage": 80000},
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text

        r = self.client.get(
            f"{BASE_URL}/api/vehicles/{self.vid}/predictions", timeout=TIMEOUT
        )
        items = {it["key"]: it for it in r.json()["items"]}
        oil = items["oil"]
        assert oil["source"] == "USER_SERVICE_HISTORY", oil
        assert oil["lastServiceKm"] == 80000
        # With a real baseline we compute due/remaining, but remainingLifePct
        # stays null (no physical measurement) — a % life is never fabricated.
        assert oil["remainingLifePct"] is None, oil
        assert oil["dueMileage"] is not None, oil
        assert oil["remainingKm"] is not None, oil
        assert oil["urgency"] in {"overdue", "soon", "upcoming", "ok"}, oil
        assert oil["confidence"] is not None
        # Brakes/battery still UNAVAILABLE — service log on oil doesn't touch them.
        assert items["brakes"]["source"] == "UNAVAILABLE"
        assert items["battery"]["source"] == "UNAVAILABLE"


# ============================================================================
# User ISOLATION
# ============================================================================
class TestUserIsolation:
    """User B must NEVER see User A's data via any endpoint."""

    @classmethod
    def setup_class(cls):
        # User A
        cls.tokenA, cls.userA, _ = _register(_client(), "UserA")
        cls.a = _client(cls.tokenA)
        cls.vehicleA = _create_vehicle(cls.a, "TEST_UserA_Car")
        cls.vidA = cls.vehicleA["id"]
        # Create scan for A
        r = cls.a.post(
            f"{BASE_URL}/api/scans",
            json={"vehicle": "TEST_UserA_Car", "notes": "TEST_A_scan", "workflow": "quick"},
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text
        cls.scanA_id = r.json().get("id") or r.json().get("_id")
        # Create report for A
        r = cls.a.post(
            f"{BASE_URL}/api/reports",
            json={
                "vehicle": "TEST_UserA_Car",
                "vehicle_id": cls.vidA,
                "health_score": 88,
                "dtcs": [{"code": "P0300"}],
            },
            timeout=TIMEOUT,
        )
        assert r.status_code == 200, r.text

        # User B
        cls.tokenB, cls.userB, _ = _register(_client(), "UserB")
        cls.b = _client(cls.tokenB)

    def test_userB_cannot_see_userA_vehicles(self):
        r = self.b.get(f"{BASE_URL}/api/vehicles", timeout=TIMEOUT)
        assert r.status_code == 200
        arr = r.json()
        assert isinstance(arr, list)
        ids = [v.get("id") for v in arr]
        assert self.vidA not in ids, f"User B saw User A's vehicle: {arr}"

    def test_userB_cannot_get_userA_vehicle_by_id(self):
        r = self.b.get(f"{BASE_URL}/api/vehicles/{self.vidA}", timeout=TIMEOUT)
        assert r.status_code in (403, 404), r.text

    def test_userB_cannot_get_userA_predictions(self):
        r = self.b.get(
            f"{BASE_URL}/api/vehicles/{self.vidA}/predictions", timeout=TIMEOUT
        )
        assert r.status_code in (403, 404), (
            f"User B fetched User A's predictions: {r.status_code} {r.text}"
        )

    def test_userB_cannot_see_userA_scans(self):
        r = self.b.get(f"{BASE_URL}/api/scans", timeout=TIMEOUT)
        assert r.status_code == 200
        arr = r.json()
        for s in arr:
            # No scan of user A should appear
            assert s.get("notes") != "TEST_A_scan", (
                f"User B saw User A's scan: {s}"
            )

    def test_userB_cannot_see_userA_reports(self):
        r = self.b.get(f"{BASE_URL}/api/reports", timeout=TIMEOUT)
        assert r.status_code == 200
        arr = r.json()
        for rep in arr:
            assert rep.get("vehicle_id") != self.vidA, (
                f"User B saw User A's report: {rep}"
            )

    def test_userB_cannot_patch_userA_vehicle(self):
        r = self.b.patch(
            f"{BASE_URL}/api/vehicles/{self.vidA}",
            json={"mileage": 1},
            timeout=TIMEOUT,
        )
        assert r.status_code in (403, 404), r.text

    def test_userA_still_sees_own_data(self):
        r = self.a.get(f"{BASE_URL}/api/vehicles", timeout=TIMEOUT)
        assert r.status_code == 200
        ids = [v.get("id") for v in r.json()]
        assert self.vidA in ids


# ============================================================================
# Anonymous access denied
# ============================================================================
class TestUnauthenticated:
    def test_predictions_requires_auth(self):
        r = requests.get(
            f"{BASE_URL}/api/vehicles/anything/predictions", timeout=TIMEOUT
        )
        assert r.status_code in (401, 403), r.text

    def test_vehicles_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/vehicles", timeout=TIMEOUT)
        assert r.status_code in (401, 403), r.text
