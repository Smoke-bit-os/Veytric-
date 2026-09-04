# PROMPT 0 — Baseline Truth, Regression Inventory & Production Safety
> App is now **VEYTRIC — AI Vehicle Intelligence** (formerly JARVIS Auto AI) — rebranded in Prompt R; see `PROMPT_R_REBRAND_REPORT.md`. Technical identifiers (package id, storage keys, `JARVIS_CLOUD` enum, `JARVIS_SYSTEM` const) intentionally retained for compatibility.


Environment executed in: **PREVIEW / dev** (`https://jarvis-ai-1486.preview.emergentagent.com`).
The **production** environment and its database are **not accessible from here** (separate deploy).

---

## A. Baseline Truth Report (status + evidence)

| Area | Status | Evidence |
|------|:------:|----------|
| Clean build from committed lockfiles | PASS | `yarn.lock` committed; Metro bundles; backend boots (health 200). |
| Pre-change checkpoint recorded | PASS | Start `6a68998…`; checkpoint commit `cc98737…` (§B). |
| Machine-readable feature inventory | PASS | `/app/docs/feature_inventory.json`. |
| Vehicle data-flow map | PASS | `/app/docs/data_flow_map.md`. |
| Protected-interface inventory | PASS | `/app/docs/protected_interfaces.md`. |
| Fake/sim/random/fallback inventory | PASS | `/app/docs/fake_data_audit.md`. |
| Native prod cannot instantiate SimulationProvider | PASS (code) / UNVERIFIED (prod-build runtime) | Dual guard: `service.tsx createProvider` (`__DEV__`-gated) + `simulationProvider.ts` ctor throws if `native && !__DEV__`. Runtime throw observable only in a real production build. |
| No random/time value in prod diagnostic/maintenance/AI/report/export | PASS | grep: `Math.random` exists ONLY in `simulationProvider.ts` (web-only, guarded). |
| Missing vehicle data renders honestly | PASS | Health PM → GENERAL_INDUSTRY_INTERVAL / UNAVAILABLE; ECU live tab → "Unavailable from vehicle" when disconnected; fresh vehicle → "No scans yet". |
| Provenance states not confused (measured vs recommended vs unavailable) | PASS | Predictions expose `source` + `confidence`; `remainingLifePct` null unless real measurement. |
| Logout returns to login + protected nav blocked | PARTIAL: cache-wipe PASS; back-nav regression UNVERIFIED | `clearLocalUserData` wipes `veh_intel:/veh:/scan:/vin_decode:`; no automated back-nav test yet. |
| Cross-user isolation (A cannot access B) | PASS | `tests/test_predictions_and_isolation.py` (User B blocked from A's vehicles/predictions), `tests/test_security.py`. |
| Cross-vehicle/user VIN cache isolation | PASS | `vin_decode:<uid>:<vin>` + logout wipe (prior security audit). |
| Simulated web scan cannot persist as real | PASS | `scanWorkflow.runScan` throws `SIMULATED_SCAN_NOT_SAVED` on web; verified GET /scans count unchanged. |
| Production DB verified recoverable backup | **UNVERIFIED / BLOCKED** | No access to production DB from preview (see §H). |
| No legacy migration / destructive reset performed | PASS | None attempted. |
| Real-device BLE / ECU / camera-OCR | UNVERIFIED | Requires physical adapter + vehicle + native build. |

---

## B. Pre-change checkpoint
- Branch: current working branch. Start commit: `6a6899848433e6bb0d516f0777620d2d1abfcd91`.
- Checkpoint commit (pre-Prompt-0): `cc98737748362a7371ea17b573c8c2ff9767d8ef` (message: "checkpoint: pre-Prompt-0 baseline (Phase A data-integrity complete)").
- Working tree at checkpoint: committed clean.
- App: Expo SDK 54 (`expo 54.0.36`), `newArchEnabled: true`. Backend: FastAPI + MongoDB. Package manager: `yarn@1.22.22`. Lockfiles: `frontend/yarn.lock`, `backend/requirements.txt`.
- Build profiles: `eas.json` (dev-client + BLE embedded). Secrets NOT exposed.

## C. Changed-file report (this Prompt-0 pass)
| File | Change | Requirement | Compatibility |
|------|--------|-------------|:-------------:|
| `frontend/app/guided-repair.tsx` | Fixed a JSX syntax break (orphaned `Start` Pressable + stray `) : null}`) introduced by an earlier increment; re-wrapped in `{!text && !loading ? …}` | §13 clean build / regression | Safe (route now bundles) |
| `frontend/app/scan-vin.tsx` | Fixed invalid theme refs `colors.background`→`colors.surface`, removed non-existent `font.mono` | §13 type checking | Safe (cosmetic) |
| `frontend/src/vehicle/simulationProvider.ts` | (Verified) hard native-prod guard already present | §5 | none |
| `backend/tests/test_predictions_and_isolation.py` | Updated 2 stale assertions to the corrected tiered model (no fabricated `%`, `GENERAL_INDUSTRY_INTERVAL`) | §7/§14 regression | test-only |
| `docs/*.md`, `docs/feature_inventory.json`, this report | New Prompt-0 deliverables | §17 | docs only |

(Prior Phase-A changes — health.tsx real predictions, ecu-modules gating, knownIssues generic removal, predictions engine tiering, upsert last_scan_at removal, scanWorkflow sim-guard, advanced-scan delete — are in the checkpoint commit and inventoried in §F.)

## D. Feature inventory → `/app/docs/feature_inventory.json`
## E. Data-flow map → `/app/docs/data_flow_map.md` (remaining uncertain boundaries listed there)
## F. Fake-data audit → `/app/docs/fake_data_audit.md` (all findings dispositioned)
## G. Protected interfaces → `/app/docs/protected_interfaces.md`

## H. Database backup evidence
- **BLOCKED / UNVERIFIED.** This agent operates only in the preview environment and has no authorized access to the production MongoDB cluster or its credentials. No production backup could be created or verified from here.
- No local development export is being represented as a production backup.
- **Required before any future destructive reset / Google-auth migration:** an authorized operator must create and verify a provider-native snapshot of the production cluster, record snapshot id + UTC timestamp + collection counts + checksum, store it encrypted (never in Git), and validate a restore in an isolated environment.

## I. Test report (exact commands + results)
- `cd /app/backend && python -m pytest tests/test_security.py tests/test_subscription.py -q` → **41 passed**, 0 failed (1 warning: short HMAC key in a negative test).
- `EXPO_PUBLIC_BACKEND_URL=<preview> python -m pytest tests/test_phase_a_data_integrity.py tests/test_predictions_and_isolation.py -q` → **17 passed**, 0 failed (after updating 2 stale assertions to the corrected tiered model).
- `cd /app/backend && python -c "import ast; ast.parse(open('server.py').read())"` → OK.
- ESLint on changed screens → No issues.
- (Not run this pass: full backend suite incl. AI/recordings tests that require live LLM/network — out of Prompt-0 scope.)

## J. Build report
- Frontend typecheck: `npx tsc --noEmit` → **10 pre-existing errors remain** (codes.tsx DTC-type comparisons x3; vinHistory.ts storage generics x6; simulationProvider.ts `phase` x1). My edits introduced **0** new errors. These do not block Metro/Babel bundling (types are stripped) — app bundles and runs. Listed in §K.
- Backend startup: PASS (health 200).
- Web bundle: served by Metro (screens render, verified via screenshots).
- Android/native build: NOT run here (requires EAS build pipeline via Publish).

## K. Known failures / limitations (honest)
1. **Production DB backup — BLOCKED** (no prod access). Gate cannot be PASS until an authorized backup+restore is verified.
2. **Real-device BLE / ECU readiness / DTC clear / camera-OCR — UNVERIFIED** (need physical adapter + vehicle + native build).
3. **Native-prod SimulationProvider guard** verified by code; the runtime throw is observable only in a production build.
4. **tsc: 10 pre-existing type errors** (codes.tsx history/stored/confirmed groups reference values absent from `Dtc.type` → those groups always render empty; vinHistory storage generics; sim `phase`). Runtime unaffected; scheduled for cleanup, not Prompt-0 blockers.
5. **Logout back-navigation** has no automated regression test yet (cache-wipe is covered; nav guard is manual-verified).
6. **Google-only auth** is the stated direction but not yet implemented (app uses JWT/email + guest). No migration performed (correct for Prompt 0).
7. **Units (Standard/Metric)** not implemented (Phase C).

## L. Rollback instructions (safe, non-destructive)
- To return to the pre-Prompt-0 baseline: `cd /app && git checkout cc98737748362a7371ea17b573c8c2ff9767d8ef -- .` (restores files without touching unrelated work), or `git reset --hard cc98737…` only if you intend to discard Prompt-0 doc/test/fix changes.
- To undo only the guided-repair/scan-vin fixes: `git checkout cc98737… -- frontend/app/guided-repair.tsx frontend/app/scan-vin.tsx`.
- No database or auth changes were made, so no data rollback is required.

## M. Final gate decision

**PROMPT 0 ACCEPTANCE GATE: UNVERIFIED**

- Safe to begin Prompt 1? **Not yet** — one hard blocker remains.
- Blocking issue: a **verified recoverable production database backup could not be created** from this environment (no authorized production access), and Prompt 0 requires it before proceeding. Real-device BLE/camera items are also UNVERIFIED (need hardware + native build).
- Everything achievable in preview is complete and green: fake-data removed/guarded, provider safety enforced, cross-user isolation proven by tests, honest missing-data states, sim-scan persistence blocked, deliverables produced, a real syntax regression fixed.
- Ending commit: recorded on completion (see git log after the Prompt-0 commit).
- Recommended next action: have an authorized operator create + verify a production MongoDB snapshot (record id/UTC/counts/checksum, validate a restore in isolation), then re-run this gate → it flips to PASS and Prompt 1 can begin.
