"""JARVIS AI — Performance Recorder endpoints (iteration 6)."""
import os
import time
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
def vehicle_id(client, auth):
    """Upsert a dedicated TEST vehicle by VIN for performance/aggregation."""
    payload = {
        "vin": f"TESTVIN{uuid.uuid4().hex[:10].upper()}",
        "nickname": f"TEST_RecCar_{uuid.uuid4().hex[:6]}",
        "spec": {"make": "TEST", "model": "Recorder", "year": 2026},
    }
    r = client.post(f"{API}/vehicles/upsert-by-vin", json=payload, headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    vid = r.json()["id"]
    yield vid
    client.delete(f"{API}/vehicles/{vid}", headers=auth)


def _make_recording_payload(vehicle_id, name, max_speed=80, peak_rpm=3500,
                             lowest_v=12.8, highest_c=95, duration=12.5, distance=0.34,
                             health_score=85):
    samples = [
        {"t": i * 100, "rpm": 800 + i * 50, "speed": min(max_speed, i * 5),
         "coolant": 88 + (i % 5), "voltage": 13.5 - (i * 0.02), "throttle": 20 + (i % 30)}
        for i in range(20)
    ]
    events = [{"type": "hardBrake", "t": 4500, "detail": "-0.42g"}]
    summary = {
        "maxSpeed": max_speed, "peakRpm": peak_rpm, "lowestVoltage": lowest_v,
        "highestCoolant": highest_c, "avgThrottle": 24, "hardBrakes": 1,
    }
    return {
        "vehicle_id": vehicle_id,
        "vin": "TESTVINSTATIC",
        "name": name,
        "notes": "Test drive session",
        "driver_notes": "",
        "tags": ["test"],
        "duration": duration,
        "distance": distance,
        "health_score": health_score,
        "summary": summary,
        "events": events,
        "samples": samples,
    }


# ---- Auth required ----
def test_recordings_require_auth(client):
    assert client.get(f"{API}/recordings").status_code == 401
    assert client.post(f"{API}/recordings", json={"name": "x"}).status_code == 401
    assert client.get(f"{API}/recordings/nope").status_code == 401
    assert client.delete(f"{API}/recordings/nope").status_code == 401
    assert client.post(f"{API}/recordings/nope/analyze").status_code == 401


def test_vehicle_performance_requires_auth(client):
    assert client.get(f"{API}/vehicles/anything/performance").status_code == 401


# ---- Performance with zero recordings ----
def test_performance_zero(client, auth, vehicle_id):
    r = client.get(f"{API}/vehicles/{vehicle_id}/performance", headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["count"] == 0
    assert body["recent"] == []
    assert body["trends"] == {}


# ---- Create → List → Get → Performance (>=2 recordings) ----
def test_create_and_list_recordings(client, auth, vehicle_id):
    p1 = _make_recording_payload(vehicle_id, f"TEST_Session1_{uuid.uuid4().hex[:5]}",
                                  max_speed=95, peak_rpm=4200, duration=10.2, distance=0.30)
    p2 = _make_recording_payload(vehicle_id, f"TEST_Session2_{uuid.uuid4().hex[:5]}",
                                  max_speed=110, peak_rpm=5200, duration=18.7, distance=0.55,
                                  lowest_v=12.3, highest_c=102)
    r1 = client.post(f"{API}/recordings", json=p1, headers=auth, timeout=30)
    assert r1.status_code == 200, r1.text
    b1 = r1.json()
    assert "id" in b1 and "created_at" in b1
    rid1 = b1["id"]

    r2 = client.post(f"{API}/recordings", json=p2, headers=auth, timeout=30)
    assert r2.status_code == 200
    rid2 = r2.json()["id"]

    # List all
    lst = client.get(f"{API}/recordings", headers=auth, timeout=30)
    assert lst.status_code == 200
    ids = [r["id"] for r in lst.json()]
    assert rid1 in ids and rid2 in ids
    # samples excluded on list
    for rec in lst.json():
        assert "samples" not in rec or rec.get("samples") in (None, [])

    # Filter by vehicle_id
    lst2 = client.get(f"{API}/recordings", headers=auth, params={"vehicle_id": vehicle_id}, timeout=30)
    assert lst2.status_code == 200
    ids2 = [r["id"] for r in lst2.json()]
    assert rid1 in ids2 and rid2 in ids2
    # all belong to this vehicle
    for rec in lst2.json():
        assert rec.get("vehicle_id") == vehicle_id

    # GET single returns full incl samples
    g = client.get(f"{API}/recordings/{rid1}", headers=auth, timeout=30)
    assert g.status_code == 200
    single = g.json()
    assert single["id"] == rid1
    assert isinstance(single.get("samples"), list) and len(single["samples"]) > 0
    assert single["summary"]["peakRpm"] == 4200
    assert "_id" not in single and "user_id" not in single

    # GET unknown -> 404
    r404 = client.get(f"{API}/recordings/does-not-exist-zz", headers=auth, timeout=30)
    assert r404.status_code == 404

    # Performance with 2 recordings
    perf = client.get(f"{API}/vehicles/{vehicle_id}/performance", headers=auth, timeout=30)
    assert perf.status_code == 200
    pb = perf.json()
    assert pb["count"] == 2
    assert len(pb["recent"]) == 2
    # longest = session 2 (18.7s)
    assert pb["longest"]["id"] == rid2
    # fastest = session 2 (110)
    assert pb["fastest"]["id"] == rid2 and pb["fastest"]["maxSpeed"] == 110
    # highest rpm = session 2 (5200)
    assert pb["highestRpm"]["id"] == rid2 and pb["highestRpm"]["peakRpm"] == 5200
    assert "battery" in pb["trends"] and len(pb["trends"]["battery"]) == 2
    assert "coolant" in pb["trends"] and "health" in pb["trends"]

    # Analyze recording (GPT-5.4). Persists ai_analysis.
    an = client.post(f"{API}/recordings/{rid1}/analyze", headers=auth, timeout=180)
    assert an.status_code == 200, an.text
    ab = an.json()
    assert isinstance(ab.get("analysis"), str) and len(ab["analysis"]) > 40

    # ai_analysis persisted on GET
    g2 = client.get(f"{API}/recordings/{rid1}", headers=auth, timeout=30)
    assert g2.status_code == 200
    assert isinstance(g2.json().get("ai_analysis"), str) and len(g2.json()["ai_analysis"]) > 40

    # DELETE rid2
    d = client.delete(f"{API}/recordings/{rid2}", headers=auth, timeout=30)
    assert d.status_code == 200 and d.json().get("ok") is True

    # Verify deletion
    g3 = client.get(f"{API}/recordings/{rid2}", headers=auth, timeout=30)
    assert g3.status_code == 404

    # Performance now count==1
    perf2 = client.get(f"{API}/vehicles/{vehicle_id}/performance", headers=auth, timeout=30)
    assert perf2.status_code == 200
    assert perf2.json()["count"] == 1

    # Cleanup remaining rid1
    client.delete(f"{API}/recordings/{rid1}", headers=auth)


def test_analyze_unknown_returns_404(client, auth):
    r = client.post(f"{API}/recordings/does-not-exist-zzz/analyze", headers=auth, timeout=30)
    assert r.status_code == 404
