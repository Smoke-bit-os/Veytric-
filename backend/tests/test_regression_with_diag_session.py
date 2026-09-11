"""Prompt 2 Phase 2B regression: existing routes still work after a diagnostic
session + tasks + envelope are seeded for the same user (per review request).
"""
import os
import uuid

import requests
from dotenv import load_dotenv

from _helpers import seed_session

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def _seed_session_with_task(tok):
    s = requests.post(f"{BASE}/diagnostic-sessions", json={"label": "reg"}, headers=_h(tok))
    assert s.status_code == 200, s.text
    sid = s.json()["id"]
    t = requests.post(f"{BASE}/diagnostic-sessions/{sid}/tasks",
                      json={"task_type": "READ_VEHICLE_EVIDENCE"}, headers=_h(tok))
    assert t.status_code == 200, t.text
    tid = t.json()["id"]
    for to in ("VALIDATING", "ACQUIRING_EVIDENCE", "NORMALIZING", "COMPLETED"):
        r = requests.patch(f"{BASE}/diagnostic-sessions/{sid}/tasks/{tid}",
                           json={"to_state": to}, headers=_h(tok))
        assert r.status_code == 200, r.text
    r = requests.put(f"{BASE}/diagnostic-sessions/{sid}/tasks/{tid}/envelope",
                     json={"schema_version": 1, "generated_at": 1,
                           "records": [{"evidenceId": "e", "provenanceLabel": "MEASURED",
                                        "decodedName": "RPM", "displayValue": 800}],
                           "unavailable_items": []},
                     headers=_h(tok))
    assert r.status_code == 200, r.text
    return sid, tid


def test_vehicles_crud_regression_after_session():
    _, tok, _ = seed_session("REG")
    _seed_session_with_task(tok)

    # CREATE via upsert-by-vin
    vin = "1FAFP404" + uuid.uuid4().hex[:9].upper()
    r = requests.post(f"{BASE}/vehicles/upsert-by-vin",
                      json={"vin": vin, "make": "Ford", "model": "Mustang", "year": 2020},
                      headers=_h(tok))
    assert r.status_code == 200, r.text
    vid = r.json()["id"]
    assert r.json()["vin"] == vin

    # LIST includes it
    r = requests.get(f"{BASE}/vehicles", headers=_h(tok))
    assert r.status_code == 200
    assert any(v["id"] == vid for v in r.json())

    # GET single
    r = requests.get(f"{BASE}/vehicles/{vid}", headers=_h(tok))
    assert r.status_code == 200
    assert r.json()["vin"] == vin

    # PATCH mileage
    r = requests.patch(f"{BASE}/vehicles/{vid}",
                       json={"mileage": 55000}, headers=_h(tok))
    assert r.status_code == 200

    # Verify persisted
    r = requests.get(f"{BASE}/vehicles/{vid}", headers=_h(tok))
    assert r.json()["mileage"] == 55000

    # DELETE
    r = requests.delete(f"{BASE}/vehicles/{vid}", headers=_h(tok))
    assert r.status_code == 200
    # 404 after delete
    r = requests.get(f"{BASE}/vehicles/{vid}", headers=_h(tok))
    assert r.status_code == 404


def test_scans_list_regression_after_session():
    _, tok, _ = seed_session("REG")
    _seed_session_with_task(tok)
    r = requests.get(f"{BASE}/scans", headers=_h(tok))
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_subscription_regression_after_session():
    _, tok, _ = seed_session("REG")
    _seed_session_with_task(tok)
    r = requests.get(f"{BASE}/subscription", headers=_h(tok))
    assert r.status_code == 200
    body = r.json()
    assert body.get("entitlement", {}).get("tier") == "free"


def test_shop_fleet_regression_after_session():
    _, tok, _ = seed_session("REG")
    _seed_session_with_task(tok)
    # Promote to shop tier (dev-only).
    r = requests.post(f"{BASE}/subscription/developer/set",
                      json={"action": "shop"}, headers=_h(tok))
    assert r.status_code == 200
    r = requests.get(f"{BASE}/shop/fleet", headers=_h(tok))
    assert r.status_code == 200
    body = r.json()
    assert "vehicles" in body
    assert "summary" in body
