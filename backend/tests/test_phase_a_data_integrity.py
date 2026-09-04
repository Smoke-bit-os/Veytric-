"""Phase A — Production Data Integrity tests.

Covers:
- /api/vehicles/{id}/predictions tiered model (UNAVAILABLE vs GENERAL_INDUSTRY_INTERVAL)
- upsert-by-vin must NOT stamp last_scan_at on the vehicle
- Dashboard.lastScan is null for a freshly added vehicle
- DELETE /api/scans/{id} is user-scoped (User B cannot delete User A's scan)
"""
import os
import time
import uuid
import pytest
import requests
from _helpers import seed_session

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not set in frontend/.env")

API = f"{BASE_URL}/api"


def _register(prefix: str):
    email, tok, uid = seed_session(prefix)
    return tok, email


def _hdrs(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def _upsert_vehicle(tok, vin=None, mileage=None):
    vin = vin or f"1TEST{uuid.uuid4().hex[:12].upper()}"[:17]
    body = {"vin": vin, "spec": {"make": "TEST", "model": "Sample", "year": 2020}}
    if mileage is not None:
        body["mileage"] = mileage
    r = requests.post(f"{API}/vehicles/upsert-by-vin", json=body, headers=_hdrs(tok), timeout=20)
    assert r.status_code == 200, f"upsert-by-vin {r.status_code} {r.text}"
    return r.json()


# ------------------------ Predictions tiered model -----------------------------

class TestPredictionsTiered:
    def test_no_mileage_no_history_all_unavailable(self):
        tok, _ = _register("pred_unavail")
        veh = _upsert_vehicle(tok)  # no mileage
        vid = veh["id"]
        r = requests.get(f"{API}/vehicles/{vid}/predictions", headers=_hdrs(tok), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("mileage") is None
        assert data.get("mileageKnown") is False
        items = data.get("items") or []
        assert len(items) > 0, "predictions items must exist"
        for it in items:
            assert it["source"] == "UNAVAILABLE", f"{it['key']} source={it['source']} expected UNAVAILABLE"
            assert it["remainingLifePct"] is None, f"{it['key']} fabricated remainingLifePct={it['remainingLifePct']}"
            assert it["dueMileage"] is None
            assert it["urgency"] in ("unknown", "inspect", "test")

    def test_mileage_only_general_industry(self):
        tok, _ = _register("pred_general")
        veh = _upsert_vehicle(tok)
        vid = veh["id"]
        r = requests.patch(f"{API}/vehicles/{vid}", json={"mileage": 82000}, headers=_hdrs(tok), timeout=20)
        assert r.status_code == 200, r.text

        r = requests.get(f"{API}/vehicles/{vid}/predictions", headers=_hdrs(tok), timeout=20)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("mileage") == 82000
        assert data.get("mileageKnown") is True
        items = data.get("items") or []
        assert len(items) > 0

        # Never fabricate remainingLifePct
        for it in items:
            assert it["remainingLifePct"] is None, (
                f"{it['key']} has fabricated remainingLifePct={it['remainingLifePct']} without evidence"
            )

        by_key = {it["key"]: it for it in items}
        # Battery -> TEST_ONLY, Brakes -> DIRECT_INSPECT (both UNAVAILABLE without evidence/history)
        if "battery" in by_key:
            assert by_key["battery"]["source"] == "UNAVAILABLE"
            assert by_key["battery"]["urgency"] == "test"
        if "brakes" in by_key:
            assert by_key["brakes"]["source"] == "UNAVAILABLE"
            assert by_key["brakes"]["urgency"] == "inspect"

        # Other maintenance items (oil, coolant, plugs, air, trans, alternator w/o evidence)
        # must be GENERAL_INDUSTRY_INTERVAL with unknown urgency and NO dueMileage
        general_items = [it for it in items if it["key"] not in ("battery", "brakes")]
        assert len(general_items) > 0, "expected some general-interval items"
        for it in general_items:
            assert it["source"] == "GENERAL_INDUSTRY_INTERVAL", (
                f"{it['key']} source={it['source']} expected GENERAL_INDUSTRY_INTERVAL"
            )
            assert it["urgency"] == "unknown", f"{it['key']} urgency={it['urgency']} expected unknown"
            assert it["dueMileage"] is None, f"{it['key']} fabricated dueMileage={it['dueMileage']}"
            # remainingKm may be null OR a number, but life-percentage MUST be null
            assert it["remainingLifePct"] is None


# ------------------------ upsert-by-vin last_scan integrity --------------------

class TestUpsertNoLastScan:
    def test_upsert_does_not_set_last_scan_and_dashboard_lastScan_null(self):
        tok, _ = _register("nolastscan")
        veh = _upsert_vehicle(tok, mileage=1000)
        # The returned vehicle must NOT contain a last_scan_at field
        assert "last_scan_at" not in veh, f"upsert-by-vin leaked last_scan_at: {veh}"
        assert "_id" not in veh, "MongoDB _id should be stripped"

        # Dashboard.lastScan must be null (no scan records yet)
        r = requests.get(f"{API}/vehicles/{veh['id']}/dashboard", headers=_hdrs(tok), timeout=20)
        assert r.status_code == 200, r.text
        dash = r.json()
        assert dash.get("lastScan") is None, f"lastScan should be null on fresh vehicle, got {dash.get('lastScan')}"
        assert dash.get("counts", {}).get("scans", 0) == 0


# ------------------------ DELETE /api/scans/{id} user-scoped -------------------

def _create_scan(tok, vehicle_id):
    """Persist a scan record via POST /api/scans (structured, no AI wait)."""
    body = {
        "vehicle_id": vehicle_id,
        "vin": "",
        "vehicle": "TEST 2020 Sample",
        "workflow": "full",
        "modules": [],
        "dtcs": [{"code": "P0300", "description": "Random Misfire"}],
        "readiness": [],
        "systems": [],
        "metrics": {},
        "overall_score": 80,
    }
    return requests.post(f"{API}/scans", json=body, headers=_hdrs(tok), timeout=30)


class TestScanDeleteScoped:
    def test_user_b_cannot_delete_user_a_scan(self):
        tok_a, _ = _register("scan_a")
        tok_b, _ = _register("scan_b")

        veh_a = _upsert_vehicle(tok_a)
        r = _create_scan(tok_a, veh_a["id"])
        assert r.status_code == 200, f"POST /scans failed {r.status_code} {r.text}"
        scan_id = r.json().get("id") or r.json().get("_id")
        assert scan_id, f"missing scan id in create response: {r.json()}"

        # User B tries to delete User A's scan. Endpoint always returns ok:true (fine),
        # but the scan must still exist for user A.
        r_del_b = requests.delete(f"{API}/scans/{scan_id}", headers=_hdrs(tok_b), timeout=20)
        assert r_del_b.status_code == 200, r_del_b.text
        assert r_del_b.json() == {"ok": True}

        # Verify the scan is still listed for user A
        rs2 = requests.get(f"{API}/scans", headers=_hdrs(tok_a), timeout=20)
        assert rs2.status_code == 200
        ids_a = [s.get("id") or s.get("_id") for s in rs2.json()]
        assert scan_id in ids_a, "User B was able to delete User A's scan!"

        # Now User A deletes their own scan
        r_del_a = requests.delete(f"{API}/scans/{scan_id}", headers=_hdrs(tok_a), timeout=20)
        assert r_del_a.status_code == 200
        assert r_del_a.json() == {"ok": True}

        # It must no longer appear
        rs3 = requests.get(f"{API}/scans", headers=_hdrs(tok_a), timeout=20)
        assert rs3.status_code == 200
        ids_a2 = [s.get("id") or s.get("_id") for s in rs3.json()]
        assert scan_id not in ids_a2, "scan still present after owner delete"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
