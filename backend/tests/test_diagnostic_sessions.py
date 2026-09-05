"""VEYTRIC — Prompt 2 Phase 2B: Diagnostic Session Persistence tests.

Run: cd /app/backend && python -m pytest tests/test_diagnostic_sessions.py -v

Covers:
  - Session/task/envelope CRUD (server-derived ownership only).
  - Strict per-user isolation — another user's resources return 404.
  - Idempotency — repeated create/transition requests never duplicate
    sessions, tasks, evidence, or audit events.
  - Server-side state-machine validation — illegal transitions rejected (409),
    terminal states immutable, cancellation allowed from any active state.
  - Append-only audit trail + restart recovery (full-session read).
  - No fabricated vehicle data (evidence stored verbatim + ownership-stamped).
"""
import os
import uuid

import requests
from dotenv import load_dotenv

from _helpers import seed_session

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")
BASE = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "http://localhost:8001").rstrip("/") + "/api"


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _mk_session(token, **kw):
    r = requests.post(f"{BASE}/diagnostic-sessions", json=kw, headers=_auth(token))
    assert r.status_code == 200, r.text
    return r.json()


def _mk_task(token, sid, task_type="READ_VEHICLE_EVIDENCE", **kw):
    r = requests.post(f"{BASE}/diagnostic-sessions/{sid}/tasks",
                      json={"task_type": task_type, **kw}, headers=_auth(token))
    assert r.status_code == 200, r.text
    return r.json()


def _patch(token, sid, tid, to_state, **kw):
    return requests.patch(f"{BASE}/diagnostic-sessions/{sid}/tasks/{tid}",
                          json={"to_state": to_state, **kw}, headers=_auth(token))


# --------------------------------------------------------------------------- #
# Auth guards
# --------------------------------------------------------------------------- #
def test_requires_auth():
    assert requests.post(f"{BASE}/diagnostic-sessions", json={}).status_code == 401
    assert requests.get(f"{BASE}/diagnostic-sessions").status_code == 401
    r = requests.post(f"{BASE}/diagnostic-sessions", json={},
                      headers=_auth("garbage_token_xyz"))
    assert r.status_code == 401


# --------------------------------------------------------------------------- #
# Session + task + envelope happy path
# --------------------------------------------------------------------------- #
def test_session_task_envelope_lifecycle():
    _, tok, uid = seed_session("A")
    s = _mk_session(tok, label="lifecycle")
    sid = s["id"]
    assert s["state"] == "active"
    assert "user_id" not in s  # ownership never leaked to the client

    t = _mk_task(tok, sid, required_capability="vehicle.live_pid")
    tid = t["id"]
    assert t["state"] == "CREATED"
    assert t["task_id"] == tid

    # A legal forward path.
    for to in ("VALIDATING", "ACQUIRING_EVIDENCE", "NORMALIZING", "COMPLETED"):
        r = _patch(tok, sid, tid, to)
        assert r.status_code == 200, r.text
        assert r.json()["state"] == to

    # Envelope persisted (records stored verbatim; ownership stamped server-side).
    env = {
        "schema_version": 1, "generated_at": 123,
        "records": [{"evidenceId": "e1", "provenanceLabel": "MEASURED",
                     "decodedName": "RPM", "displayValue": 812}],
        "unavailable_items": [{"name": "boost", "reason": "unsupported"}],
    }
    r = requests.put(f"{BASE}/diagnostic-sessions/{sid}/tasks/{tid}/envelope",
                     json=env, headers=_auth(tok))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["records"][0]["userId"] == uid          # server-derived owner
    assert body["records"][0]["displayValue"] == 812      # not fabricated/altered
    assert body["unavailable_items"][0]["reason"] == "unsupported"

    r = requests.get(f"{BASE}/diagnostic-sessions/{sid}/tasks/{tid}/envelope",
                     headers=_auth(tok))
    assert r.status_code == 200
    assert r.json()["records"][0]["decodedName"] == "RPM"


