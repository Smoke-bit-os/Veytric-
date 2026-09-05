# VEYTRIC — Protected Interface Register

_Prompt 1._ These interfaces are load-bearing and verified working. Changes must
be **additive/backward-compatible**. If a breaking change is unavoidable, STOP and
document the migration + compatibility consequences before editing (Prompt 1 §3.3).

Legend — Persistence: where state lives. Auth: requires authenticated user.
Owner: user/vehicle ownership enforced.

## A. Authentication
| Interface | Owning module | Consumers | Inputs → Outputs | Error behavior | Auth | Owner | Compat requirement | Protecting tests |
|---|---|---|---|---|---|---|---|---|
| Google sign-in entry | `frontend/src/googleAuth.ts`, `frontend/app/auth.tsx` | auth context | user tap → one-time `session_id` | returns null on cancel; no crash | n/a | n/a | Only Google; no email/guest | `backend/tests/test_google_only_auth.py`, `frontend/src/__tests__/legacyMigration.test.mjs` |
| Session exchange | `backend/server.py :: POST /api/auth/session` | frontend `api.authSession` | `{session_id}` → `{session_token, user}` | 401 on bad/expired/replay | no (mint) | creates stable `user._id` | Single-use, 7-day expiry, replay guard | `test_google_only_auth.py` |
| Session auth | `server.py :: get_current_user` | all authed routes | Bearer `session_token` → user | 401 missing/unknown/legacy-JWT | yes | — | Only session_token accepted | `test_google_only_auth.py`, `test_security.py` |
| Logout / token delete | `frontend/src/auth.tsx :: logout` | UI | — → cleared local state | — | yes | — | Clears token + user caches | manual + migration test |
| Legacy cache cleanup | `frontend/src/legacyMigration.ts` | boot | — → one-time wipe | best-effort | n/a | — | Runs once (versioned flag); never wipes new session; never creates guest | `legacyMigration.test.mjs` |
| Per-user cache namespaces | `frontend/src/utils/storage/*` | all local caches | key → namespaced value | — | — | user id namespaced | Namespaced by stable uid | (Phase 1 ownership tests) |

## B. Vehicle transport (BLE/ELM327) — `frontend/src/vehicle/*`
| Interface | Owning module | Notes / compat | Protecting tests |
|---|---|---|---|
| `VehicleDataProvider` contract | `vehicle/types.ts` | The single abstraction all transports implement. **Do not change shape**; extend via new optional methods only. Phase 1B adapter emits EvidenceRecords **outside** this interface. | contract review |
| BLE scan/connect/disconnect/reconnect | `vehicle/bleProvider.ts`, `service.tsx` | Connect throws on failure (no silent fallback). User-initiated on native. | `test_diagnostics.py` (live-guarded) |
| Service/characteristic discovery, ELM327 init, command queue, timeouts | `vehicle/obd/elm327.ts` | Raw request/response preserved; malformed handled. | Phase 1D golden fixtures |
| Supported-PID discovery | `vehicle/health.ts` (`PID_CATALOG`), `obd/*` | — | — |
| DTC read / **clear (Mode 04)** | `service.tsx :: refreshDtcs/clearDtcs` | Clear re-reads from ECU (never assumes success). Mode 04 confirmation preserved. | `test_diagnostics.py` |
| VIN read/decode | `vehicle/vin/*` | Local + NHTSA vPIC + cache; `decodeSource` labeled. | `test_iteration_18/19` |
| Voltage (ATRV), readiness, Mode 06, ECU/modules | `vehicle/obd/*`, `ecu/*`, `modules/*`, `system-monitor/*` | Missing → UNAVAILABLE. | Phase 1D |
| `DataSource` / `BleStatusReport` | `vehicle/types.ts`, `service.tsx` | Native = REAL_BLE only on real ECU comms, else UNAVAILABLE; never SIMULATION. | Phase 1 provider tests |

## C. Vehicle data (derived)
`predictions/*`, `trends/*`, `timeline/*`, `maintenance/*`, `diagnostics/*`,
`performance/*`, `recording/*`, `profile/*`. Consume provider output; never
fabricate. Persist via backend `vehicles`/`scans`/`vehicle_history`/`reports`.

## D. AI — `frontend/src/ai/*` + `backend/server.py`
| Interface | Module | Compat requirement | Tests |
|---|---|---|---|
| Central AI gateway / provider selection | `ai/aiProvider.ts`, `ai/diagnosticAI.ts` | All AI goes through here; keep provider selection | `test_ai_routing.py` |
| Cloud usage metering + quota | `server.py :: /api/ai/*`, `/api/diagnostics/interpret`, `/api/reports`; `ai_usage` | Server-authoritative; Free quota → 429 | `test_security.py`, `test_subscription.py` |
| BYOK direct / Local | `ai/*` | No silent fallback to Cloud; no Cloud metering | `test_ai_routing.py` |
| Provenance on AI output | `ai/*` + `frontend/src/evidence/*` | AI output = AI_INTERPRETATION; cannot overwrite measured | `test_evidence_contract.py`, `evidenceContract.test.mjs` |

## E. Commercial
| Interface | Module | Compat | Tests |
|---|---|---|---|
| Entitlements | `server.py :: /api/subscription`, `licensing/*` | Server-authoritative balances | `test_subscription.py` |
| Credits / usage ledger | `ai_usage`, `/api/ai/usage` | Server truth | `test_security.py` |
| Purchase verify / RevenueCat identity / Restore | `src/revenuecat.tsx`, `subscriptions/*` | Identity bound to stable uid | `memory/revenuecat.md` |
| Dev tier override | `/api/subscription/developer/set` | development only | `test_subscription.py`, `test_guided_repair_and_security.py` |

## F. Reports & history
| Interface | Module | Compat | Tests |
|---|---|---|---|
| Report generate | `server.py :: /api/reports` | Ownership validated; evidence-cited (Phase 1F) | `test_subscription.py` |
| Saved scans / repair history / exports | `scans`, `vehicle_history`, `performance/export.ts` | Ownership validated; cache invalidation preserved | `test_predictions_and_isolation.py` |

**Rule:** Add regression tests around a protected interface **before** materially
changing its internals.
