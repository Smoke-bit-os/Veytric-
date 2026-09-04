# Protected Interfaces (Prompt 0) — DO NOT break without a compatibility plan

Future prompts must preserve these signatures/schemas or provide an adapter + migration + rollback + tests.

## Frontend contracts
- `VehicleDataProvider` (`src/vehicle/types.ts`) — implemented by `bleProvider.ts` (LOCKED) and `simulationProvider.ts`. Methods: scan/connect/disconnect/readDtcs/clearDtcs/subscribe/reconnect/getDiagnostics/getLog/getStatusReport/readFreezeFrame; `mode`.
- `VehicleContext` (`src/vehicle/service.tsx useVehicle()`) — fields: data, signals, dtcs, identity, adapter, connection, mode, dataSource, hasLiveData, history + actions. Consumed by nearly every screen.
- Types: `VehicleIdentity`, `VehicleSignals`, `Dtc`, `DataSource`, `ConnectionStatus`, `BleStatusReport`, `FreezeFrame`, `ObdLogEntry`.
- Auth context (`src/auth.tsx useAuth()`): user, provider, login, register, loginAsGuest, logout. Storage keys: `jarvis_token` (SecureStore), `jarvis_guest`, `jarvis_current_uid`.
- `predictionsService` types: `PredictionSource` (LIVE_ECU|USER_SERVICE_HISTORY|MANUFACTURER_INTERVAL|GENERAL_INDUSTRY_INTERVAL|UNAVAILABLE), `PredictionItem`, `SOURCE_META`, `URGENCY_META`.
- `Dropdown` component API (`src/components/Dropdown.tsx`).
- Navigation route names (expo-router file routes) + deep links: `/(tabs)/garage?add=1`, `/scan-vin`, `/vehicle-profile?id=`, `/codes`, `/advanced-scan`, `/guided-repair`.

## Backend public routes (prefix /api)
- Auth: POST /auth/register, /auth/login, GET /auth/me.
- Vehicles: GET /vehicles, POST /vehicles, PATCH /vehicles/{id}, POST /vehicles/upsert-by-vin, GET /vehicles/{id}/dashboard, GET /vehicles/{id}/predictions, POST /vehicles/{id}/history/{kind}.
- Catalog (public): GET /vehicles/catalog/makes, GET /vehicles/catalog/models.
- VIN: POST /vin/decode.
- Scans: GET /scans, POST /scans, DELETE /scans/{id}, POST /scans/{id}/analyze.
- Reports: GET/POST /reports. Recordings: /recordings*.
- AI: POST /chat, /dtc/analyze, /ai/analyze, /diagnostics/interpret, /voice/transcribe, /voice/speak.
- Subscription: /subscription/* (developer/set is APP_ENV-guarded). Shop: /shop/fleet.

## DB identity / ownership fields (must remain)
- `users._id`, `vehicles.user_id`, `vehicles.id`, `vehicles.vin`, `vehicle_history.user_id/vehicle_id`, `scans.user_id`, `reports.user_id`, `recordings.user_id`, `ai_usage.user_id`. All reads/writes scoped by server-verified `user._id` (never client-supplied id).

## Environment / build
- Env names (never hardcode/rename): `MONGO_URL`, `JWT_SECRET`, `APP_ENV`, `CORS_ORIGINS`, `EMERGENT_LLM_KEY`, `AI_FREE_MONTHLY_LIMIT`, `EXPO_PUBLIC_BACKEND_URL`, `EXPO_PACKAGER_PROXY_URL`, `EXPO_PACKAGER_HOSTNAME`, `EXPO_PUBLIC_VEHICLE_MODE` (dev-only sim toggle).
- Storage namespaces: `veh_intel:`, `veh:`, `scan:`, `vin_decode:<uid>:`, `jarvis_token`, `jarvis_guest`, `jarvis_current_uid`.

Compatibility risk is HIGH for `VehicleDataProvider`/`VehicleContext` (every screen) and all `user_id`-scoped routes. Changing prediction `source` enum requires updating `SOURCE_META` + tests together.
