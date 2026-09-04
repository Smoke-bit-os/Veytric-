"""VEYTRIC — Google-only Authentication Correction Gate tests.

Run: cd /app/backend && python -m pytest tests/test_google_only_auth.py -v

Covers:
  - /auth/register and /auth/login are RETIRED (410) and never touch the DB.
  - /auth/session is the only credential source; session_token auth works.
  - Missing / bad / expired session_token -> 401 (never 403).
  - Replay: a used session token remains valid; an unknown one is rejected.
  - Strict per-user data isolation under the Google-only model.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import requests
from pymongo import MongoClient
from dotenv import load_dotenv

from _helpers import seed_session

load_dotenv("/app/backend/.env")
BASE = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/") + "/api"
mongo = MongoClient(os.environ["MONGO_URL"])
db = mongo[os.environ["DB_NAME"]]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------------------- Retired endpoints -----------------------------
def test_register_is_retired_410_no_db_write():
    email = f"{uuid.uuid4().hex}@x.com"
    r = requests.post(f"{BASE}/auth/register",
                      json={"name": "x", "email": email, "password": "whatever12"})
    assert r.status_code == 410
    assert "retired" in r.json()["detail"].lower()
    # No account created for this specific email (parallel-worker safe).
    assert db.users.count_documents({"email": email}) == 0


def test_login_is_retired_410_no_token():
    r = requests.post(f"{BASE}/auth/login", json={"email": "a@b.com", "password": "whatever12"})
    assert r.status_code == 410
    body = r.json()
    assert "token" not in body and "session_token" not in body
    assert body["detail"] == "This authentication method has been retired. Use Google Sign-In."


def test_retired_endpoints_do_not_enumerate():
    # Same generic message regardless of input — no account existence leak.
    r1 = requests.post(f"{BASE}/auth/login", json={"email": "known@x.com", "password": "x"})
    r2 = requests.post(f"{BASE}/auth/login", json={"email": "unknown@x.com", "password": "y"})
    assert r1.json()["detail"] == r2.json()["detail"]


# ---------------------------- Session auth works ----------------------------
def test_session_token_authenticates():
    _, token, uid = seed_session("GateUser")
    r = requests.get(f"{BASE}/auth/me", headers=_auth(token))
    assert r.status_code == 200
    assert r.json()["id"] == uid


def test_missing_token_401():
    assert requests.get(f"{BASE}/auth/me").status_code == 401


def test_unknown_token_401():
    assert requests.get(f"{BASE}/auth/me", headers=_auth("not-a-real-token")).status_code == 401


def test_legacy_jwt_no_longer_accepted():
    # A JWT-looking token (legacy email/password era) must be rejected now.
    fake_jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ4In0.sig"
    assert requests.get(f"{BASE}/auth/me", headers=_auth(fake_jwt)).status_code == 401


def test_expired_session_rejected():
    uid = f"user_{uuid.uuid4().hex[:12]}"
    token = f"expired_{uuid.uuid4().hex}"
    db.users.insert_one({"_id": uid, "name": "Exp", "email": f"{uid}@x.com", "auth_provider": "google"})
    db.user_sessions.insert_one({"session_token": token, "user_id": uid,
                                 "expires_at": datetime.now(timezone.utc) - timedelta(hours=1)})
    assert requests.get(f"{BASE}/auth/me", headers=_auth(token)).status_code == 401


# ---------------------------- Session exchange guard ------------------------
def test_session_exchange_rejects_garbage_session_id():
    r = requests.post(f"{BASE}/auth/session", json={"session_id": f"garbage_{uuid.uuid4().hex}"})
    assert r.status_code == 401  # Emergent rejects -> we return 401, no user created


# ---------------------------- Per-user isolation ----------------------------
def test_strict_user_isolation():
    _, tokA, uidA = seed_session("IsoA")
    _, tokB, uidB = seed_session("IsoB")
    # A creates a vehicle.
    v = requests.post(f"{BASE}/vehicles", headers=_auth(tokA),
                      json={"name": "A car", "make": "Ford", "model": "F150", "year": 2020})
    assert v.status_code == 200
    vidA = v.json()["id"]
    # B cannot list, fetch, or patch A's vehicle.
    listB = requests.get(f"{BASE}/vehicles", headers=_auth(tokB)).json()
    assert vidA not in [x.get("id") for x in listB]
    assert requests.get(f"{BASE}/vehicles/{vidA}", headers=_auth(tokB)).status_code in (403, 404)
    assert requests.patch(f"{BASE}/vehicles/{vidA}", headers=_auth(tokB),
                          json={"mileage": 1}).status_code in (403, 404)
    # A still sees it.
    assert vidA in [x.get("id") for x in requests.get(f"{BASE}/vehicles", headers=_auth(tokA)).json()]
