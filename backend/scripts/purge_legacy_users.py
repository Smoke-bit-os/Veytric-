#!/usr/bin/env python3
"""VEYTRIC — Retire legacy (non-Google) users (Google-only migration, step 5).

Removes every legacy email/password (and any non-Google) user AND all of their
user-owned records from the ACTIVE database. Verified Google users are never
touched. Shared automotive reference data is not stored in the DB (vPIC is
external), so nothing shared is affected.

SAFETY:
  * Refuses to run unless a verified backup MANIFEST is supplied and its
    recorded checksum re-verifies against the backup files on disk.
  * Dry-run by default. Pass --confirm to actually delete.
  * Never migrates, links, or reassigns legacy data to Google accounts.

A user is considered GOOGLE (kept) iff  auth_provider == "google".
Everything else (legacy password users, provider missing/other) is retired.

Usage:
    # dry run (shows what would be removed)
    python scripts/purge_legacy_users.py --backup backups/veytric_legacy_backup_XXXX/MANIFEST.json

    # execute
    python scripts/purge_legacy_users.py --backup .../MANIFEST.json --confirm
"""
import os
import sys
import json
import hashlib
import argparse
import asyncio
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

# Collections keyed by user_id that belong to a single user.
USER_OWNED = [
    "vehicles", "vehicle_history", "vehicle_reports", "scans", "reports",
    "recordings", "messages", "ai_usage", "user_sessions",
]


def verify_backup(manifest_path: Path) -> dict:
    if not manifest_path.exists():
        print(f"❌ Backup manifest not found: {manifest_path}")
        sys.exit(2)
    manifest = json.loads(manifest_path.read_text())
    bdir = manifest_path.parent
    combined = hashlib.sha256()
    for coll, info in manifest["collections"].items():
        fpath = bdir / info["file"]
        if not fpath.exists():
            print(f"❌ Backup file missing: {fpath}")
            sys.exit(2)
        digest = hashlib.sha256(fpath.read_bytes()).hexdigest()
        if digest != info["sha256"]:
            print(f"❌ Checksum mismatch for {coll}: backup is NOT intact. Aborting.")
            sys.exit(2)
        combined.update(digest.encode())
    if combined.hexdigest() != manifest.get("backup_checksum"):
        print("❌ Overall backup checksum mismatch. Aborting.")
        sys.exit(2)
    print(f"✅ Backup verified recoverable: {manifest['total_documents']} docs, "
          f"checksum {manifest['backup_checksum'][:16]}…")
    return manifest


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backup", required=True, help="Path to a verified backup MANIFEST.json")
    ap.add_argument("--confirm", action="store_true", help="Actually delete (default is dry-run)")
    args = ap.parse_args()

    verify_backup(Path(args.backup))

    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    total_users = await db.users.count_documents({})
    google_users = await db.users.count_documents({"auth_provider": "google"})
    legacy_cursor = db.users.find({"auth_provider": {"$ne": "google"}})
    legacy = await legacy_cursor.to_list(length=None)
    legacy_ids = [u["_id"] for u in legacy]

    print(f"\nUsers total: {total_users} | Google (KEEP): {google_users} | "
          f"legacy (RETIRE): {len(legacy_ids)}")

    if not legacy_ids:
        print("Nothing to retire. Active DB is already Google-only.")
        client.close()
        return

    # Count owned records that would be removed.
    owned_counts = {}
    for coll in USER_OWNED:
        owned_counts[coll] = await db[coll].count_documents({"user_id": {"$in": legacy_ids}})
    print("Legacy user-owned records:")
    for coll, n in owned_counts.items():
        print(f"  {coll}: {n}")

    if not args.confirm:
        print("\n(dry-run) Re-run with --confirm to delete the above. No changes made.")
        client.close()
        return

    # Execute deletion: owned records first, then user identities.
    for coll in USER_OWNED:
        res = await db[coll].delete_many({"user_id": {"$in": legacy_ids}})
        print(f"  deleted {res.deleted_count} from {coll}")
    res = await db.users.delete_many({"_id": {"$in": legacy_ids}})
    print(f"  deleted {res.deleted_count} legacy user identities")

    # Post-conditions.
    remaining_legacy = await db.users.count_documents({"auth_provider": {"$ne": "google"}})
    remaining_google = await db.users.count_documents({"auth_provider": "google"})
    orphan = 0
    for coll in USER_OWNED:
        orphan += await db[coll].count_documents({"user_id": {"$in": legacy_ids}})
    print(f"\n✅ Purge complete. Remaining Google users: {remaining_google} | "
          f"remaining legacy users: {remaining_legacy} | orphaned legacy records: {orphan}")
    if remaining_legacy or orphan:
        print("⚠️  Post-condition not clean — investigate before proceeding.")
    client.close()


if __name__ == "__main__":
    asyncio.run(main())
