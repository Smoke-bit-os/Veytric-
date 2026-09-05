# VEYTRIC — Data Flow & Trust Zones

_Prompt 1._ Three one-way trust zones. Higher zones may **cite** lower-zone
evidence; they may never **mutate or impersonate** it.

```
 ┌────────────────────────────────────────────────────────────────┐
 │ ZONE 1 — VEHICLE EVIDENCE  (authorityZone: ZONE1_VEHICLE)        │
 │ OBD-II, ECU/module responses, CAN frames, readiness, DTCs,      │
 │ Mode 06, adapter voltage (ATRV), approved measurement devices.  │
 │ Source: bleProvider.ts / obd/* / ecu/* / system-monitor/*       │
 │ ONLY zone that creates MEASURED. Also hosts CALCULATED (derived  │
 │ deterministically from Zone-1 measurements).                     │
 └───────────────▲──────────────────────────────────┬─────────────┘
                 │ cite (read-only)                  │ produces
                 │                                    ▼
 ┌───────────────┴──────────────────────────────────────────────┐
 │ ZONE 2 — AUTHORITATIVE / TRUSTED INFO (ZONE2_AUTHORITATIVE)     │
 │ Licensed service info, OEM specs, government VIN (NHTSA vPIC),  │
 │ validated internal datasets, service schedules, USER_PROVIDED.  │
 │ Source: vehicle/vin/*, vehicle/maintenance/*                   │
 │ Creates OEM_SPECIFICATION / RECOMMENDED / USER_PROVIDED.        │
 │ CANNOT impersonate live telemetry.                             │
 └───────────────▲───────────────────────────────────────────────┘
                 │ cite (read-only)
                 │
 ┌───────────────┴───────────────────────────────────────────────┐
 │ ZONE 3 — OPEN RESEARCH & AI (ZONE3_RESEARCH_AI)                 │
 │ Open-web research, community info, AI reasoning/guidance.      │
 │ Source: frontend/src/ai/* + backend /api/ai/*                  │
 │ Creates RECOMMENDED / research / AI_INTERPRETATION.            │
 │ CANNOT mutate or replace Zone 1/2 evidence.                    │
 └────────────────────────────────────────────────────────────────┘
```

Enforcement: `validateReferenceGraph` (TS) / `validate_reference_graph` (Py) —
a MEASURED record can never list a Zone-3 record in `inputEvidenceIds`.

## Production-safety: fail closed
- Provider selection: `frontend/src/vehicle/service.tsx :: createProvider()`.
  - web → `SimulationProvider`.
  - native production (`__DEV__ === false`) → `BleProvider` **only**. There is no
    code path to simulation.
  - native + `__DEV__` → simulation allowed **only** via
    `EXPO_PUBLIC_VEHICLE_MODE=sim` (engineer's dev build).
- Second guard: `SimulationProvider` constructor throws when
  `Platform.OS !== "web" && !__DEV__` (`simulationProvider.ts`) — a shipped APK/IPA
  cannot instantiate it even if a code path tried.
- `DataSource` (`service.tsx`): native = `REAL_BLE` only when connected **and** a
  real ECU response was received (`BleStatusReport.ecuCommunication`), otherwise
  `UNAVAILABLE`. Never `SIMULATION` on native.
- Connect failure throws (`service.tsx :: connect`) — no silent fallback path.
- DTC clear re-reads from the ECU (never assumes success).
- AI: BYOK/Local run device→provider directly and never consume Cloud quota;
  Cloud runs through the metered backend. No silent BYOK/Local → Cloud fallback.

## Ownership & isolation
- Every backend record is scoped by the stable `users._id`
  (`get_current_user`). Client-supplied ids are not trusted.
- Local caches are namespaced by the authenticated user id
  (`frontend/src/utils/storage/*`); logout + one-time legacy migration clear
  account-specific caches so a second user can't inherit the first's data.

## Freshness in the flow
Live screens show only current-session Zone-1 readings as LIVE. Disconnect ends
the live session; reconnect creates/validates a new session boundary. Cached
evidence keeps its original timestamp; stale inputs never silently become
current. (Thresholds + tests: Phase 1C.)
