"""
Backend tests for JARVIS Licensing & Subscription Platform v1.0
- /api/subscription (GET)
- /api/subscription/start-trial (POST)
- /api/subscription/restore (POST) — stub 'not_configured'
- /api/subscription/validate (POST) — stub 'not_configured'
- /api/subscription/developer/set (POST) — dev-only tier simulator
- Auth regression: register/login/me now include `entitlement`
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://jarvis-ai-1486.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


# --------------------------- fixtures ---------------------------------------
@pytest.fixture(scope="module")
def user_session():
    """Fresh registered user for the whole module."""
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    email = f"TEST_lic_{uuid.uuid4().hex[:10]}@jarvis.ai"
    r = s.post(f"{API}/auth/register",
               json={"name": "TEST Licensing", "email": email, "password": "TestPass123!"})
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    body = r.json()
    token = body["token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return {"session": s, "email": email, "user": body["user"], "token": token}


@pytest.fixture(scope="module")
def dev_reset(user_session):
    """Ensure clean state after class."""
    yield
    try:
        user_session["session"].post(f"{API}/subscription/developer/set", json={"action": "clear"})
    except Exception:
        pass


# --------------------------- auth regression --------------------------------
class TestAuthEntitlementRegression:
    def test_register_returns_entitlement(self):
        email = f"TEST_reg_{uuid.uuid4().hex[:10]}@jarvis.ai"
        r = requests.post(f"{API}/auth/register",
                          json={"name": "TEST Reg", "email": email, "password": "TestPass123!"})
        assert r.status_code == 200, r.text
        u = r.json()["user"]
        assert "entitlement" in u, "user object must include entitlement"
        e = u["entitlement"]
        assert e["tier"] == "free"
        assert e["status"] == "none"
        assert e["trialUsed"] is False
        assert e["trialDaysRemaining"] == 0
        assert e["inGrace"] is False

    def test_login_returns_entitlement(self):
        email = f"TEST_login_{uuid.uuid4().hex[:10]}@jarvis.ai"
        password = "TestPass123!"
        requests.post(f"{API}/auth/register",
                      json={"name": "TEST L", "email": email, "password": password})
        r = requests.post(f"{API}/auth/login", json={"email": email, "password": password})
        assert r.status_code == 200
        assert "entitlement" in r.json()["user"]
        assert r.json()["user"]["entitlement"]["tier"] == "free"

    def test_me_returns_entitlement(self, user_session):
        r = user_session["session"].get(f"{API}/auth/me")
        assert r.status_code == 200
        assert "entitlement" in r.json()


# --------------------------- /subscription GET ------------------------------
class TestGetSubscription:
    def test_unauth_returns_401(self):
        r = requests.get(f"{API}/subscription")
        assert r.status_code == 401 or r.status_code == 403

    def test_default_free_entitlement(self):
        # Fresh user
        email = f"TEST_sub_{uuid.uuid4().hex[:10]}@jarvis.ai"
        reg = requests.post(f"{API}/auth/register",
                            json={"name": "TEST", "email": email, "password": "TestPass123!"})
        tok = reg.json()["token"]
        r = requests.get(f"{API}/subscription", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        body = r.json()
        assert "entitlement" in body
        assert body["entitlement"]["tier"] == "free"
        assert body["entitlement"]["status"] == "none"
        assert body["trialDays"] == 30
        assert body["graceDays"] == 3
        assert body["env"] == "development"


# --------------------------- /start-trial -----------------------------------
class TestStartTrial:
    def test_start_trial_and_duplicate(self):
        email = f"TEST_trial_{uuid.uuid4().hex[:10]}@jarvis.ai"
        reg = requests.post(f"{API}/auth/register",
                            json={"name": "TEST", "email": email, "password": "TestPass123!"})
        tok = reg.json()["token"]
        H = {"Authorization": f"Bearer {tok}"}

        r = requests.post(f"{API}/subscription/start-trial", headers=H)
        assert r.status_code == 200, r.text
        e = r.json()["entitlement"]
        assert e["tier"] == "pro"
        assert e["status"] == "trial"
        assert e["trialUsed"] is True
        assert 28 <= e["trialDaysRemaining"] <= 30

        # Verify persistence via GET /subscription
        g = requests.get(f"{API}/subscription", headers=H)
        assert g.status_code == 200
        assert g.json()["entitlement"]["status"] == "trial"
        assert g.json()["entitlement"]["tier"] == "pro"

        # Second attempt should fail 400
        r2 = requests.post(f"{API}/subscription/start-trial", headers=H)
        assert r2.status_code == 400
        assert "already used" in r2.json().get("detail", "").lower()

    def test_start_trial_unauth(self):
        r = requests.post(f"{API}/subscription/start-trial")
        assert r.status_code in (401, 403)


# --------------------------- restore / validate stubs ------------------------
class TestRestoreValidateStubs:
    def test_restore_not_configured(self, user_session):
        r = user_session["session"].post(f"{API}/subscription/restore")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "not_configured"
        assert "entitlement" in body

    def test_validate_not_configured(self, user_session):
        r = user_session["session"].post(f"{API}/subscription/validate")
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "not_configured"
        assert body["valid"] is False
        assert "entitlement" in body


# --------------------------- developer set ----------------------------------
class TestDeveloperSet:
    """Verify computed entitlement per action + persistence via GET."""

    def _new_user(self):
        email = f"TEST_dev_{uuid.uuid4().hex[:10]}@jarvis.ai"
        reg = requests.post(f"{API}/auth/register",
                            json={"name": "TEST DEV", "email": email, "password": "TestPass123!"})
        return {"Authorization": f"Bearer {reg.json()['token']}"}, email

    def _set(self, H, action):
        r = requests.post(f"{API}/subscription/developer/set",
                          headers={**H, "Content-Type": "application/json"},
                          json={"action": action})
        assert r.status_code == 200, f"{action}: {r.status_code} {r.text}"
        return r.json()["entitlement"]

    def test_action_shop(self):
        H, _ = self._new_user()
        e = self._set(H, "shop")
        assert e["tier"] == "shop"
        assert e["status"] == "active"
        assert e["inGrace"] is False

    def test_action_grace(self):
        H, _ = self._new_user()
        e = self._set(H, "grace")
        # subscription_end is in past, grace_period_end in future -> inGrace, status='grace', tier stays pro
        assert e["inGrace"] is True
        assert e["tier"] == "pro"
        assert e["status"] == "grace"

    def test_action_expired(self):
        H, _ = self._new_user()
        e = self._set(H, "expired")
        assert e["tier"] == "free"
        assert e["status"] == "expired"
        assert e["inGrace"] is False

    def test_action_trial(self):
        H, _ = self._new_user()
        e = self._set(H, "trial")
        assert e["tier"] == "pro"
        assert e["status"] == "trial"
        assert e["trialUsed"] is True
        assert 28 <= e["trialDaysRemaining"] <= 30

    def test_action_pro(self):
        H, _ = self._new_user()
        e = self._set(H, "pro")
        assert e["tier"] == "pro"
        assert e["status"] == "active"

    def test_action_free(self):
        H, _ = self._new_user()
        self._set(H, "pro")
        e = self._set(H, "free")
        assert e["tier"] == "free"
        assert e["status"] == "none"

    def test_action_clear(self):
        H, _ = self._new_user()
        self._set(H, "trial")
        e = self._set(H, "clear")
        assert e["tier"] == "free"
        assert e["status"] == "none"
        assert e["trialUsed"] is False

    def test_action_reset_trial(self):
        H, _ = self._new_user()
        # Use up the trial via start-trial
        r = requests.post(f"{API}/subscription/start-trial", headers=H)
        assert r.status_code == 200
        # Reset
        e = self._set(H, "reset_trial")
        assert e["trialUsed"] is False
        # Can start trial again
        r2 = requests.post(f"{API}/subscription/start-trial", headers=H)
        assert r2.status_code == 200, r2.text

    def test_unknown_action_400(self, user_session):
        r = user_session["session"].post(f"{API}/subscription/developer/set",
                                         json={"action": "bogus"})
        assert r.status_code == 400

    def test_persistence_via_get(self):
        H, _ = self._new_user()
        self._set(H, "shop")
        g = requests.get(f"{API}/subscription", headers=H)
        assert g.status_code == 200
        assert g.json()["entitlement"]["tier"] == "shop"


# --------------------------- vehicle regression -----------------------------
class TestVehiclesRegression:
    def test_list_and_add_vehicle(self, user_session):
        s = user_session["session"]
        r = s.get(f"{API}/vehicles")
        assert r.status_code == 200
        assert isinstance(r.json(), list)
        add = s.post(f"{API}/vehicles",
                     json={"name": "TEST Car", "make": "Toyota", "model": "Camry",
                           "year": 2020, "vin": "", "engine": "2.5L I4"})
        assert add.status_code == 200
        vid = add.json()["id"]
        # cleanup
        s.delete(f"{API}/vehicles/{vid}")
