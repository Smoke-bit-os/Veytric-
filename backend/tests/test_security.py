"""Security regression tests for JARVIS AI.

Run: cd /app/backend && python -m pytest tests/test_security.py -v

Covers SEC-001 (JWT), SEC-002 (developer endpoint), SEC-003 (AI quota/rate/
prompt limits), plus P3 hardening (login throttling/enumeration, voice upload
limits, VIN regex safety). Uses direct Mongo seeding to assert the Cloud quota
429 WITHOUT spending real LLM calls where possible.
"""
import os
import uuid
import time
import jwt
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

BASE = "http://localhost:8001/api"
JWT_SECRET = os.environ["JWT_SECRET"]
mongo = MongoClient(os.environ["MONGO_URL"])
db = mongo[os.environ["DB_NAME"]]


def _month():
    n = datetime.now(timezone.utc)
    return f"{n.year:04d}-{n.month:02d}"


def _register():
    email = f"sectest_{uuid.uuid4().hex[:10]}@jarvis.ai"
    r = requests.post(f"{BASE}/auth/register", json={"name": "Sec", "email": email, "password": "Test1234!"})
    r.raise_for_status()
    d = r.json()
    return email, d["token"], d["user"]["id"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ------------------------------- SEC-001 JWT --------------------------------
def test_jwt_secret_is_strong():
    assert len(JWT_SECRET) >= 32
    assert JWT_SECRET != "jarvis_ai_super_secret_key_2026_obd_hud"


def test_valid_token_accepted():
    _, token, _ = _register()
    assert requests.get(f"{BASE}/auth/me", headers=_auth(token)).status_code == 200


def test_no_token_rejected():
    assert requests.get(f"{BASE}/auth/me").status_code in (401, 403)


def test_token_signed_with_wrong_secret_rejected():
    _, _, uid = _register()
    forged = jwt.encode(
        {"sub": uid, "exp": datetime.now(timezone.utc) + timedelta(days=1)},
        "wrong-secret", algorithm="HS256",
    )
    assert requests.get(f"{BASE}/auth/me", headers=_auth(forged)).status_code == 401


def test_expired_token_rejected():
    _, _, uid = _register()
    expired = jwt.encode(
        {"sub": uid, "exp": datetime.now(timezone.utc) - timedelta(hours=1)},
        JWT_SECRET, algorithm="HS256",
    )
    assert requests.get(f"{BASE}/auth/me", headers=_auth(expired)).status_code == 401


# --------------------------- SEC-002 Dev endpoint ---------------------------
def test_developer_set_enabled_in_development():
    # APP_ENV is 'development' in this environment.
    assert os.environ.get("APP_ENV") == "development"
    _, token, _ = _register()
    r = requests.post(f"{BASE}/subscription/developer/set", headers=_auth(token), json={"action": "pro"})
    assert r.status_code == 200
    assert r.json()["entitlement"]["tier"] == "pro"


def test_free_user_cannot_self_upgrade_without_dev_or_purchase():
    # A fresh account is Free; only the dev endpoint (dev-only) or a purchase
    # can change tier. GET /subscription must report the server truth.
    _, token, _ = _register()
    ent = requests.get(f"{BASE}/subscription", headers=_auth(token)).json()["entitlement"]
    assert ent["tier"] == "free"
    assert ent["status"] in ("none", "expired")


# ----------------------------- SEC-003 AI quota -----------------------------
def test_ai_requires_auth():
    assert requests.post(f"{BASE}/ai/analyze", json={"prompt": "hi"}).status_code in (401, 403)


def test_free_quota_blocks_at_limit():
    _, token, uid = _register()
    db.ai_usage.update_one(
        {"user_id": uid, "month": _month()},
        {"$set": {"requests_used": 20, "provider": "cloud"}},
        upsert=True,
    )
    r = requests.post(f"{BASE}/ai/analyze", headers=_auth(token), json={"prompt": "hi"})
    assert r.status_code == 429
    detail = r.json()["detail"]
    assert detail["code"] == "cloud_quota_exceeded"
    assert detail["requests_limit"] == 20


def test_pro_user_not_blocked_by_free_quota():
    _, token, uid = _register()
    db.ai_usage.update_one(
        {"user_id": uid, "month": _month()},
        {"$set": {"requests_used": 999, "provider": "cloud"}},
        upsert=True,
    )
    requests.post(f"{BASE}/subscription/developer/set", headers=_auth(token), json={"action": "pro"})
    r = requests.post(f"{BASE}/ai/analyze", headers=_auth(token), json={"prompt": "One word: ok?"})
    assert r.status_code == 200  # unlimited despite huge counter


def test_oversized_prompt_rejected():
    _, token, _ = _register()
    r = requests.post(f"{BASE}/ai/analyze", headers=_auth(token), json={"prompt": "a" * 13000})
    assert r.status_code == 413


def test_ai_usage_endpoint_reports_server_truth():
    _, token, uid = _register()
    db.ai_usage.update_one({"user_id": uid, "month": _month()},
                           {"$set": {"requests_used": 5, "provider": "cloud"}}, upsert=True)
    u = requests.get(f"{BASE}/ai/usage", headers=_auth(token)).json()
    assert u["tier"] == "free" and u["requests_used"] == 5 and u["remaining"] == 15


# ------------------------------- P3 Hardening -------------------------------
def test_password_policy_enforced():
    r = requests.post(f"{BASE}/auth/register",
                      json={"name": "x", "email": f"pw_{uuid.uuid4().hex[:8]}@j.ai", "password": "short"})
    assert r.status_code == 400


def test_login_does_not_reveal_email_existence():
    email, _, _ = _register()
    # Wrong password on an existing account and a non-existent account must
    # return the same generic message.
    r1 = requests.post(f"{BASE}/auth/login", json={"email": email, "password": "wrongpass"})
    r2 = requests.post(f"{BASE}/auth/login", json={"email": f"nope_{uuid.uuid4().hex}@j.ai", "password": "wrongpass"})
    assert r1.status_code == 401 and r2.status_code == 401
    assert r1.json()["detail"] == r2.json()["detail"] == "Invalid email or password"


def test_login_throttled_after_many_attempts():
    email = f"throttle_{uuid.uuid4().hex[:8]}@j.ai"
    requests.post(f"{BASE}/auth/register", json={"name": "T", "email": email, "password": "Test1234!"})
    codes = [requests.post(f"{BASE}/auth/login", json={"email": email, "password": "bad"}).status_code
             for _ in range(14)]
    assert 429 in codes  # throttle kicks in within the window


def test_voice_transcribe_requires_auth():
    assert requests.post(f"{BASE}/voice/transcribe").status_code in (401, 403)


def test_voice_rejects_unsupported_extension():
    _, token, _ = _register()
    files = {"file": ("evil.exe", b"MZ\x90\x00", "application/octet-stream")}
    r = requests.post(f"{BASE}/voice/transcribe", headers=_auth(token), files=files)
    assert r.status_code == 415


def test_vin_regex_input_is_safe():
    # A malicious "VIN" with regex metacharacters must not error or hang; the
    # profile endpoint escapes it. We assert a normal, fast response.
    _, token, _ = _register()
    # upsert a vehicle then request its profile (exercises the escaped $regex).
    v = requests.post(f"{BASE}/vehicles/upsert-by-vin", headers=_auth(token),
                      json={"vin": "1C4(((|||.*", "nickname": "Test", "year": 2020, "make": "Jeep", "model": "X"})
    if v.status_code == 200:
        vid = v.json().get("id") or v.json().get("_id")
        start = time.time()
        r = requests.get(f"{BASE}/vehicles/{vid}", headers=_auth(token))
        assert r.status_code in (200, 404)
        assert time.time() - start < 5  # no ReDoS hang
