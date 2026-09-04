"""Security regression tests for VEYTRIC (Google-only auth model).

Run: cd /app/backend && python -m pytest tests/test_security.py -v

Covers SEC-002 (developer endpoint dev-only), SEC-003 (AI Cloud quota / rate /
prompt-size limits + managed-key metering), and P3 hardening (voice upload
auth/extension, VIN regex safety). Auth is Google-only: tests mint a Google
session directly in Mongo (see _helpers.seed_session) and use it as a Bearer
token — there is no email/password path anymore.
"""
import os
import time
import uuid

import pytest
import requests
from datetime import datetime, timezone
from pymongo import MongoClient
from dotenv import load_dotenv

from _helpers import seed_session

load_dotenv("/app/backend/.env")

BASE = "http://localhost:8001/api"
mongo = MongoClient(os.environ["MONGO_URL"])
db = mongo[os.environ["DB_NAME"]]


def _month():
    n = datetime.now(timezone.utc)
    return f"{n.year:04d}-{n.month:02d}"


def _register():
    """Compat shim: returns (email, token, uid) from a seeded Google session."""
    return seed_session("Sec")


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ------------------------------- Auth basics --------------------------------
def test_valid_token_accepted():
    _, token, _ = _register()
    assert requests.get(f"{BASE}/auth/me", headers=_auth(token)).status_code == 200


def test_no_token_rejected():
    assert requests.get(f"{BASE}/auth/me").status_code in (401, 403)


def test_unknown_token_rejected():
    assert requests.get(f"{BASE}/auth/me", headers=_auth("garbage")).status_code == 401


# --------------------------- SEC-002 Dev endpoint ---------------------------
def test_developer_set_enabled_in_development():
    assert os.environ.get("APP_ENV") == "development"
    _, token, _ = _register()
    r = requests.post(f"{BASE}/subscription/developer/set", headers=_auth(token), json={"action": "pro"})
    assert r.status_code == 200
    assert r.json()["entitlement"]["tier"] == "pro"


def test_free_user_cannot_self_upgrade_without_dev_or_purchase():
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


@pytest.mark.parametrize("method,path,body", [
    ("post", "/reports", {"scan_data": {}, "vehicle": "Jeep"}),
    ("post", "/diagnostics/interpret", {"kind": "system", "title": "Engine", "vehicle": "Jeep", "context": {}}),
])
def test_all_managed_ai_endpoints_enforce_quota(method, path, body):
    _, token, uid = _register()
    db.ai_usage.update_one({"user_id": uid, "month": _month()},
                           {"$set": {"requests_used": 20, "provider": "cloud"}}, upsert=True)
    r = getattr(requests, method)(f"{BASE}{path}", headers=_auth(token), json=body)
    assert r.status_code == 429
    assert r.json()["detail"]["code"] == "cloud_quota_exceeded"


def test_pro_bypasses_quota_on_guarded_endpoint():
    _, token, uid = _register()
    db.ai_usage.update_one({"user_id": uid, "month": _month()},
                           {"$set": {"requests_used": 999, "provider": "cloud"}}, upsert=True)
    requests.post(f"{BASE}/subscription/developer/set", headers=_auth(token), json={"action": "pro"})
    r = requests.post(f"{BASE}/diagnostics/interpret", headers=_auth(token),
                      json={"kind": "system", "title": "Engine", "vehicle": "Jeep", "context": {}})
    assert r.status_code == 200


# ------------------------------- P3 Hardening -------------------------------
def test_voice_transcribe_requires_auth():
    assert requests.post(f"{BASE}/voice/transcribe").status_code in (401, 403)


def test_voice_rejects_unsupported_extension():
    _, token, _ = _register()
    files = {"file": ("evil.exe", b"MZ\x90\x00", "application/octet-stream")}
    r = requests.post(f"{BASE}/voice/transcribe", headers=_auth(token), files=files)
    assert r.status_code == 415


def test_vin_regex_input_is_safe():
    _, token, _ = _register()
    v = requests.post(f"{BASE}/vehicles/upsert-by-vin", headers=_auth(token),
                      json={"vin": "1C4(((|||.*", "nickname": "Test", "year": 2020, "make": "Jeep", "model": "X"})
    if v.status_code == 200:
        vid = v.json().get("id") or v.json().get("_id")
        start = time.time()
        r = requests.get(f"{BASE}/vehicles/{vid}", headers=_auth(token))
        assert r.status_code in (200, 404)
        assert time.time() - start < 5  # no ReDoS hang
