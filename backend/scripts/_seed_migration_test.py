#!/usr/bin/env python3
"""Preview-only: seed one legacy + one Google user with owned records to
verify the backup/purge flow. NOT for production."""
import os, asyncio
from pathlib import Path
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")
client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]


async def main():
    # Legacy email/password user (no auth_provider).
    await db.users.update_one({"_id": "legacy_test_1"}, {"$set": {
        "_id": "legacy_test_1", "name": "Legacy Bob", "email": "legacy_bob@example.com",
        "password": "$2b$hashed", "created_at": "2025-01-01T00:00:00Z"}}, upsert=True)
    # Google user (kept).
    await db.users.update_one({"_id": "user_google_1"}, {"$set": {
        "_id": "user_google_1", "name": "Google Gina", "email": "gina@gmail.com",
        "auth_provider": "google", "created_at": "2026-01-01T00:00:00Z"}}, upsert=True)
    # Owned records for both.
    await db.vehicles.update_one({"id": "v_legacy"}, {"$set": {"id": "v_legacy", "user_id": "legacy_test_1", "make": "Ford"}}, upsert=True)
    await db.vehicles.update_one({"id": "v_google"}, {"$set": {"id": "v_google", "user_id": "user_google_1", "make": "Tesla"}}, upsert=True)
    await db.scans.update_one({"_id": "s_legacy"}, {"$set": {"_id": "s_legacy", "user_id": "legacy_test_1"}}, upsert=True)
    await db.scans.update_one({"_id": "s_google"}, {"$set": {"_id": "s_google", "user_id": "user_google_1"}}, upsert=True)
    await db.user_sessions.update_one({"session_token": "tok_google"}, {"$set": {"session_token": "tok_google", "user_id": "user_google_1"}}, upsert=True)
    print("seeded legacy_test_1 (legacy) + user_google_1 (google) with owned records")
    client.close()

asyncio.run(main())
