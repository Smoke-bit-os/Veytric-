# VEYTRIC — Prompt 3 AI & Research Call Inventory (Phase 3A)

Baseline: `veytric-prompt2-phase2f-final` (`a4d1312`). Backend baseline tests: **265 passed, 10 pre-existing stale failures** (legacy hardcoded email; `/scans` ai_report now generated via `/scans/{id}/analyze`; old prediction model) — all fail on HEAD without any Prompt 3 change and are unrelated. Node suites: **10/10 pass**.

Prompt 2 completeness verified: phase tags `veytric-prompt2-phase2a`, `2b`, `2cde`, `2f`, `2f-final`, `veytric-prompt2-checkpoint` all present; orchestrator (`core/stateMachine/taskTypes/aiBoundary/agents/codesRuntime`) + evidence boundary present and operational; Google-only auth + 410 legacy endpoints + per-user isolation + BLE fail-closed + evidence provenance intact.

## Legend
- **Provider category**: CLOUD (Emergent-managed `EMERGENT_LLM_KEY`, `LlmChat` gpt-5.4) · BYOK (user OpenAI key, device→api.openai.com) · LOCAL (Ollama, device→localhost:11434) · RESEARCH (NHTSA vPIC).
- **Migration status**: TODO = must route through a Prompt 3 gateway; N/A = not a provider spend; DONE = migrated.

## Backend production AI paths (`/app/backend/server.py`)
| # | Endpoint | Line | Category | Purpose | Auth (server-derived) | Metering today | Privacy today | Migration |
|---|----------|------|----------|---------|-----------------------|----------------|---------------|-----------|
| 1 | POST `/api/vehicles/{id}/health` | ~625 | CLOUD | Health narrative from heuristic score | yes | `enforce_cloud_quota` (req count) | raw vehicle ctx, possible full VIN | TODO |
| 2 | POST `/api/recordings/{rec_id}/analyze` | ~1165 | CLOUD | Explain a captured recording | yes | quota | raw ctx | TODO |
| 3 | POST `/api/recordings/{rec_id}/save-ai` | ~1185 | BYOK persist | Store BYOK/Local result | yes | none (correct) | n/a | TODO (validate + meter as BYOK/LOCAL) |
| 4 | GET `/api/vehicles/{id}/trends` | ~1572 | CLOUD | Trend summary | yes | quota | raw ctx | TODO |
| 5 | POST `/api/vehicles/{id}/trends/explain` | ~1552 | CLOUD/BYOK | Trend explanation | yes | quota (cloud) | raw ctx | TODO |
| 6 | GET/POST `/api/vehicles/{id}/health-report` | ~1618/1698 | CLOUD | Health report narrative | yes | quota | raw ctx, VIN | TODO |
| 7 | POST `/api/vehicles/{id}/health-report/save` | ~1643 | BYOK persist | Store BYOK/Local report | yes | none | n/a | TODO |
| 8 | POST `/api/scans/{scan_id}/analyze` | ~1772 | CLOUD | Scan AI report | yes | quota | raw ctx | TODO |
| 9 | POST `/api/scans/{scan_id}/save-ai` | ~1793 | BYOK persist | Store BYOK/Local scan report | yes | none | n/a | TODO |
| 10 | POST `/api/ai/analyze` | 1841 | CLOUD | Generic analyze (used by `cloudProvider`) | yes | quota | context string, VIN | TODO (primary Cloud path) |
| 11 | STT `OpenAISpeechToText` | ~691 | CLOUD | Voice→text | yes | — | audio | TODO (meter) |
| 12 | TTS `OpenAITextToSpeech` | ~711 | CLOUD | Text→voice | yes | — | text | TODO (meter) |
| 13 | GET `/api/ai/usage` | 1872 | N/A | Read monthly quota | yes | read-only | n/a | N/A (extend to ledger) |
| 14 | POST `/api/vin/decode` | (vin) | RESEARCH | NHTSA vPIC VIN decode | yes | none | full VIN (required) | TODO (Research Gateway) |

## Frontend production AI paths (`/app/frontend/src`)
| # | File | Category | Path | Migration |
|---|------|----------|------|-----------|
| A | `ai/cloudProvider.ts` | CLOUD | `api.aiAnalyze` → `/api/ai/analyze` | TODO (route via CentralAIGateway) |
| B | `ai/openaiProvider.ts` | BYOK | direct `https://api.openai.com/v1` | TODO (keep device-direct spend, but gate/meter classification client-side + record usage event server-side without key) |
| C | `ai/localProvider.ts` | LOCAL | direct Ollama `localhost:11434` | TODO (same as BYOK: classify + record, never fall back to Cloud) |
| D | `ai/diagnosticAI.ts` | routes A/B/C | `runPreparedOnActive` | TODO (single gateway entry) |
| E | `ai/aiContext.tsx` | routes A/B/C | `useAI().analyze` | TODO |
| F | `vehicle/vin/vinService.ts` | RESEARCH | `api.decodeVin` | TODO (Research Gateway) |

## Non-provider references (N/A — no spend)
`evidence/*`, `legacyMigration.ts`, `ai/secureStorage.ts` (key storage), `components/AIEngineBadge.tsx`, decoders, tests/fixtures.

## Key findings / gaps Prompt 3 must close
1. **No single choke-point**: Cloud goes through `/api/ai/analyze` but 9 other backend endpoints call `LlmChat` directly — each must route through `CentralAIGateway`.
2. **Metering is request-count only** (monthly), per-user; no tokens/cost/latency/retry/cache/cancellation ledger; STT/TTS unmetered. Prompt 3 adds the authoritative `usage_events` ledger.
3. **No idempotency** on AI requests → replay/double-charge risk.
4. **No budgets** beyond monthly count; **no rate limiting** beyond a global throttle; **no circuit breakers**; **no cancellation**; **no cache**; **no structured/validated response schema**.
5. **No Research Gateway** (only VIN decode); no source classification / prompt-injection isolation / research budgets.
6. **No privacy redactor**: prompts embed raw vehicle context incl. full VIN with no minimization/tokenization.
7. **No static enforcement** preventing new direct provider calls.
8. BYOK/Local correctly never fall back to Cloud today (`ProviderError` thrown, not caught) — this MUST be preserved.
