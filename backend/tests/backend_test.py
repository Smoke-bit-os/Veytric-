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
