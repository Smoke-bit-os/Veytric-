"""Iteration 19 backend regression — VIN scanner increment.

Backend was NOT changed in this increment. This suite verifies:
  * /api/vehicles (auth-gated CRUD)
  * /api/vehicles/upsert-by-vin (auth-gated, {created:true/false}, dedup per user)
  * /api/vin/decode (invalid VIN rejected with reason, valid VIN decodes)
"""
import os
import uuid
import pytest
import requests

def _load_backend_url():
    url = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
    if not url:
        # Fall back to frontend/.env used by the running app
        try:
            with open("/app/frontend/.env") as f:
                for line in f:
                    if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                        url = line.split("=", 1)[1].strip()
                        break
        except FileNotFoundError:
            pass
    if not url:
        raise RuntimeError("EXPO_PUBLIC_BACKEND_URL not set")
    return url.rstrip("/")


BASE_URL = _load_backend_url()

# ---------- Auth helpers ----------

@pytest.fixture(scope="module")
def user_token():
    """Register a fresh user and return the bearer token."""
    email = f"TEST_scan_{uuid.uuid4().hex[:10]}@example.com"
    payload = {"name": "Scan Tester", "email": email, "password": "Jarvis2026!"}
    r = requests.post(f"{BASE_URL}/api/auth/register", json=payload, timeout=30)
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data or "access_token" in data, data
    token = data.get("token") or data.get("access_token")
    return token, email


@pytest.fixture
def auth_headers(user_token):
    token, _ = user_token
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- /api/vehicles ----------

class TestVehiclesAuth:
    def test_vehicles_requires_auth(self):
        r = requests.get(f"{BASE_URL}/api/vehicles", timeout=15)
        assert r.status_code in (401, 403), r.status_code

    def test_vehicles_list_empty_for_new_user(self, auth_headers):
        r = requests.get(f"{BASE_URL}/api/vehicles", headers=auth_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        # Accept either bare array or {vehicles:[...]}
        arr = data if isinstance(data, list) else data.get("vehicles", [])
        assert isinstance(arr, list)


# ---------- /api/vehicles/upsert-by-vin ----------

class TestUpsertByVin:
    VALID_VIN = "1HGCM82633A004352"  # Honda Accord — valid checksum

    def test_upsert_requires_auth(self):
        r = requests.post(
            f"{BASE_URL}/api/vehicles/upsert-by-vin",
            json={"vin": self.VALID_VIN, "spec": {}},
            timeout=15,
        )
        assert r.status_code in (401, 403), r.status_code

    def test_upsert_creates_then_updates(self, auth_headers):
        # First call creates (created:true)
        r1 = requests.post(
            f"{BASE_URL}/api/vehicles/upsert-by-vin",
            headers=auth_headers,
            json={"vin": self.VALID_VIN, "spec": {"make": "Honda", "model": "Accord", "year": 2003}},
            timeout=20,
        )
        assert r1.status_code == 200, r1.text
        body1 = r1.json()
        assert body1.get("created") is True, body1
        assert body1.get("vin") == self.VALID_VIN
        assert "_id" not in body1, "MongoDB _id must be stripped from response"
        vid = body1.get("id")
        assert vid

        # Second call same VIN → created:false (dedup per-user)
        r2 = requests.post(
            f"{BASE_URL}/api/vehicles/upsert-by-vin",
            headers=auth_headers,
            json={"vin": self.VALID_VIN, "spec": {"make": "Honda", "model": "Accord", "year": 2003}},
            timeout=20,
        )
        assert r2.status_code == 200, r2.text
        body2 = r2.json()
        assert body2.get("created") is False, body2

        # Verify in the list
        listing = requests.get(f"{BASE_URL}/api/vehicles", headers=auth_headers, timeout=15).json()
        arr = listing if isinstance(listing, list) else listing.get("vehicles", [])
        assert any((v.get("vin") or "").upper() == self.VALID_VIN for v in arr)

    def test_upsert_rejects_blank_vin(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/vehicles/upsert-by-vin",
            headers=auth_headers,
            json={"vin": "", "spec": {}},
            timeout=15,
        )
        assert r.status_code == 400, r.text


# ---------- /api/vin/decode ----------

class TestVinDecode:
    def test_decode_requires_auth(self):
        r = requests.post(f"{BASE_URL}/api/vin/decode", json={"vin": "1HGCM82633A004352"}, timeout=15)
        assert r.status_code in (401, 403), r.status_code

    def test_decode_rejects_invalid_vin_length(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/vin/decode", headers=auth_headers, json={"vin": "SHORTVIN"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("validFormat") is False
        assert body.get("source") == "invalid"
        assert body.get("reason"), "reason must be surfaced for user-facing message"

    def test_decode_rejects_forbidden_chars(self, auth_headers):
        # Includes I/O/Q which are illegal in a VIN
        r = requests.post(f"{BASE_URL}/api/vin/decode", headers=auth_headers, json={"vin": "IOQCM82633A004352"}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("validFormat") is False
        assert "I, O" in (body.get("reason") or "") or "Invalid" in (body.get("reason") or "")

    def test_decode_valid_vin(self, auth_headers):
        r = requests.post(f"{BASE_URL}/api/vin/decode", headers=auth_headers, json={"vin": "1HGCM82633A004352"}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("validFormat") is True
        assert body.get("vin") == "1HGCM82633A004352"
        # Source should be local or nhtsa; confidence numeric
        assert body.get("source") in ("local", "nhtsa"), body.get("source")
        assert isinstance(body.get("confidence"), (int, float))
