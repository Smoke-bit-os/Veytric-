# Fake / Simulated / Fallback Data Audit (Prompt 0)

Method: repo-wide grep across `frontend/src`, `frontend/app`, `backend/` for
`Math.random`, random, simulation, mock, fake, placeholder, sample, demo, seed,
hard-coded percentages, time-derived values. Disposition per finding below.

| # | Location | What it creates | Consumed by | Reachable web | Reachable native prod | Can persist? | Can reach AI/report/health? | Disposition |
|---|----------|-----------------|-------------|:-------------:|:---------------------:|:------------:|:---------------------------:|-------------|
| 1 | `src/vehicle/simulationProvider.ts` (Math.random state machine, SIM_IDENTITY VIN 1C4HJXEG9JW174532) | Simulated PIDs/identity/DTCs | `service.tsx` (web), Live/Health/ECU screens | YES (by design, labeled SIMULATION) | **NO** — ctor throws if `native && !__DEV__` | **NO** — `runScan` throws on web | Only in-memory on web; blocked from persistence | **ISOLATED** (web-only, guarded) |
| 2 | `app/(tabs)/health.tsx` — old hard-coded `REMINDERS` (480 km / 62% / 71% / "Overdue by 300 km") | Fabricated maintenance %/mileage | Health tab | (was) YES | (was) YES | no | YES (health UI) | **REMOVED** — now wired to `/vehicles/{id}/predictions` source-aware engine |
| 3 | `backend/server.py` upsert-by-vin `last_scan_at=now_iso()` | Phantom "last scan" on add | Garage/dashboard | YES | YES | YES (mongo) | health/garage | **REMOVED** — no scan timestamp on add; lastScan null until real scan |
| 4 | `src/vehicle/database/knownIssues.ts` `GENERIC` list returned for unknown makes | Generic failures shown as vehicle-specific | vehicle-profile, enrichment | YES | YES | no | vehicle intel | **REMOVED** — returns `[]`; UI shows "No vehicle-specific pattern identified" |
| 5 | `backend/server.py` `_compute_predictions` `remainingLifePct` on interval | Non-measured % life | Health | YES | YES | no | health | **CORRECTED** — `remainingLifePct=null` unless real measurement; interval→GENERAL_INDUSTRY_INTERVAL (labeled not vehicle-specific); no baseline→urgency "unknown" (no fabricated overdue) |
| 6 | `src/vehicle/vin/vinService.ts` offline fallback | (previously) local WMI heuristic decode | connect/scan | YES | YES | cache | vehicle identity | **CORRECTED (prior)** — offline w/o current-user cache → `offline_unavailable` (no fabrication); cache user-scoped |
| 7 | `backend/tests/*`, `frontend` `*.test`/tsx harness fixtures | Test-only sample data | tests | test-only | test-only | no | no | **TEST-ONLY / ISOLATED** (not imported by production) |
| 8 | ECU readiness monitors (`dtcClassifier.readinessMonitors`) heuristic defaults | monitor states when disconnected | ecu-modules | YES | YES | no | ECU UI | **ISOLATED/GATED** — DIAGNOSTIC DATA tab now rendered only when `connected`; else "Unavailable from vehicle". Deep ECU-sourced readiness = Prompt 1 |

## Key results
- `Math.random` appears **only** in `simulationProvider.ts` (web-only, guarded). No randomness in any production diagnostic/maintenance/report/export path.
- No sample VINs/vehicles/scans/DTCs in production code paths.
- Native production cannot instantiate SimulationProvider (dual guard).
- Simulated web telemetry cannot be persisted as a real scan.