# --------------------------------------------------------------------------- #
# Ownership isolation — another user's resources are 404 (no disclosure)
# --------------------------------------------------------------------------- #
def test_cross_user_isolation_returns_404():
    _, tok_a, _ = seed_session("A")
    _, tok_b, _ = seed_session("B")
    s = _mk_session(tok_a, label="private")
    sid = s["id"]
    t = _mk_task(tok_a, sid)
    tid = t["id"]

    # User B cannot see or touch user A's session/task.
    assert requests.get(f"{BASE}/diagnostic-sessions/{sid}",
                        headers=_auth(tok_b)).status_code == 404
    assert requests.get(f"{BASE}/diagnostic-sessions/{sid}/tasks",
                        headers=_auth(tok_b)).status_code == 404
    assert requests.get(f"{BASE}/diagnostic-sessions/{sid}/tasks/{tid}",
                        headers=_auth(tok_b)).status_code == 404
    assert _patch(tok_b, sid, tid, "VALIDATING").status_code == 404
    r = requests.put(f"{BASE}/diagnostic-sessions/{sid}/tasks/{tid}/envelope",
                     json={"records": []}, headers=_auth(tok_b))
    assert r.status_code == 404

    # B's session list never includes A's session.
    lst = requests.get(f"{BASE}/diagnostic-sessions", headers=_auth(tok_b)).json()
    assert all(x["id"] != sid for x in lst)


def test_client_supplied_owner_is_ignored():
    """A user_id / owner field in the body must NOT override server ownership."""
    _, tok, uid = seed_session("A")
    r = requests.post(f"{BASE}/diagnostic-sessions",
                      json={"label": "x", "user_id": "user_ATTACKER",
                            "owner": "user_ATTACKER"}, headers=_auth(tok))
    assert r.status_code == 200
    sid = r.json()["id"]
    # It still belongs to the real user (visible + listable to them).
    assert requests.get(f"{BASE}/diagnostic-sessions/{sid}",
                        headers=_auth(tok)).status_code == 200


# --------------------------------------------------------------------------- #
# Idempotency — no duplicates on repeated requests
# --------------------------------------------------------------------------- #
def test_session_idempotency():
    _, tok, _ = seed_session("A")
    key = f"idem_{uuid.uuid4().hex}"
    a = _mk_session(tok, idempotency_key=key)
    b = _mk_session(tok, idempotency_key=key)
    assert a["id"] == b["id"]  # same session returned, not duplicated


def test_task_idempotency():
    _, tok, _ = seed_session("A")
    sid = _mk_session(tok)["id"]
    key = f"idem_{uuid.uuid4().hex}"
    a = _mk_task(tok, sid, idempotency_key=key)
    b = _mk_task(tok, sid, idempotency_key=key)
    assert a["id"] == b["id"]
    lst = requests.get(f"{BASE}/diagnostic-sessions/{sid}/tasks",
                       headers=_auth(tok)).json()
    assert len([x for x in lst if x["id"] == a["id"]]) == 1


def test_transition_idempotency_no_duplicate_audit():
    _, tok, _ = seed_session("A")
    sid = _mk_session(tok)["id"]
    tid = _mk_task(tok, sid)["id"]
    key = f"idem_{uuid.uuid4().hex}"
    r1 = _patch(tok, sid, tid, "VALIDATING", idempotency_key=key)
    r2 = _patch(tok, sid, tid, "VALIDATING", idempotency_key=key)  # replay
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["state"] == "VALIDATING" == r2.json()["state"]
    # Audit has exactly one CREATED + one VALIDATING entry (no dupes).
    full = requests.get(f"{BASE}/diagnostic-sessions/{sid}/tasks/{tid}",
                        headers=_auth(tok)).json()
    val_events = [a for a in full["audit"] if a["to_state"] == "VALIDATING"]
    assert len(val_events) == 1


# --------------------------------------------------------------------------- #
# Server-side state-machine validation
# --------------------------------------------------------------------------- #
def test_illegal_transition_rejected():
    _, tok, _ = seed_session("A")
    sid = _mk_session(tok)["id"]
    tid = _mk_task(tok, sid)["id"]
    # CREATED -> COMPLETED is illegal (must go through VALIDATING first).
    r = _patch(tok, sid, tid, "COMPLETED")
    assert r.status_code == 409


