"""JARVIS AI — Vehicle Intelligence & Maintenance Platform tests.

Covers: timeline, predictions, trends, dashboard, trends/explain, health-report,
plus new history kinds (repair, note) and auth/404 boundaries.
"""
import os
import uuid
import pytest
import requests
from _helpers import seed_session

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://jarvis-ai-1486.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "mechanic@jarvis.ai"
TEST_PASSWORD = "Jarvis2026!"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(client):
    _, tok, _ = seed_session("Mechanic")
    return tok


@pytest.fixture(scope="module")
def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def vehicle(client, auth):
    """Create a fresh upserted vehicle with rich history + a report + a recording."""
    vin = f"TEST{uuid.uuid4().hex[:13].upper()}"[:17]
    # Use a legitimate-looking VIN so upsert works; spec provides basics.
    payload = {
        "vin": vin,
        "nickname": f"TEST_Intel_{uuid.uuid4().hex[:6]}",
        "mileage": 72000,
        "spec": {"make": "JEEP", "model": "Wrangler", "year": 2018, "engine": "3.6L V6",
                 "trim": "Sahara", "transmission": "8-speed", "drivetrain": "4WD",
                 "bodyStyle": "SUV", "manufacturer": "FCA", "confidence": 0.9, "source": "test"},
    }
    r = client.post(f"{API}/vehicles/upsert-by-vin", json=payload, headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    v = r.json()
    vid = v["id"]
    yield v
    # cleanup vehicle + linked history/recordings/reports/health-report
    client.delete(f"{API}/vehicles/{vid}", headers=auth)


# ------------------ Auth / 404 boundaries ------------------

@pytest.mark.parametrize("path", [
    "/vehicles/does-not-exist/timeline",
    "/vehicles/does-not-exist/predictions",
    "/vehicles/does-not-exist/trends",
    "/vehicles/does-not-exist/dashboard",
    "/vehicles/does-not-exist/health-report",
])
def test_intel_get_requires_auth(client, path):
    r = client.get(f"{API}{path}")
    assert r.status_code == 401


@pytest.mark.parametrize("path", [
    "/vehicles/does-not-exist/trends/explain",
    "/vehicles/does-not-exist/health-report",
])
def test_intel_post_requires_auth(client, path):
    r = client.post(f"{API}{path}")
    assert r.status_code == 401


def test_intel_unknown_vehicle_404s(client, auth):
    for p in ["/timeline", "/predictions", "/trends", "/dashboard"]:
        r = client.get(f"{API}/vehicles/does-not-exist-xyz{p}", headers=auth, timeout=30)
        assert r.status_code == 404, f"{p}: {r.status_code}"
    r = client.post(f"{API}/vehicles/does-not-exist-xyz/trends/explain", headers=auth, timeout=30)
    assert r.status_code == 404
    r = client.post(f"{API}/vehicles/does-not-exist-xyz/health-report", headers=auth, timeout=30)
    assert r.status_code == 404


# ------------------ History: new kinds (repair, note) ------------------

def test_history_repair_and_note_accepted(client, auth, vehicle):
    vid = vehicle["id"]
    r = client.post(f"{API}/vehicles/{vid}/history/repair",
                    json={"title": "TEST_BrakeJob", "detail": "Front pads + rotors",
                          "meta": {"mileage": 68000, "cost": 420, "parts": ["pads", "rotors"], "labor": 2.5}},
                    headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["kind"] == "repair"
    assert b["meta"]["mileage"] == 68000

    r = client.post(f"{API}/vehicles/{vid}/history/note",
                    json={"title": "TEST_Note", "detail": "Owner reports slight vibration at 60mph",
                          "meta": {"linkedRecordingId": None}},
                    headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "note"


# ------------------ Predictions ------------------

def test_predictions_shape_and_urgency(client, auth, vehicle):
    vid = vehicle["id"]
    # Seed one maintenance record so at least one item has higher confidence.
    client.post(f"{API}/vehicles/{vid}/history/maintenance",
                json={"title": "TEST_Oil change", "detail": "Full synthetic 5W-30",
                      "meta": {"mileage": 65000}}, headers=auth, timeout=30)

    r = client.get(f"{API}/vehicles/{vid}/predictions", headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["mileage"] == 72000
    items = body["items"]
    keys = [i["key"] for i in items]
    # All 10 expected services present
    for k in ("oil", "tires", "airfilter", "brakes", "plugs", "battery", "trans",
              "coolant", "belts", "alternator"):
        assert k in keys, f"missing {k}"
    # Each item has required fields
    for it in items:
        for f in ("intervalKm", "remainingKm", "remainingLifePct", "urgency", "confidence", "reasons"):
            assert f in it, f"item {it['key']} missing {f}"
        assert it["urgency"] in ("overdue", "soon", "upcoming", "ok")
        assert 0.0 <= it["remainingLifePct"] <= 1.0
    # Oil should have higher confidence because we logged a service with mileage
    oil = next(i for i in items if i["key"] == "oil")
    assert oil["confidence"] >= 0.8
    assert oil["lastServiceKm"] == 65000
    # Sorted overdue-first
    order = {"overdue": 0, "soon": 1, "upcoming": 2, "ok": 3}
    priorities = [order[i["urgency"]] for i in items]
    assert priorities == sorted(priorities), "items not sorted overdue-first"


def test_predictions_no_mileage_defaults(client, auth):
    """A vehicle with no mileage should return 100% life + 'Set mileage' reason."""
    vin = f"TEST{uuid.uuid4().hex[:13].upper()}"[:17]
    r = client.post(f"{API}/vehicles/upsert-by-vin",
                    json={"vin": vin, "nickname": "TEST_NoMileage",
                          "spec": {"make": "Honda", "model": "Civic", "year": 2020}},
                    headers=auth, timeout=30)
    assert r.status_code == 200
    vid = r.json()["id"]
    try:
        r = client.get(f"{API}/vehicles/{vid}/predictions", headers=auth, timeout=30)
        assert r.status_code == 200
        items = r.json()["items"]
        # All 'ok' since no mileage
        assert all(i["urgency"] == "ok" for i in items)
        assert all(i["remainingLifePct"] == 1.0 for i in items)
        # At least one 'Set mileage' hint
        assert any("mileage" in " ".join(i["reasons"]).lower() for i in items)
    finally:
        client.delete(f"{API}/vehicles/{vid}", headers=auth)


# ------------------ Timeline ------------------

def test_timeline_returns_events_and_counts(client, auth, vehicle):
    vid = vehicle["id"]
    r = client.get(f"{API}/vehicles/{vid}/timeline", headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "events" in body and "count" in body and "counts" in body
    # We seeded a maintenance + repair + note earlier; counts should reflect them.
    counts = body["counts"]
    assert counts.get("maintenance", 0) >= 1
    assert counts.get("repairs", 0) >= 1
    assert counts.get("notes", 0) >= 1
    # Events sorted desc by ts
    ts = [e["ts"] for e in body["events"]]
    assert ts == sorted(ts, reverse=True)


def test_timeline_filter_narrows(client, auth, vehicle):
    vid = vehicle["id"]
    r = client.get(f"{API}/vehicles/{vid}/timeline?filter=repairs", headers=auth, timeout=30)
    assert r.status_code == 200
    body = r.json()
    assert all(e["group"] == "repairs" for e in body["events"])
    # counts should still reflect totals (not just filtered)
    assert body["counts"].get("maintenance", 0) >= 1


# ------------------ Trends ------------------

def test_trends_series_and_findings(client, auth, vehicle):
    vid = vehicle["id"]
    # Add >=3 health samples to trigger a finding
    for s in (78, 80, 82, 85):
        client.post(f"{API}/vehicles/{vid}/health", json={"score": s}, headers=auth, timeout=30)

    r = client.get(f"{API}/vehicles/{vid}/trends", headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "series" in body and "findings" in body and "repeatedDtcs" in body
    series = body["series"]
    for k in ("battery", "coolant", "health", "maxSpeed"):
        assert k in series
    # Health series has our samples
    assert len(series["health"]) >= 3
    # There should be a finding for health (trend detected)
    keys = [f["key"] for f in body["findings"]]
    assert "health" in keys


# ------------------ Dashboard ------------------

def test_dashboard_shape(client, auth, vehicle):
    vid = vehicle["id"]
    r = client.get(f"{API}/vehicles/{vid}/dashboard", headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    for f in ("healthScore", "mileage", "lastScan", "lastRecording", "lastMaintenance",
              "nextService", "alerts", "trends", "counts"):
        assert f in body, f"missing {f}"
    assert body["mileage"] == 72000
    assert body["nextService"] is not None
    assert "name" in body["nextService"] and "urgency" in body["nextService"]
    assert isinstance(body["alerts"], list)
    assert isinstance(body["trends"], list)


# ------------------ Trends explain (GPT) ------------------

def test_trends_explain_returns_string(client, auth, vehicle):
    vid = vehicle["id"]
    r = client.post(f"{API}/vehicles/{vid}/trends/explain", headers=auth, timeout=120)
    assert r.status_code == 200, r.text
    body = r.json()
    assert isinstance(body.get("explanation"), str)
    assert len(body["explanation"]) > 20


def test_trends_explain_graceful_when_no_findings(client, auth):
    """Fresh vehicle with no data -> friendly message, no 500."""
    vin = f"TEST{uuid.uuid4().hex[:13].upper()}"[:17]
    r = client.post(f"{API}/vehicles/upsert-by-vin",
                    json={"vin": vin, "nickname": "TEST_Empty",
                          "spec": {"make": "Ford", "model": "F150", "year": 2021}},
                    headers=auth, timeout=30)
    vid = r.json()["id"]
    try:
        r = client.post(f"{API}/vehicles/{vid}/trends/explain", headers=auth, timeout=60)
        assert r.status_code == 200
        assert "enough" in r.json()["explanation"].lower() or "trend" in r.json()["explanation"].lower()
    finally:
        client.delete(f"{API}/vehicles/{vid}", headers=auth)


# ------------------ Health Report (GPT persisted) ------------------

def test_health_report_get_none_initially(client, auth):
    vin = f"TEST{uuid.uuid4().hex[:13].upper()}"[:17]
    r = client.post(f"{API}/vehicles/upsert-by-vin",
                    json={"vin": vin, "nickname": "TEST_HR_None",
                          "spec": {"make": "Ford", "model": "Focus", "year": 2019}},
                    headers=auth, timeout=30)
    vid = r.json()["id"]
    try:
        g = client.get(f"{API}/vehicles/{vid}/health-report", headers=auth, timeout=30)
        assert g.status_code == 200
        assert g.json() == {"report": None}
    finally:
        client.delete(f"{API}/vehicles/{vid}", headers=auth)


def test_health_report_create_and_get_latest(client, auth, vehicle):
    vid = vehicle["id"]
    r = client.post(f"{API}/vehicles/{vid}/health-report", headers=auth, timeout=180)
    assert r.status_code == 200, r.text
    created = r.json()
    assert "report" in created and isinstance(created["report"], str) and len(created["report"]) > 50
    assert "id" in created
    assert created.get("vehicle_id") == vid
    # GET should return the same latest
    g = client.get(f"{API}/vehicles/{vid}/health-report", headers=auth, timeout=30)
    assert g.status_code == 200
    got = g.json()
    assert got.get("report") == created["report"]
    assert got.get("id") == created["id"]
