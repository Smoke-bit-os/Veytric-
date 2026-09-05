# VEYTRIC — PROMPT R/0/1 FINAL APK CORRECTION & ACCEPTANCE GATE
Correction of the independent APK static audit (v1.0.9 / code 119 / SHA-256
`bb41b86a…03cce0`). Additive only. Prompt 2 NOT started.

## Executive summary
All code-side audit findings are corrected in-source: (1) app label is `VEYTRIC`
(exact caps) in `app.json`; (2) the exported Compose `PreviewActivity` and (3) the
RevenueCat **Amazon** billing components are removed at prebuild via a new Expo
config plugin (`plugins/withVeytricAndroidHardening.js`); (4) legacy-migration
coverage extended (v3) to every legacy `jarvis_*` key with a full storage inventory;
(5) backend 410 retirement, Google session security, and account isolation are proven
by automated tests; (6) the Prompt 1 foundation compiles + passes direct module tests
and its runtime boundary is documented honestly (not yet screen-wired — that is
Prompt 2). **Signed APK build and physical-device testing are environmentally
BLOCKED** and marked PENDING below.

- **Git checkpoint (before)**: `veytric-aptr-correction-checkpoint` @ `70a5ca0`.
- **Prompt 1 report (downloadable)**: `/app/PROMPT1_COMPLETION_REPORT.md` (incl. the
  runtime-integration matrix, §K).

## 2. Android application label
`app.json expo.name = "VEYTRIC"` (exact uppercase). The v1.0.9 APK's "Veytric" came
from the earlier name value; the launcher/recents/app-info/notification labels derive
from `expo.name`, so the next build renders `VEYTRIC`. Login/About/splash already show
`VEYTRIC`. Package ID, signing identity, Expo/EAS identity, backend host, storage keys
unchanged. `JarvisAutoAI.com` contact left as-is (awaiting approved VEYTRIC email/domain).
→ Final merged-resource verification: **PENDING SIGNED ANDROID BUILD**.

## 3. Compose PreviewActivity (exported)
`plugins/withVeytricAndroidHardening.js` filters `androidx.compose.ui.tooling.PreviewActivity`
out of the merged manifest and, as a fallback if a transitive dep re-adds it, forces
`android:exported="false"`. It runs at prebuild (survives regeneration; no manual
`/android` edits). The required launcher activity is untouched.
→ Merged-manifest/APK proof: **PENDING SIGNED ANDROID BUILD**.

## 4. Amazon billing components
Source: `react-native-purchases@10.9.0` bundles Amazon IAP. This release targets
Google Play, so the plugin removes `com.amazon.device.iap.ResponseReceiver` and
`com.revenuecat.purchases.amazon.purchasing.ProxyAmazonBillingActivity` from the merged
manifest. No VEYTRIC code references Amazon billing (grep: none). Google Play Billing +
RevenueCat Google path are unaffected (JS `react-native-purchases` API unchanged).
→ Absence-in-APK proof + billing regression on-device: **PENDING SIGNED ANDROID BUILD**.

## 5. Legacy cache migration coverage
Full persistent-storage inventory (grep of `src/**`):
| Key / namespace | Store | Class | Migration action |
|---|---|---|---|
| `jarvis_token` | SecureStore | legacy identity | removed |
| `jarvis_guest` | Async | legacy identity | removed |
| `jarvis_current_uid` | Async | legacy identity | removed |
| `jarvis_openai_api_key` | SecureStore | legacy BYOK secret | removed (re-entry required) |
| `jarvis_openai_model` | Async | legacy AI config | removed (v3) |
| `jarvis_local_ai_url` | Async | legacy AI config | removed (v3) |
| `jarvis_local_ai_model` | Async | legacy AI config | removed (v3) |
| `jarvis_dev_unlocked` | Async | legacy dev state | removed (v3) |
| `jarvis_trial_reminders` | Async | user-owned (old identity) | removed (v3) |
| `jarvis_ai_provider_type` | Async | **safe device preference** | preserved |
| `veh_intel:` / `veh:` / `scan:` / `vin_decode:` | Async | user-owned caches | cleared |
| license/subscription cache | Async | user-owned | cleared on login (`auth.clearLocalUserData`) |
| RevenueCat identity | runtime | commercial | rebound at login; not persisted identity |
| `theme` / `units` | Async | safe preference | preserved |
| Performance exports (PDF/CSV) | FileSystem doc dir | temporary/exported | user-initiated ephemeral; documented, not identity data |
Migration flag bumped `veytric_migration_v2_done` → **`veytric_migration_v3_done`**
(runs exactly once for the added keys, before auth restoration). Proven by
`frontend/src/__tests__/legacyMigration.test.mjs` (runs-once / removes-legacy /
no-repeat / preserves new session + safe prefs).

