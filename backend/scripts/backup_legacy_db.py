#!/usr/bin/env python3
"""VEYTRIC — Legacy database backup (Google-only migration, step 1).

Creates a complete, access-restricted snapshot of the database BEFORE any
legacy (non-Google) user is retired. Records per-collection counts and a
SHA-256 checksum, and writes a manifest so the backup can be proven recoverable.

Usage:
    python scripts/backup_legacy_db.py [--out /path/to/backup_dir]

Output:
    <out>/veytric_legacy_backup_<UTC-timestamp>/
        <collection>.json         # full documents (bson extended json)
        MANIFEST.json             # counts + per-file sha256 + total checksum

Run this against PRODUCTION from your deployment panel (with prod MONGO_URL /
DB_NAME) — the preview environment only has the local test database.
The backup dir is written with 0700 and files 0600 (restricted access).
"""
import os
import sys
import json
import hashlib
import argparse
import asyncio
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
from bson import json_util

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

# Every collection VEYTRIC uses (identity + user-owned + sessions).
COLLECTIONS = [
    "users", "user_sessions", "vehicles", "vehicle_history", "vehicle_reports",
    "scans", "reports", "recordings", "messages", "ai_usage",
]


def _sha256_bytes(b: bytes) -> str:
    h = hashlib.sha256()
    h.update(b)
    return h.hexdigest()


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "backups"))
    args = ap.parse_args()

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_dir = Path(args.out) / f"veytric_legacy_backup_{ts}"
    out_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(out_dir, 0o700)

    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]

    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "db_name": DB_NAME,
        "collections": {},
        "total_documents": 0,
    }
    combined = hashlib.sha256()

    for coll in COLLECTIONS:
        docs = await db[coll].find({}).to_list(length=None)
        payload = json_util.dumps(docs, indent=2).encode("utf-8")
        fpath = out_dir / f"{coll}.json"
        fpath.write_bytes(payload)
        os.chmod(fpath, 0o600)
        checksum = _sha256_bytes(payload)
        combined.update(checksum.encode())
        manifest["collections"][coll] = {
            "count": len(docs),
            "file": fpath.name,
            "sha256": checksum,
            "bytes": len(payload),
        }
        manifest["total_documents"] += len(docs)
        print(f"  backed up {coll}: {len(docs)} docs  sha256={checksum[:16]}…")

    manifest["backup_checksum"] = combined.hexdigest()
    mpath = out_dir / "MANIFEST.json"
    mpath.write_text(json.dumps(manifest, indent=2))
    os.chmod(mpath, 0o600)

    client.close()
    print(f"\n✅ Backup complete: {out_dir}")
    print(f"   total documents: {manifest['total_documents']}")
    print(f"   backup checksum : {manifest['backup_checksum']}")
    print(f"   manifest        : {mpath}")


if __name__ == "__main__":
    asyncio.run(main())
