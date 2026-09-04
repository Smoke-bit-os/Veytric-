#!/usr/bin/env python3
"""Seed a stable Google test session so automated tests can exercise the
authed API surface WITHOUT real Google OAuth (which cannot run headless).

Idempotent. Upserts a Google user + a 30-day user_sessions row with a known
session_token. Use the token as: Authorization: Bearer <TOKEN>.

    python scripts/seed_test_session.py
"""
import os
import asyncio
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

TEST_USER_ID = "user_test_google01"
TEST_EMAIL = "veytric.tester@gmail.com"
TEST_TOKEN = "test_session_token_veytric_qa_001"

client = AsyncIOMotorClient(os.environ["MONGO_URL"])
db = client[os.environ["DB_NAME"]]


async def main():
    await db.users.update_one(
        {"_id": TEST_USER_ID},
        {"$set": {"_id": TEST_USER_ID, "name": "VEYTRIC Tester", "email": TEST_EMAIL,
                  "auth_provider": "google", "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )
    await db.user_sessions.update_one(
        {"session_token": TEST_TOKEN},
        {"$set": {"session_token": TEST_TOKEN, "user_id": TEST_USER_ID,
                  "created_at": datetime.now(timezone.utc),
                  "expires_at": datetime.now(timezone.utc) + timedelta(days=30)}},
        upsert=True,
    )
    print("seeded Google test session")
    print(f"  user_id       : {TEST_USER_ID}")
    print(f"  email         : {TEST_EMAIL}")
    print(f"  session_token : {TEST_TOKEN}")
    print(f"  header        : Authorization: Bearer {TEST_TOKEN}")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
