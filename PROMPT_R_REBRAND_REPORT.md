# PROMPT R — VEYTRIC Rebrand Completion Report

Brand: **VEYTRIC — AI Vehicle Intelligence** · Tagline: *Diagnose. Understand. Repair.* · Former: JARVIS Auto AI.
Environment: PREVIEW/dev. Prompt 0 protections treated as protected baseline (not weakened). Prompt 1 NOT started.

## A. Starting checkpoint
- Start commit: `ca7be2706d8f5d6910523fc88eede7f895fe33ba` (post-deploy), working tree clean.
- Prompt 0 baseline: intact (`PROMPT0_BASELINE_TRUTH.md`). App: Expo SDK 54, newArch on. PM: yarn.
- Android package / iOS bundle: `com.emergent.jarvisai.gx2hdi` (unchanged — see §H).

## B/C. Files changed (branding-only unless noted)
Frontend (user-facing strings): `app.json` (display name + iOS/Android mic permission text), `app/auth.tsx`, `app/about.tsx` (brand only), `app/(tabs)/_layout.tsx` (tab title), `app/(tabs)/assistant.tsx` (title/tag/placeholder), `app/(tabs)/health.tsx`, `app/(tabs)/garage.tsx`, `app/ai-settings.tsx`, `app/connect.tsx`, `app/scan-vin.tsx`, `app/guided-repair.tsx` (AI prompt identity), `app/upgrade.tsx`, `app/reports.tsx` (export header), `app/predictions.tsx`, `app/how-to-connect.tsx`, `app/health-report.tsx`, `src/licensing/{featureRegistry,TrialReminder,licenseConstants}`, `src/subscriptions/purchaseTypes.ts`, `src/ai/cloudProvider.ts` (provider display name), `src/ai/types.ts` (system-prompt identity), `src/vehicle/bleProvider.ts` (permission msg), `src/vehicle/performance/export.ts` (report headers), `src/components/Dropdown.tsx` (comment).
Backend: `server.py` — `JARVIS_SYSTEM` prompt content → "You are VEYTRIC — AI Vehicle Intelligence…"; quota message + health message → VEYTRIC. `tests/backend_test.py` health assertion → VEYTRIC.
None of these changed a technical identifier, DB field, route, measurement, or history record.

## D. Branding replaced (areas)
Auth/register, splash brand, tab bar, Assistant (header/tag/placeholder/greeting via VEYTRIC Cloud AI), Health (analyze CTA), Garage (upgrade prompt), AI Settings (provider titles/help), Connect + How-to-Connect (all prose), Scan-VIN (permission/needs-app), Guided Repair (AI persona + disclaimer), Upgrade/membership, Predictions disclaimer, Reports/exports headers + share text, Health Report, licensing/subscription plan labels, backend AI persona + user-facing API messages.

## E. AI identity
- Frontend `JARVIS_SYSTEM_PROMPT` content + backend `JARVIS_SYSTEM` content now begin "You are VEYTRIC — AI Vehicle Intelligence…" (const NAMES retained as internal identifiers — see §H). All safety/evidence/provenance boundaries unchanged.
- Assistant identifies as VEYTRIC; cloud provider display name = "VEYTRIC Cloud AI". Verified live (screenshot: header "VEYTRIC · VEYTRIC Cloud AI"). Backend `GET /api/` → `{"message":"VEYTRIC AI online"}` verified.

## F. Metadata
- Expo/app display name → **VEYTRIC**; iOS `NSMicrophoneUsageDescription` + Android `microphonePermission` → "Talk to VEYTRIC". Web title inherits app name. Notification channel names: none brand-specific found.

## G. Technical identifiers CHANGED
None. (No package/bundle/DB/route/storage/enum identifier was renamed — all changes were display strings.)