## 6. Retired backend auth — PROVEN
`server.py`: `/api/auth/register` and `/api/auth/login` return **410 Gone**, no password
check, no token, no DB write, generic non-enumerating message
("This authentication method has been retired. Use Google Sign-In."). `/api/auth/session`
active for Google. Tests: `backend/tests/test_google_only_auth.py` +
`test_security.py` + `backend_test.py` (410 + no-DB-write asserted).

## 7. Google session security — PROVEN (source + tests)
`server.py::auth_session`: server-side Emergent exchange only; never trusts client
identity fields; upserts by verified email to a stable internal `user_xxx` id (no
duplicates; email not the permanent id — `_id` is); rejects malformed/expired/replayed
session ids (in-process `_used_session_ids` guard + per-id rate limit); does not log
session ids/tokens; upgrades a pre-existing non-Google email record in place and scrubs
the password (never links legacy password accounts). Callback restricted to the unique
`veytric` scheme. Expo scheme `exp+jarvis-ai-1486` may remain (EAS/Expo requirement) —
documented; Google flow uses the `veytric` callback.

## 8. Account isolation — PROVEN
`backend/tests/test_google_only_auth.py::test_strict_user_isolation` +
`test_predictions_and_isolation.py`: user B cannot list/GET/PATCH user A's vehicle
(403/404, no existence leak). All protected queries derive ownership from the server
session (`get_current_user`); client-supplied ids are not trusted.

## 9. Prompt 1 evidence & runtime boundary
`/app/PROMPT1_COMPLETION_REPORT.md` (downloadable) lists all modules, the **7 provenance
labels** (MEASURED, CALCULATED, USER PROVIDED, OEM SPECIFICATION, RECOMMENDED, AI
INTERPRETATION, UNAVAILABLE), the **3 trust zones** (ZONE1_VEHICLE, ZONE2_AUTHORITATIVE,
ZONE3_RESEARCH_AI), schema v1, validation/malformed/freshness/session rules, registry,
router, gates, timeouts, structured errors, fail-closed behavior, BLE adapter boundary,
deterministic calculators, raw-capture/redaction, 25 golden fixtures, migration, and the
AI/report envelope. Modules compile + pass 7 Node module suites. **Not yet imported by any
screen** (grep proof) — screen wiring is Prompt 2 (matrix in report §K). Prompt 1 did not
require screens to be wired before Prompt 2; the foundation + tests are the deliverable.

## 10. BLE production protections — intact
Unchanged: `service.tsx` constructs `BleProvider` on native production; `SimulationProvider`
ctor throws on native production; no simulation fallback after BLE error; UNAVAILABLE when
no adapter / no data; unsupported PID stays unsupported; Mode 04 needs confirm + real
connection. Golden fixtures + `providerRouter` fail-closed test prove no-fabrication.
On-device BLE regression: **PENDING PHYSICAL-DEVICE VERIFICATION**.

## 11. Android production posture (source)
`app.json`: package `com.emergent.jarvisai.gx2hdi`, `versionCode 120`, `version 1.1.0`,
`allowBackup:false`, `usesCleartextTraffic:false`, `blockedPermissions` (SYSTEM_ALERT_WINDOW,
WRITE/READ_EXTERNAL_STORAGE), scheme `veytric`, BLE/camera/mic perms retained. Plugin also
enforces backup/cleartext on merge. Final merged-manifest + APK secret scan:
**PENDING SIGNED ANDROID BUILD**.

## 12. Automated test results
- Node (real modules): legacyMigration, evidenceContract, providerRouter, calculators,
  decoderFixtures (25 golden fixtures), migration, envelope — **all passed**.
- Backend pytest (Google-seeded sessions): auth-410, session security, isolation,
  subscription, shop-fleet, security, phase-A, evidence-contract — **95 passed** (see §F of report).

## 13. Build
Source ready: versionName **1.1.0** (> 1.0.9), versionCode **120** (> 119), package +
signing preserved. **PENDING SIGNED ANDROID BUILD** — this preview cannot produce a
signed APK/AAB or SHA-256 of a binary. Trigger via the Publish button.

## 14. Physical-device status: **PENDING PHYSICAL-DEVICE VERIFICATION**
Checklist: fresh install, upgrade install, launcher label = VEYTRIC, Google login,
canceled login, restart/session restore, logout, account switching, Bluetooth denied,
BT permission recovery, adapter discovery, ELM327 connect, no-data behavior, unsupported
PID, DTC read, readiness, Mode 06, live PIDs, code-clear confirmation.

## 15/16/17. Deliverables / stop-conditions / boundary
No stop-condition triggered in source. Package ID + signing unchanged; sim not selectable
in production; no secrets added; Prompt 1 + BLE regression pass; Prompt 2 not started.
Rollback: `git reset --hard veytric-aptr-correction-checkpoint` (commit `70a5ca0`), or
revert the correction commit; all changes additive except the app label/version bump.

## Known limitations
Signed APK/AAB build, merged-manifest/APK proofs (label, PreviewActivity removal, Amazon
removal, secret scan), and all physical Google/BLE/vehicle testing require your build +
device. Marked PENDING above — not claimed as done.
