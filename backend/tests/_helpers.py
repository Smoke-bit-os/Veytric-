"""Shared test helper for the Google-only auth model.

VEYTRIC retired email/password + guest login. Tests can no longer register via
HTTP, so they mint a Google session DIRECTLY in Mongo (exactly what
POST /auth/session would create) and use the returned session_token as a
Bearer token. This is test-only seeding — the app itself has no such path.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")

_mongo = MongoClient(os.environ["MONGO_URL"])
_db = _mongo[os.environ["DB_NAME"]]


def seed_session(name: str = "T", email: str | None = None):
    """Create a Google user + a 30-day session row. Returns (email, token, uid)."""
    uid = f"user_{uuid.uuid4().hex[:12]}"
    email = email or f"qa_{uuid.uuid4().hex[:10]}@veytric-test.com"
    token = f"qatok_{uuid.uuid4().hex}"
    _db.users.update_one(
        {"_id": uid},
        {"$set": {"_id": uid, "name": name, "email": email,
                  "auth_provider": "google",
                  "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    _db.user_sessions.update_one(
        {"session_token": token},
        {"$set": {"session_token": token, "user_id": uid,
                  "created_at": datetime.now(timezone.utc),
                  "expires_at": datetime.now(timezone.utc) + timedelta(days=30)}},
        upsert=True,
    )
    return email, token, uid