## H. Technical identifiers RETAINED (intentional, documented)
| Identifier | Where | Reason retained | User-visible | Future migration |
|---|---|---|:---:|---|
| `com.emergent.jarvisai.gx2hdi` | app.json package/bundleIdentifier | Changing breaks Google auth/OAuth binding, Play update continuity, billing product bindings, signing, and disconnects installed users | No | Only via a new-app migration with OAuth/Play/billing re-config + user comms |
| `jarvis_token`, `jarvis_guest`, `jarvis_current_uid`, `jarvis_license_v1`, `jarvis_trial_reminders`, `jarvis_openai_api_key`, `jarvis_ai_provider_type`, `jarvis_openai_model`, `jarvis_local_ai_url`, `jarvis_local_ai_model`, `jarvis_dev_unlocked` | SecureStore/AsyncStorage keys | Renaming logs users out / orphans stored BYOK keys, license cache, prefs | No | Optional keyed migration (read-old→write-new→delete-old) if ever desired |
| `AIProviderType.JARVIS_CLOUD = "JARVIS_CLOUD"` | `src/ai/types.ts` enum value | Persisted in `jarvis_ai_provider_type`; changing the string breaks saved provider selection | No | Migrate enum value + stored prefs together |
| `JARVIS_SYSTEM` / `JARVIS_SYSTEM_PROMPT` const names | backend/frontend | Internal symbol imported in ~16 sites; content already rebranded | No | Cosmetic rename later (low value) |
| logger `"jarvis"` | backend logging | Internal log category | No | Cosmetic |
| Comments referencing "JARVIS Cloud"/system prompt | src/ai/*, vehicle/* | Describe the retained `JARVIS_CLOUD`/`JARVIS_SYSTEM` identifiers | No | Update when identifiers migrate |
| Test creds `@jarvis.ai`, `Jarvis2026!` | backend/tests/* | Documented test credentials (`memory/test_credentials.md`); test-only, not shipped | No | Rotate with test creds |

## I. Domain & external (§12 — NO invented domain)
- `JarvisAutoAI.com` + `MichaelBryant@JarvisAutoAI.com` on About page **retained** (real business contact; must not fabricate a replacement). Classified: *user-facing, requires owner action*.
- Manual migration checklist (owner action, not performed here): register/confirm VEYTRIC domain → DNS/SSL → API hostname + CORS → OAuth authorized origins & redirect URIs (Google console) → deep-link hosts → support email → privacy/terms URLs → Play listing → billing webhooks → keep old domain as redirect during transition. Do not disable JarvisAutoAI.com until the replacement is live and tested.

## J. Prompt 0 preservation
Fake-data prevention, native-simulation blocking (dual guard), honest unavailable states, provenance labels, auth/JWT, logout+cache isolation, cross-user isolation, vehicle-data/maintenance/report truth, reproducible build — ALL intact. Regression suite rerun below.

## K. Tests executed
- `python -m pytest tests/test_phase_a_data_integrity.py tests/test_predictions_and_isolation.py tests/test_security.py tests/test_subscription.py -q` (with `EXPO_PUBLIC_BACKEND_URL` set) → **58 passed, 0 failed** (1 warning: short HMAC key in a negative test). Includes the updated `backend_test`-style health assertion (VEYTRIC) and Prompt 0 isolation/integrity/security.
- `python -c ast.parse(server.py)` → OK. ESLint on all 14 changed screens → No issues.
- Live checks: `GET /api/` → `{"message":"VEYTRIC AI online"}`; screenshot: auth "VEYTRIC", assistant "VEYTRIC / VEYTRIC Cloud AI", tab "VEYTRIC", no "JARVIS" on screen.

## L. Build results
- Backend startup: PASS (health 200). Metro/web bundle: PASS (screens render). Frontend `tsc`: same 10 PRE-EXISTING errors as Prompt 0 (codes DTC-type, vinHistory generics, sim `phase`); rebrand added 0 new. Android/iOS native build: NOT run (EAS/Publish; UNVERIFIED here).

## M. Final legacy-name search
- Scope: `frontend/`, `backend/` `.ts/.tsx/.json/.py`. Excluded (documented): `node_modules`, `.git`, `.metro-cache`, `.expo`, generated bundles, and the preview host `jarvis-ai-1486` (infra URL, not branding).
- User-visible JARVIS occurrences remaining: **0** (verified by targeted sweep).
- Retained occurrences (all classified): package/bundle id (1×2), storage keys (11), `JARVIS_CLOUD` enum, `JARVIS_SYSTEM`/prompt const names + ~16 usages, logger name, code comments, About business contact `JarvisAutoAI.com` (2), test emails/passwords/docstrings. Every remaining occurrence is INTENTIONALLY RETAINED FOR TECHNICAL COMPATIBILITY or TEST or HISTORICAL contact — none unexplained.

## N. Known limitations
- Android/iOS native builds + real-device BLE/camera: UNVERIFIED (need EAS build + hardware).
- Package/bundle id retains `jarvisai` (compatibility) — user-visible name is VEYTRIC everywhere.
- VEYTRIC domain/email not created (owner action; existing JarvisAutoAI.com retained temporarily).
- Logo is the existing text wordmark "VEYTRIC" (temporary; no final logo asset supplied).
- Prompt 0's production-DB-backup blocker still stands (separate from rebrand).

## O. Rollback
`cd /app && git checkout <pre-rebrand commit ca7be27> -- frontend backend` (restores files, no data touched), or `git reset --hard ca7be27` to discard all Prompt R changes. No DB/auth/ownership change was made, so no data rollback needed.

## P. Final decision
**VEYTRIC REBRAND COMPLETE**
- PROMPT R ACCEPTANCE GATE: **PASS** (all user-facing branding = VEYTRIC; AI identity = VEYTRIC; reports/exports/metadata/notifications text = VEYTRIC; technical identifiers retained + documented; no measurement/history/ownership changed; zero unexplained legacy occurrences).
- Prompt 0 regression verification: **PASSED** (58/58).
- Safe to begin Prompt 1? Not from this environment until Prompt 0's production-DB-backup blocker is cleared by an authorized operator (unchanged by rebrand).
- Ending commit: recorded on commit after this report.
- Remaining blocker: production DB backup (Prompt 0) + native/domain owner tasks (§I/§N).
- Recommended next action: deploy/redeploy to push VEYTRIC branding live + regenerate native builds; complete the domain/OAuth checklist; clear the Prompt 0 backup blocker before Prompt 1.
