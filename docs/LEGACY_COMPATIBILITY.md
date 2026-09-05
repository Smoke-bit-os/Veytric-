# VEYTRIC — Legacy Compatibility Register

_Prompt 1._ VEYTRIC is the customer brand; the tagline is "Diagnose. Understand.
Repair." Internal JARVIS-era identifiers are retained **only** where changing them
would break existing installs, billing, updates, or stored data. Each is listed
with why it stays and whether users can see it.

## Package / signing / project identity (RETAINED — breaking to change)
| Identifier | Value | Why retained | User-visible? |
|---|---|---|---|
| Android package | `com.emergent.jarvisai.gx2hdi` | Changing it creates a new app on Play; breaks updates + RevenueCat/Play billing entitlements | No |
| iOS bundle id | `com.emergent.jarvisai.gx2hdi` | Same as above for App Store | No |
| EAS projectId | `4f7e910e-accf-4adc-bcd1-76665f149612` | Ties builds/updates to the existing project | No |
| Expo slug | `frontend` | Changing breaks the EAS project/update channel linkage | No |

App display name is `VEYTRIC` (`app.json expo.name`); auth deep-link scheme is the
unique `veytric` (generic `frontend` scheme dropped in the auth gate).

## Device storage keys (RETAINED — breaking to rename)
Renaming would orphan existing users' local settings/secrets. All are namespaced
per authenticated user id by the storage layer.

| Key | Purpose | Notes | User-visible? |
|---|---|---|---|
| `jarvis_token` | Session token slot (now holds the Google session_token) | Reused slot; renaming logs everyone out | No |
| `jarvis_current_uid` | Cached authenticated user id (cache namespacing) | — | No |
| `jarvis_ai_provider_type` | Selected AI engine (Cloud/BYOK/Local) | — | No |
| `jarvis_openai_api_key` | BYOK secret (SecureStore only) | Wiped by legacy migration if unattributable | No |
| `jarvis_openai_model`, `jarvis_local_ai_url`, `jarvis_local_ai_model` | AI engine settings | — | No |
| `jarvis_dev_unlocked` | Developer-mode flag (dev only) | — | No |
| `jarvis_trial_reminders` | Trial reminder prefs | — | No |
| `jarvis_guest` | **Cleanup-only** guest flag | Read ONLY by `legacyMigration.ts` to delete it; never grants guest access | No |

## Backend identifiers (RETAINED)
| Identifier | Value | Why retained | User-visible? |
|---|---|---|---|
| Mongo DB name | `DB_NAME` (env; preview `test_database`) | Holds production data; changing detaches it | No |
| `JWT_SECRET` env var | present in `backend/.env` | **Now unused** (email/password/JWT retired). Harmless; may be removed at deploy. No code reads it. | No |
| Collection field `users._id` | `user_xxxxxxxx` | Stable internal user identity that owns all records | No |
| Provider mode enum | `"simulation" \| "ble"` (`vehicle/types.ts`) | Internal transport tag consumed across vehicle code | No |

## Env / config (RETAINED)
| Var | Purpose | Notes |
|---|---|---|
| `EXPO_PUBLIC_VEHICLE_MODE` | Dev-only simulation override | Honored ONLY when `__DEV__` on native; ignored in production |
| `EXPO_PUBLIC_REVENUECAT_*` | RevenueCat keys | Billing identity |
| `EMERGENT_LLM_KEY` | Managed Cloud AI key | Server-side only |

## Known APK-audit branding items
| Item | Status |
|---|---|
| About tagline | ✅ Fixed to "Diagnose. Understand. Repair." (`frontend/app/about.tsx`) |
| Customer-visible AI label | ✅ Already "VEYTRIC Cloud AI" (`ai/cloudProvider.ts`); residual "JARVIS" is code comments only |
| `MichaelBryant@JarvisAutoAI.com` (About → Business contact) | ⚠️ **BLOCKED** — correct VEYTRIC email not yet available in project config; must not invent. Update when provided. |
| `JarvisAutoAI.com` (About → Website) | ⚠️ **BLOCKED** — same as above (awaiting correct VEYTRIC domain) |
| Android `versionCode` | Managed workflow — no native `/android` dir; EAS assigns at build time. Keep Expo `version` in sync at release. |
