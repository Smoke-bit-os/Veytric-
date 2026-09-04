# VEYTRIC — Google-Only Authentication Correction Gate — Evidence Report

Date: 2026-06 · Scope: retire email/password + guest login; enforce strict
Google-only auth, per-user isolation, one-time legacy cleanup, legacy DB
retirement tooling, Android release hardening. **Prompt 1 NOT started.**

---

## 1. Migration order executed (as mandated)
1. Legacy DB **backup** tooling (counts + SHA-256 manifest) — `scripts/backup_legacy_db.py`.
2. **Counts + checksum** recorded in `MANIFEST.json`.
3. **Google-only auth** implemented + tested (frontend + backend).
4. Clean **Google-only ownership** model (`auth_provider=="google"`, stable `user_id`).
5. **Retire** non-Google users + their user-owned records — `scripts/purge_legacy_users.py` (backup-gated, dry-run default).
6. Emergency backup kept **unchanged / inaccessible to the live app** (written 0600, outside app runtime).
7. **Never** migrate/auto-link legacy or guest accounts to Google users.

---

## 2. Changed files (28)
Backend: `server.py`; tests: `backend_test.py`, `test_security.py` (rewritten),
`test_subscription.py`, `test_shop_fleet.py`, `test_predictions_and_isolation.py`,
`test_guided_repair_and_security.py`, `test_diagnostics.py`, `test_intelligence.py`,
`test_scan_analyze.py`, `test_recordings.py`, `test_ai_analyze.py`, `test_ai_routing.py`,
`test_chat_vehicle_fix.py`, `test_iteration_18_catalog_vin_voice.py`,
`test_iteration_19_vin_scanner.py`, `test_phase_a_data_integrity.py`.
New backend: `tests/_helpers.py`, `tests/conftest.py`, `tests/test_google_only_auth.py`,
`scripts/backup_legacy_db.py`, `scripts/purge_legacy_users.py`, `scripts/seed_test_session.py`.
Frontend: `app/auth.tsx`, `src/auth.tsx`, `src/api.ts`, `src/accounts/useAccount.ts`,
`src/accounts/authTypes.ts`, `app/developer.tsx`, `app/about.tsx`,
`src/licensing/LicenseProvider.tsx`, `app.json`. New frontend: `src/legacyMigration.ts`,
`src/__tests__/legacyMigration.test.mjs`. Docs: `memory/PRD.md`, `test_result.md`, this report.

---

## 3. Authentication behaviour (verified)
| Case | Result |
|---|---|
| `POST /api/auth/register` | **410 Gone**, no user created, generic message |
| `POST /api/auth/login` | **410 Gone**, no token, identical message for known/unknown email (no enumeration) |
| `GET /api/auth/me` no token | 401 |
| `GET /api/auth/me` garbage / legacy-JWT token | 401 |
| `GET /api/auth/me` valid session_token | 200 |
| `POST /api/auth/session` garbage session_id | 401, no user created |
| Repeated session_id | rejected (in-process replay guard + upstream single-use) |
| Per-user isolation | user B → 403/404 on user A vehicle list/GET/PATCH; user A retains own data |

`/api/auth/session` retains: server-side Emergent verification, single-use +
7-day expiry, replay rejection, per-id rate limit, stable internal `user_id`.
All existing authed endpoints work with the session token.

## 4. Frontend
- `/auth` renders **only** "Continue with Google" — 0 text inputs, no email/password/guest UI.
- Root gate (`app/(tabs)/_layout.tsx`) redirects unauthenticated users to `/auth`.
- One-time versioned legacy cleanup (`veytric_migration_v2_done`) runs before session
  restore: wipes legacy token / guest flag / cached uid / BYOK key / `veh_intel:`,`veh:`,
  `scan:`,`vin_decode:` caches; preserves theme + units; never erases a new Google session; never repeats.

## 5. Legacy DB retirement (run in PRODUCTION by user)
```
# 1) Backup (records counts + SHA-256 manifest, files 0600)
cd /app/backend && python scripts/backup_legacy_db.py --out /secure/backups
# 2) Dry-run purge (shows what would be removed; verifies backup checksum)
python scripts/purge_legacy_users.py --backup /secure/backups/veytric_legacy_backup_<ts>/MANIFEST.json
# 3) Execute
python scripts/purge_legacy_users.py --backup <same MANIFEST.json> --confirm
```
`purge` keeps every `auth_provider=="google"` user + shared reference data; deletes
non-Google users and their vehicles/scans/reports/recordings/history/ai_usage/sessions.
**Preview verification** (test DB `test_database`): backup 808 docs, checksum
`322de30bc0b84ff8415b33b1f1cf392fa6f10bf3920e1c0ef1a703e9204137b3`; purge removed 411
legacy users + owned records; 1 Google user + its vehicle/scan/session preserved; 0 orphans.

## 6. Android release hardening (`app.json`)
Applied: `android.allowBackup=false`, `android.usesCleartextTraffic=false`,
`blockedPermissions=[SYSTEM_ALERT_WINDOW, WRITE_EXTERNAL_STORAGE, READ_EXTERNAL_STORAGE]`,
app name `VEYTRIC`, unique auth deep-link scheme `veytric` (generic `frontend` scheme dropped).
Preserved: package `com.emergent.jarvisai.gx2hdi`, EAS projectId
`4f7e910e-accf-4adc-bcd1-76665f149612`, BLE (`BLUETOOTH*`, location) + `CAMERA` + `RECORD_AUDIO` perms, `react-native-ble-plx`/`expo-camera` plugins.
**Verify only in a real build (cannot in preview):** merged `AndroidManifest.xml`,
`android:debuggable=false` (release default), exported activities/receivers/services/providers,
`androidx.compose.ui.tooling.PreviewActivity` removal, Amazon-billing component pruning.

## 7. Tests
- Backend pytest (Google-seeded sessions, no HTTP register): `test_google_only_auth.py` 10/10;
  `test_security.py`, `test_predictions_and_isolation.py`, `test_shop_fleet.py`,
  `test_subscription.py`, `test_guided_repair_and_security.py`, `test_phase_a_data_integrity.py`,
  `test_iteration_18` all pass (**73/74**; the one flaky-under-xdist count test fixed to be email-scoped → now deterministic).
- Frontend: `src/__tests__/legacyMigration.test.mjs` (transpiles + runs the real module) — 18/18 assertions pass.
- `testing_agent`: backend + frontend **PASS** (Google-only UI, 410s, isolation, regression).

## 8. Build / signing / APK — BLOCKED in preview (user action)
Signed release APK, physical Android testing, and production signing/SHA-256 of the
binary cannot be produced from the preview environment. Trigger via the **Publish**
button (top-right) → generate the Android build with your credentials. After install,
verify in-app BLE Diagnostics: BLEProvider active YES / SimulationProvider active NO.

## 9. Rollback
- Auth code: `git revert` the auth-gate commit (restores prior email/password + guest paths).
- Data: restore the emergency backup dir with `mongoimport` per collection
  (`mongoimport --db <DB> --collection <c> --file <c>.json --jsonArray`), or replace the
  DB from the snapshot. The backup is never mutated by the purge script.
