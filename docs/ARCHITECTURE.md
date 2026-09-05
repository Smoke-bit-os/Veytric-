# VEYTRIC — Architecture (as implemented)

_Diagnose. Understand. Repair._ · Last updated: Prompt 1, Phase 1A.

This documents the **actual** implemented system, not an aspiration. File paths
are real and clickable in the repo.

## 1. Stack & boundaries
- **Frontend**: React Native + Expo (managed workflow), file-based routing via
  `expo-router` (`frontend/app/**`). Non-route code lives under `frontend/src/**`.
- **Backend**: FastAPI monolith — `backend/server.py` (~2k lines). All routes are
  under the `/api` prefix (`api_router`). New additive contract lives in
  `backend/evidence/`.
- **Database**: MongoDB via `motor`. Collections: `users`, `user_sessions`,
  `vehicles`, `vehicle_history`, `vehicle_reports`, `scans`, `reports`,
  `recordings`, `messages`, `ai_usage`.
- **Native boundaries**: BLE (`react-native-ble-plx`), camera/OCR
  (`expo-camera` + `@react-native-ml-kit/text-recognition`), in-app billing
  (`react-native-purchases` / RevenueCat). These do **not** run in Expo Go / web.
- **Production vs web-preview**: `frontend/src/vehicle/service.tsx :: createProvider()`
  — web → `SimulationProvider`; native production → `BleProvider`; simulation on
  native only when `__DEV__` (see LEGACY_COMPATIBILITY + DATA_FLOW_AND_TRUST_ZONES).

## 2. Navigation
- Root layout + auth gate: `frontend/app/_layout.tsx`, `frontend/app/(tabs)/_layout.tsx`.
- Auth screen (Google-only): `frontend/app/auth.tsx`.
- Feature screens: garage, connect, diagnostics, vehicle profile, recorder,
  reports, upgrade, ai-settings, developer, about (`frontend/app/**`).

## 3. Authentication (Google-only)
- Frontend context: `frontend/src/auth.tsx` (`loginWithGoogle`, `logout`, session
  restore) + `frontend/src/googleAuth.ts`.
- Backend: `POST /api/auth/session` exchanges a one-time Emergent Google
  `session_id` for a `session_token` stored in `user_sessions`; `get_current_user`
  accepts only that token. `/api/auth/register` + `/api/auth/login` are retired (410).
- Stable internal user id: `users._id` = `user_xxxxxxxx`. All records are scoped by it.
- One-time legacy cleanup: `frontend/src/legacyMigration.ts`.

## 4. Vehicle connection engine (BLE / ELM327)
- Provider abstraction: `frontend/src/vehicle/types.ts :: VehicleDataProvider`.
- Real transport: `frontend/src/vehicle/bleProvider.ts` (+ `.web.ts` stub),
  ELM327 layer `frontend/src/vehicle/obd/elm327.ts`, decoders
  `frontend/src/vehicle/obd/decoders.ts`, permissions `blePermissions.ts`.
- Orchestration/state: `frontend/src/vehicle/service.tsx` (scan, connect,
  disconnect, reconnect, live subscribe, DTC read/clear, freeze frame, status report).
- Supported PIDs, Modes 01/02/03/04/06/07/09, VIN (`vin/*`), ECU/modules
  (`ecu/*`, `modules/*`), readiness/system monitors (`system-monitor/*`).
- **Authoritative data source**: `types.ts :: DataSource = REAL_BLE | SIMULATION | UNAVAILABLE`;
  computed in `service.tsx` (native = REAL_BLE only when connected **and** a real ECU
  response was received; otherwise UNAVAILABLE — never SIMULATION).

## 5. Vehicle intelligence (derived, non-telemetry)
- Predictions `predictions/predictionsService.ts`, trends `trends/`, timeline
  `timeline/`, maintenance `maintenance/`, reliability/DTC classify `diagnostics/`,
  enrichment `enrichment/`, performance recording `performance/` + `recording/`.
- These consume provider output; they must never fabricate values (missing → UNAVAILABLE).

## 6. AI gateway (Cloud / BYOK / Local)
- Central gateway + routing: `frontend/src/ai/aiProvider.ts`,
  `frontend/src/ai/diagnosticAI.ts`, providers `ai/cloudProvider.ts`
  (name "VEYTRIC Cloud AI"), BYOK/local. No silent fallback BYOK/Local → Cloud.
- Cloud calls hit the backend (`/api/ai/*`, `/api/diagnostics/interpret`,
  `/api/reports`) which meters `ai_usage` and enforces Free quota (429) —
  server-authoritative.

## 7. Commercial (entitlements / credits / billing)
- Licensing: `frontend/src/licensing/*` (`LicenseProvider`, `licenseService`,
  `licenseCache`). Server-authoritative entitlement via `/api/subscription`.
- Subscriptions: `frontend/src/subscriptions/*` + RevenueCat (`src/revenuecat.tsx`).
- Dev tier override (`/api/subscription/developer/set`) only when `APP_ENV=development`.

## 8. Storage / cache / logging
- Device storage: `frontend/src/utils/storage/*` (AsyncStorage + SecureStore),
  namespaced by the authenticated user id; secrets (BYOK) only in SecureStore.
- Redaction/retention policy for raw captures is defined in EVIDENCE_CONTRACT.md
  (enforced in Phase 1D).

## 9. Normalized evidence (Prompt 1, additive)
- TS contract: `frontend/src/evidence/*`. Python mirror: `backend/evidence/evidence.py`.
- Shared sample: `docs/evidence_sample.json` (validated by both runtimes).
- See EVIDENCE_CONTRACT.md, PROVIDER_REGISTRY.md, DATA_FLOW_AND_TRUST_ZONES.md.
