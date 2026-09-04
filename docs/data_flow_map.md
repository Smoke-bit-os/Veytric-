# VEYTRIC — Vehicle Data-Flow Map (Prompt 0 baseline)

Governing rule: **the app must never guess what the vehicle said.** Missing/unsupported
data renders honestly (Unavailable / Not supported / Not yet measured), never as 0/"Good"/a random number.

## Native (Android/iOS production) — REAL path
1. **BLE permission request** — `src/vehicle/bleProvider.ts` (user-intent from Connection Center, never on launch). Failure → explicit permission state.
2. **Device discovery** — `bleProvider.scan()` → adapters list; none → `found:false` empty state.
3. **Adapter select + connect** — `bleProvider.connect(id)`; failure → `connection="failed"` (communication error).
4. **ELM327 init** — AT command sequence in bleProvider (LOCKED). 
5. **Protocol negotiation** — auto-detect; unknown → reported, not assumed.
6. **Command queue** — serialized OBD requests.
7. **Raw response** — preserved as `ObdLogEntry` (getLog()). Frame assembly + header/ECU id in bleProvider.
8. **Decode** — PID/DTC/readiness/freeze-frame/VIN/Mode06 decoders (deterministic).
9. **Validate** — malformed → rejected (not treated as measurement). NO DATA ≠ 0.
10. **State** — `service.tsx` VehicleContext: `signals`, `dtcs`, `identity`, `connection`, `dataSource`, `hasLiveData`.
    - `dataSource = REAL_BLE` only when `connected && ecuCommunication`; else `UNAVAILABLE`. Never SIMULATION on native.
11. **Persist (real scans only)** — `scanWorkflow.runScan()` → `/api/scans` (BLOCKED on web via `SIMULATED_SCAN_NOT_SAVED`). Ownership `user_id`.
12. **Cache** — user-scoped storage namespaces (`veh:`, `scan:`, `vin_decode:<uid>:`), wiped on logout/guest.
13. **UI render** — screens gate on `hasLiveData`/`connection`; unavailable → honest states.
14. **AI context** — built from real signals/DTCs/identity + labeled predictions; AI does NOT decode raw OBD or invent measurements.
15. **Reports/exports** — `/api/reports`, `/api/scans/{id}/analyze` over real evidence.

## Web (browser preview) — SIMULATION path (clearly a simulator, isolated)
- `service.tsx createProvider()` returns `SimulationProvider` (web only). `mode="simulation"`, `dataSource="SIMULATION"`.
- Simulated telemetry (Math.random state machine) NEVER persists as a real scan (runScan throws on web).
- Native production **cannot** reach this path (see provider safety).

## Provider safety (enforced twice)
- `service.tsx`: web→Sim; native→Sim only if `__DEV__ && EXPO_PUBLIC_VEHICLE_MODE=sim`; else BleProvider. Production `__DEV__===false`.
- `simulationProvider.ts` constructor: throws if `Platform.OS!=="web" && !__DEV__` → simulation is architecturally impossible in native production.

## LLM involvement audit (must NOT do these — none found)
- LLM does NOT decode raw OBD responses. ✅
- LLM does NOT compute values deterministic code should compute. ✅
- LLM does NOT supply missing measurements or unsupported specs. ✅
- LLM does NOT transmit/control OBD/CAN commands. ✅
- LLM output is labeled AI_INTERPRETATION over visible evidence. ✅

## Uncertain boundaries to address in Prompt 1
- Readiness monitors currently derived heuristically from identity+DTCs (gated behind `connected`); true Mode 01 PID 01 readiness-bit parsing is a Prompt 1 upgrade.
- Raw-frame retention exists via `getLog()` in-memory but is not persisted per scan (documented gap).
- codes.tsx "history/stored/confirmed" DTC groups reference values not in `Dtc.type` union (pre-existing; those groups render empty).
