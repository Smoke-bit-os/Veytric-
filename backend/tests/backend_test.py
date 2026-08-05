"""JARVIS AI backend integration tests."""
import os
import uuid
import base64
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://jarvis-ai-1486.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

TEST_EMAIL = "mechanic@jarvis.ai"
TEST_PASSWORD = "Jarvis2026!"


@pytest.fixture(scope="session")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def token(client):
    # Try login first
    r = client.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    if r.status_code == 200:
        return r.json()["token"]
    # Register if not existing
    r = client.post(f"{API}/auth/register", json={"name": "Mechanic", "email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture
def auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---- Health ----
def test_root(client):
    r = client.get(f"{API}/")
    assert r.status_code == 200
    assert "JARVIS" in r.json()["message"]


# ---- Auth ----
def test_register_duplicate_returns_400(client):
    r = client.post(f"{API}/auth/register", json={"name": "Dup", "email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 400


def test_login_wrong_password(client):
    r = client.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": "wrongpass"})
    assert r.status_code == 401


def test_login_success(client):
    r = client.post(f"{API}/auth/login", json={"email": TEST_EMAIL, "password": TEST_PASSWORD})
    assert r.status_code == 200
    body = r.json()
    assert "token" in body and body["user"]["email"] == TEST_EMAIL


def test_me_requires_auth(client):
    r = client.get(f"{API}/auth/me")
    assert r.status_code == 401


def test_me_with_token(client, auth):
    r = client.get(f"{API}/auth/me", headers=auth)
    assert r.status_code == 200
    assert r.json()["email"] == TEST_EMAIL


# ---- Vehicles ----
def test_vehicles_flow(client, auth):
    # list
    r = client.get(f"{API}/vehicles", headers=auth)
    assert r.status_code == 200
    initial_count = len(r.json())

    # add first vehicle - should be active if none exist
    payload1 = {"name": f"TEST_Car1_{uuid.uuid4().hex[:6]}", "make": "Toyota", "model": "Supra", "year": 2023, "engine": "3.0L I6"}
    r = client.post(f"{API}/vehicles", json=payload1, headers=auth)
    assert r.status_code == 200, r.text
    v1 = r.json()
    assert v1["name"] == payload1["name"]
    if initial_count == 0:
        assert v1["is_active"] is True

    # add second
    payload2 = {"name": f"TEST_Car2_{uuid.uuid4().hex[:6]}", "make": "Honda", "model": "Civic", "year": 2020}
    r = client.post(f"{API}/vehicles", json=payload2, headers=auth)
    assert r.status_code == 200
    v2 = r.json()
    assert v2["is_active"] is False

    # activate v2
    r = client.post(f"{API}/vehicles/{v2['id']}/activate", headers=auth)
    assert r.status_code == 200

    # only one active
    r = client.get(f"{API}/vehicles", headers=auth)
    vehicles = r.json()
    actives = [v for v in vehicles if v["is_active"]]
    assert len(actives) == 1
    assert actives[0]["id"] == v2["id"]

    # activate non-existent -> 404
    r = client.post(f"{API}/vehicles/nonexistent/activate", headers=auth)
    assert r.status_code == 404

    # cleanup delete
    for vid in [v1["id"], v2["id"]]:
        r = client.delete(f"{API}/vehicles/{vid}", headers=auth)
        assert r.status_code == 200

    # verify deleted
    r = client.get(f"{API}/vehicles", headers=auth)
    ids = [v["id"] for v in r.json()]
    assert v1["id"] not in ids and v2["id"] not in ids


def test_vehicles_requires_auth(client):
    r = client.get(f"{API}/vehicles")
    assert r.status_code == 401


# ---- Chat ----
def test_chat_and_history(client, auth):
    sid = f"test_{uuid.uuid4().hex[:8]}"
    payload = {
        "session_id": sid,
        "message": "My check engine light just came on and I hear a knock at idle. What should I check first?",
        "telemetry": {"rpm": 850, "coolant_c": 92, "maf": 3.2, "throttle": 12},
        "vehicle": {"make": "Toyota", "model": "Supra", "year": 2023},
    }
    r = client.post(f"{API}/chat", json=payload, headers=auth, timeout=90)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "reply" in body
    assert isinstance(body["reply"], str) and len(body["reply"]) > 20

    # history
    r = client.get(f"{API}/chat/history/{sid}", headers=auth)
    assert r.status_code == 200
    msgs = r.json()
    assert len(msgs) >= 2
    roles = [m["role"] for m in msgs]
    assert "user" in roles and "assistant" in roles


# ---- Voice ----
def test_voice_speak(client, auth):
    r = client.post(f"{API}/voice/speak", json={"text": "Diagnostics online."}, headers=auth, timeout=60)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("mime") == "audio/mp3"
    audio_b64 = body.get("audio")
    assert audio_b64 and len(audio_b64) > 100
    # decode sanity check
    raw = base64.b64decode(audio_b64)
    assert len(raw) > 100


def test_voice_transcribe_requires_auth(client):
    r = client.post(f"{API}/voice/transcribe")
    assert r.status_code == 401


# ---- DTC Analyze (new) ----
def test_dtc_analyze_requires_auth(client):
    r = client.post(f"{API}/dtc/analyze", json={"code": "P0300"})
    assert r.status_code == 401


def test_dtc_analyze_success(client, auth):
    payload = {
        "code": "P0300",
        "desc": "Random/Multiple Cylinder Misfire Detected",
        "telemetry": {"rpm": 780, "coolantTemp": 88, "shortFuelTrim": 6.4, "longFuelTrim": 8.1, "engineLoad": 22},
        "vehicle": {"year": 2018, "make": "Jeep", "model": "Wrangler", "engine": "3.6L V6"},
    }
    r = client.post(f"{API}/dtc/analyze", json=payload, headers=auth, timeout=120)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["code"] == "P0300"
    assert isinstance(body["analysis"], str) and len(body["analysis"]) > 40


# ---- Scan Reports (new) ----
def test_reports_requires_auth(client):
    r = client.get(f"{API}/reports")
    assert r.status_code == 401
    r = client.post(f"{API}/reports", json={"vehicle": {}})
    assert r.status_code == 401


def test_reports_crud(client, auth):
    # list
    r0 = client.get(f"{API}/reports", headers=auth, timeout=30)
    assert r0.status_code == 200
    initial = r0.json()
    assert isinstance(initial, list)

    # create
    payload = {
        "vehicle": {"year": 2018, "make": "Jeep", "model": "Wrangler", "vin": "1C4HJXDG5JW123456", "engine": "3.6L V6"},
        "dtcs": [
            {"code": "P0300", "desc": "Random/Multiple Cylinder Misfire", "type": "confirmed"},
            {"code": "P0171", "desc": "System Too Lean (Bank 1)", "type": "confirmed"},
        ],
        "signals_summary": {"rpm": 780, "coolantTemp": 92, "batteryVoltage": "14.2", "engineLoad": 22},
        "health_score": 78,
        "mileage": 68210,
    }
    r = client.post(f"{API}/reports", json=payload, headers=auth, timeout=120)
    assert r.status_code == 200, r.text
    rep = r.json()
    assert "id" in rep and rep["vehicle"] == payload["vehicle"]
    assert rep["health_score"] == 78
    assert rep["dtcs"] == payload["dtcs"]
    assert "_id" not in rep and "user_id" not in rep
    assert isinstance(rep.get("ai_findings"), str) and len(rep["ai_findings"]) > 10
    rid = rep["id"]

    # list newest first, should contain new report first
    r = client.get(f"{API}/reports", headers=auth, timeout=30)
    assert r.status_code == 200
    lst = r.json()
    assert len(lst) == len(initial) + 1
    assert lst[0]["id"] == rid
    assert "_id" not in lst[0] and "user_id" not in lst[0]

    # get single
    r = client.get(f"{API}/reports/{rid}", headers=auth, timeout=30)
    assert r.status_code == 200
    single = r.json()
    assert single["id"] == rid
    assert single["ai_findings"] == rep["ai_findings"]
    assert "_id" not in single and "user_id" not in single

    # get unknown -> 404
    r = client.get(f"{API}/reports/does-not-exist-xyz", headers=auth, timeout=30)
    assert r.status_code == 404



# ---- VIN Decode (new in iteration 4) ----
def test_vin_decode_requires_auth(client):
    r = client.post(f"{API}/vin/decode", json={"vin": "1C4HJXEG9JW174532"})
    assert r.status_code == 401


def test_vin_decode_valid_jeep(client, auth):
    r = client.post(f"{API}/vin/decode", json={"vin": "1C4HJXEG9JW174532"}, headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["validFormat"] is True
    assert body["confidence"] > 0
    assert body.get("source") in ("nhtsa", "cache", "local")
    # Expect Jeep 2018 Wrangler (per NHTSA)
    make = (body.get("make") or "").upper()
    assert "JEEP" in make, f"expected JEEP in make, got {body.get('make')}"
    assert body.get("year") == 2018
    model = (body.get("model") or "").lower()
    assert "wrangler" in model, f"expected wrangler in model, got {body.get('model')}"
    # Optional enrichment fields — check presence, not exact value
    for key in ("trim", "engine", "transmission", "drivetrain", "plant"):
        assert key in body, f"missing enrichment key: {key}"


def test_vin_decode_invalid(client, auth):
    r = client.post(f"{API}/vin/decode", json={"vin": "BADVIN123"}, headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["validFormat"] is False
    assert body["confidence"] == 0
    # Should not crash and should not contain a real make/year
    assert body.get("checksumValid") in (False, None)


def test_vin_decode_cache_hit(client, auth):
    # First call may fetch from NHTSA; second should be same/cached response.
    payload = {"vin": "1C4HJXEG9JW174532"}
    r1 = client.post(f"{API}/vin/decode", json=payload, headers=auth, timeout=30)
    r2 = client.post(f"{API}/vin/decode", json=payload, headers=auth, timeout=30)
    assert r1.status_code == 200 and r2.status_code == 200
    b1, b2 = r1.json(), r2.json()
    assert b1.get("vin") == b2.get("vin")
    assert b1.get("make") == b2.get("make")
    assert b1.get("year") == b2.get("year")


# ---- VIN Decode body/manufacturer (iteration 5) ----
def test_vin_decode_returns_body_and_manufacturer(client, auth):
    r = client.post(f"{API}/vin/decode", json={"vin": "1C4HJXEG9JW174532"}, headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "bodyStyle" in body, f"missing bodyStyle: {body}"
    assert "manufacturer" in body, f"missing manufacturer: {body}"
    # If NHTSA succeeded, these should be non-empty
    if body.get("source") == "nhtsa":
        assert body.get("bodyStyle"), "expected non-empty bodyStyle from NHTSA"
        assert body.get("manufacturer"), "expected non-empty manufacturer from NHTSA"


# ---- Vehicle Profile / Upsert-by-VIN (iteration 5) ----
TEST_VIN_A = "1C4HJXEG9JW174532"
TEST_VIN_B = "1HGCM82633A004352"


@pytest.fixture(scope="session")
def upserted_vehicle(client, token):
    hdr = {"Authorization": f"Bearer {token}"}
    payload = {
        "vin": TEST_VIN_A,
        "nickname": "TEST_UpsertJeep",
        "mileage": 68000,
        "spec": {
            "make": "JEEP", "model": "Wrangler", "year": 2018, "trim": "Unlimited Sahara",
            "engine": "3.6L V6", "transmission": "8-speed", "drivetrain": "4WD",
            "bodyStyle": "SUV", "manufacturer": "FCA US LLC", "plant": "TOLEDO",
            "confidence": 0.95, "source": "nhtsa",
        },
    }
    r = client.post(f"{API}/vehicles/upsert-by-vin", json=payload, headers=hdr, timeout=30)
    assert r.status_code == 200, r.text
    body = r.json()
    yield body
    # Cleanup - delete any TEST_ vehicles at teardown
    vid = body.get("id")
    if vid:
        client.delete(f"{API}/vehicles/{vid}", headers=hdr)


def test_upsert_by_vin_creates_and_updates(client, auth):
    payload = {
        "vin": TEST_VIN_B,
        "nickname": f"TEST_Civic_{uuid.uuid4().hex[:6]}",
        "spec": {"make": "HONDA", "model": "Civic", "year": 2003, "bodyStyle": "SEDAN", "manufacturer": "HONDA OF AMERICA"},
    }
    r1 = client.post(f"{API}/vehicles/upsert-by-vin", json=payload, headers=auth, timeout=30)
    assert r1.status_code == 200, r1.text
    b1 = r1.json()
    assert b1["created"] is True
    assert b1["vin"] == TEST_VIN_B
    assert b1.get("bodyStyle") == "SEDAN"
    assert b1.get("manufacturer") == "HONDA OF AMERICA"
    assert "id" in b1 and "last_scan_at" in b1
    vid = b1["id"]
    ts1 = b1["last_scan_at"]

    # repeat -> created=False, same id, refreshed last_scan_at
    import time as _t
    _t.sleep(1.1)
    payload2 = {**payload, "mileage": 55555}
    r2 = client.post(f"{API}/vehicles/upsert-by-vin", json=payload2, headers=auth, timeout=30)
    assert r2.status_code == 200
    b2 = r2.json()
    assert b2["created"] is False
    assert b2["id"] == vid
    assert b2.get("mileage") == 55555
    assert b2["last_scan_at"] != ts1

    # cleanup
    client.delete(f"{API}/vehicles/{vid}", headers=auth)


def test_patch_vehicle_and_get_reflects(client, auth, upserted_vehicle):
    vid = upserted_vehicle["id"]
    new_name = f"TEST_Renamed_{uuid.uuid4().hex[:5]}"
    r = client.patch(f"{API}/vehicles/{vid}", json={"name": new_name, "mileage": 71234}, headers=auth, timeout=30)
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True

    g = client.get(f"{API}/vehicles/{vid}", headers=auth, timeout=30)
    assert g.status_code == 200
    body = g.json()
    assert body["name"] == new_name
    assert body["mileage"] == 71234
    # aggregated shape
    assert "history" in body and set(["maintenance", "parts", "dtc"]).issubset(body["history"].keys())
    assert "reports" in body and isinstance(body["reports"], list)


def test_patch_unknown_vehicle_404(client, auth):
    r = client.patch(f"{API}/vehicles/does-not-exist-xyz", json={"name": "x"}, headers=auth, timeout=30)
    assert r.status_code == 404


def test_history_add_all_kinds_and_invalid(client, auth, upserted_vehicle):
    vid = upserted_vehicle["id"]
    for kind, payload in [
        ("maintenance", {"title": "TEST_OilChange", "detail": "5W-30 full synthetic"}),
        ("parts", {"title": "TEST_AirFilter", "detail": "K&N drop-in"}),
        ("dtc", {"title": "P0300", "detail": "Random misfire cleared"}),
    ]:
        r = client.post(f"{API}/vehicles/{vid}/history/{kind}", json=payload, headers=auth, timeout=30)
        assert r.status_code == 200, f"{kind}: {r.text}"
        body = r.json()
        assert body["kind"] == kind
        assert body["title"] == payload["title"]
        assert "user_id" not in body and "_id" not in body

    # invalid kind
    r = client.post(f"{API}/vehicles/{vid}/history/bogus", json={"title": "x"}, headers=auth, timeout=30)
    assert r.status_code == 400

    # GET aggregates all three buckets
    g = client.get(f"{API}/vehicles/{vid}", headers=auth, timeout=30)
    assert g.status_code == 200
    hist = g.json()["history"]
    assert len(hist["maintenance"]) >= 1
    assert len(hist["parts"]) >= 1
    assert len(hist["dtc"]) >= 1


def test_health_sample_append_and_get(client, auth, upserted_vehicle):
    vid = upserted_vehicle["id"]
    for s in (81, 79, 84):
        r = client.post(f"{API}/vehicles/{vid}/health", json={"score": s}, headers=auth, timeout=30)
        assert r.status_code == 200
        assert r.json().get("ok") is True

    g = client.get(f"{API}/vehicles/{vid}", headers=auth, timeout=30)
    assert g.status_code == 200
    hh = g.json().get("health_history", [])
    assert len(hh) >= 3
    scores = [h["score"] for h in hh[-3:]]
    assert scores == [81, 79, 84]


def test_health_sample_unknown_vehicle_404(client, auth):
    r = client.post(f"{API}/vehicles/does-not-exist-xyz/health", json={"score": 50}, headers=auth, timeout=30)
    assert r.status_code == 404


def test_get_vehicle_unknown_404(client, auth):
    r = client.get(f"{API}/vehicles/does-not-exist-xyz", headers=auth, timeout=30)
    assert r.status_code == 404


def test_get_vehicle_aggregates_reports_by_vin(client, auth, upserted_vehicle):
    vid = upserted_vehicle["id"]
    vin = upserted_vehicle["vin"]
    # create a report whose vehicle.vin contains the upserted VIN (fresh so we know it exists)
    # Two report shapes: (a) vehicle-as-string containing VIN, (b) vehicle_id link
    payload_str = {
        "vehicle": f"2018 Jeep Wrangler VIN:{vin}",
        "dtcs": [{"code": "P0300", "desc": "Misfire", "type": "confirmed"}],
        "signals_summary": {"rpm": 780},
        "health_score": 82,
    }
    r = client.post(f"{API}/reports", json=payload_str, headers=auth, timeout=120)
    assert r.status_code == 200
    rid_str = r.json()["id"]

    payload_id = {
        "vehicle": "",
        "vehicle_id": vid,
        "dtcs": [{"code": "P0171", "desc": "Lean", "type": "confirmed"}],
        "signals_summary": {"rpm": 800},
        "health_score": 80,
    }
    r2 = client.post(f"{API}/reports", json=payload_id, headers=auth, timeout=120)
    assert r2.status_code == 200
    rid_id = r2.json()["id"]

    g = client.get(f"{API}/vehicles/{vid}", headers=auth, timeout=30)
    assert g.status_code == 200
    reports = g.json().get("reports", [])
    rep_ids = [rep.get("id") for rep in reports]
    assert rid_str in rep_ids, f"report by VIN string not found in {rep_ids}"
    assert rid_id in rep_ids, f"report by vehicle_id not found in {rep_ids}"
    # ensure Mongo _id was excluded
    for rep in reports:
        assert "_id" not in rep and "user_id" not in rep