def test_unknown_state_and_task_type_rejected():
    _, tok, _ = seed_session("A")
    sid = _mk_session(tok)["id"]
    tid = _mk_task(tok, sid)["id"]
    assert _patch(tok, sid, tid, "NOT_A_STATE").status_code == 400
    r = requests.post(f"{BASE}/diagnostic-sessions/{sid}/tasks",
                      json={"task_type": "BOGUS"}, headers=_auth(tok))
    assert r.status_code == 400


def test_terminal_state_is_immutable():
    _, tok, _ = seed_session("A")
    sid = _mk_session(tok)["id"]
    tid = _mk_task(tok, sid)["id"]
    _patch(tok, sid, tid, "VALIDATING")
    assert _patch(tok, sid, tid, "UNAVAILABLE",
                  unavailable_reason="disconnected").status_code == 200
    # Cannot leave a terminal state.
    assert _patch(tok, sid, tid, "COMPLETED").status_code == 409
    assert _patch(tok, sid, tid, "VALIDATING").status_code == 409
    # Same-terminal is an idempotent no-op (200).
    assert _patch(tok, sid, tid, "UNAVAILABLE").status_code == 200


def test_cancel_from_active_state():
    _, tok, _ = seed_session("A")
    sid = _mk_session(tok)["id"]
    tid = _mk_task(tok, sid)["id"]
    _patch(tok, sid, tid, "VALIDATING")
    _patch(tok, sid, tid, "ACQUIRING_EVIDENCE")
    r = _patch(tok, sid, tid, "CANCELLED")
    assert r.status_code == 200 and r.json()["state"] == "CANCELLED"


# --------------------------------------------------------------------------- #
# Restart recovery + audit trail
# --------------------------------------------------------------------------- #
def test_restart_recovery_full_session():
    _, tok, _ = seed_session("A")
    sid = _mk_session(tok, label="recover")["id"]
    t1 = _mk_task(tok, sid)["id"]
    t2 = _mk_task(tok, sid, task_type="EXPLAIN_CODE")["id"]
    _patch(tok, sid, t1, "VALIDATING")
    _patch(tok, sid, t1, "ACQUIRING_EVIDENCE")
    # A fresh client reads the whole session and recovers current task states.
    full = requests.get(f"{BASE}/diagnostic-sessions/{sid}", headers=_auth(tok)).json()
    states = {x["id"]: x["state"] for x in full["tasks"]}
    assert states[t1] == "ACQUIRING_EVIDENCE"
    assert states[t2] == "CREATED"


def test_audit_is_append_only_ordered():
    _, tok, _ = seed_session("A")
    sid = _mk_session(tok)["id"]
    tid = _mk_task(tok, sid)["id"]
    _patch(tok, sid, tid, "VALIDATING")
    _patch(tok, sid, tid, "NORMALIZING")
    _patch(tok, sid, tid, "COMPLETED")
    full = requests.get(f"{BASE}/diagnostic-sessions/{sid}/tasks/{tid}",
                        headers=_auth(tok)).json()
    trail = [a["to_state"] for a in full["audit"]]
    assert trail == ["CREATED", "VALIDATING", "NORMALIZING", "COMPLETED"]


def test_vehicle_ownership_enforced_on_session_create():
    _, tok_a, _ = seed_session("A")
    _, tok_b, _ = seed_session("B")
    # A creates a vehicle via the existing upsert-by-vin path.
    vin = "1HGCM82633A" + uuid.uuid4().hex[:6].upper()
    r = requests.post(f"{BASE}/vehicles/upsert-by-vin",
                      json={"vin": vin, "make": "Honda", "model": "Accord"},
                      headers=_auth(tok_a))
    assert r.status_code == 200, r.text
    vid = r.json()["id"]
    # B cannot open a diagnostic session against A's vehicle.
    r = requests.post(f"{BASE}/diagnostic-sessions", json={"vehicle_id": vid},
                      headers=_auth(tok_b))
    assert r.status_code == 404
    # A can.
    r = requests.post(f"{BASE}/diagnostic-sessions", json={"vehicle_id": vid},
                      headers=_auth(tok_a))
    assert r.status_code == 200
