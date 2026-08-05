# JARVIS AI — Product Requirements Document

## Original Problem Statement
Futuristic mobile app "JARVIS AI": intelligent automotive assistant, personal AI companion, and vehicle diagnostic center. Premium dark theme with glowing blue/cyan HUD accents. Home screen with conversational AI, voice activation, and live vehicle status dashboard (battery voltage, RPM, coolant/oil temp, fuel trims, boost/MAP, throttle, speed, charging, DTCs). Floating mic, OBD-II indicator, animated AI orb. Sections for Live Diagnostics, Vehicle Health, Repair Assistant, Garage, etc. Natural-language diagnostics combining live sensor data + automotive knowledge.

## User Choices
- AI model: OpenAI GPT 5.4 (via Emergent LLM key)
- Voice: input (Whisper STT) + spoken replies (OpenAI TTS)
- Live sensor data: realistic SIMULATED (no physical OBD-II adapter in preview)
- Auth: JWT email/password + multiple saved vehicles
- Priority sections: Home Dashboard, Live Diagnostics, AI Repair Assistant, Vehicle Health, Garage

## Architecture
- Frontend: Expo SDK 54, expo-router (tabs), react-native-reanimated (orb), react-native-gifted-charts, expo-blur (glass), expo-audio (voice), expo-image. Theme from design_guidelines.json (Rajdhani display font, cyan #00E5FF / blue #0055FF on obsidian #06080D).
- Backend: FastAPI + MongoDB (motor). emergentintegrations LlmChat (GPT 5.4), OpenAISpeechToText, OpenAITextToSpeech. JWT (pyjwt) + bcrypt auth.
- Telemetry simulated client-side (src/telemetry.tsx) with random-walk + history for charts + derived health scores.

## Core Requirements (static)
- Live HUD dashboard, conversational diagnostics with live-sensor context, voice in/out, vehicle health scoring, garage management, secure profiles.

## Implemented (2026-08-05) — Iteration 6: Performance Recorder & Telemetry Analysis Suite
- Data layer (transport-agnostic, works in Simulation + BLE): `recording/recorder.ts` (buffer + downsample to 1000pts + summary stats + distance), `recording/recordingContext.tsx` (RecordingProvider mounted in _layout, feeds live signal frames, auto-upserts vehicle by VIN on save), `telemetry/events.ts` (driving-event detection), `charts/SignalChart.tsx` (SVG scrub cursor chart), `performance/analysisService.ts` + `performance/export.ts` (CSV/JSON/PDF via expo-file-system/print/sharing).
- Backend recording endpoints (all JWT-scoped): POST/GET/DELETE /api/recordings, GET /api/recordings?vehicle_id=, GET /api/vehicles/{id}/performance (count/recent/longest/fastest/highestRpm/trends), POST /api/recordings/{id}/analyze (GPT-5.4, persists ai_analysis).
- 4 new screens: `record.tsx` (large live gauges, timer, start/pause/resume/stop, live event feed, save-with-notes modal), `recordings.tsx` (sessions list w/ stats + AI badge + compare-select mode), `playback.tsx` (synchronized scrubbable SignalCharts, play/pause, 0.5x-4x speed, event bookmarks, AI anomaly analysis, CSV/JSON/PDF export), `compare.tsx` (overlay chart, side-by-side metric deltas, automatic highlights, AI comparison summary).
- Entry points (Option C): Home dashboard prominent START RECORDING CTA + sessions history button; Diagnostics tab RECORD LIVE SESSION button when connected; Vehicle Profile Performance card (top speed/peak rpm/session count, recent sessions, Record New + View All).
- Tested: backend 5/5 new pytest + 32/33 regression (1 unrelated pre-existing flake); frontend 100% acceptance incl. full record→save→playback→analyze and compare flows.

- Modular additive layer (BLE transport + diagnostics engine untouched): `src/vehicle/database/` (knownIssues failure-pattern KB per make; simProfiles demo VINs), `src/vehicle/enrichment/` (vinHistory raw-VIN store with timestamp+source; enrichmentService → specs + common issues + AI platform summary), `src/vehicle/profile/` (profileService API wrapper).
- Backend Vehicle Profile system: POST /api/vehicles/upsert-by-vin (idempotent per user+VIN), PATCH /api/vehicles/{id} (name/mileage), GET /api/vehicles/{id} (aggregated specs + health_history + history{maintenance,parts,dtc} + reports linked by vehicle_id OR VIN), POST /api/vehicles/{id}/history/{kind}, POST /api/vehicles/{id}/health (capped 60). VIN decode now returns bodyStyle + manufacturer.
- New Vehicle Profile screen: specs, editable mileage, common failure patterns (likelihood-coded), scan/maintenance/parts/DTC histories, health-score sparkline. Reachable from Garage vehicle card.
- Connection Center saves via upsert-by-VIN (+ records raw VIN, appends health sample) and shows a "known failure patterns loaded" note; AI Repair Assistant now receives a vehicle platform summary incl. common issues.
- Fixed a malformed GET-profile reports query (curl-verified). Tested: backend 28/28 pytest; frontend 100% acceptance + regression.

## Implemented (2026-08-03) — Iteration 4: VIN Decode Enrichment
- Separate VIN service layer (`src/vehicle/vin/`): ISO 3779 checksum + format validator, offline local decoder (WMI→make/country, year char, plant), and `vinService` orchestrator (cache → backend → local fallback) that works OFFLINE after first decode (cached in storage by VIN).
- Backend `POST /api/vin/decode`: multi-provider — tries NHTSA vPIC (real, keyless) then local WMI/checksum fallback; returns year/make/model/trim/engine/transmission/drivetrain/plant/country + confidence + source + checksumValid.
- Auto-enrichment after connect: VIN decoded, merged into vehicle identity (`enrichIdentity`), JARVIS voice announces "Vehicle identified…", enriched profile saved to Garage and linked to scan reports; identity (year/make/model/trim/engine/VIN) injected into AI chat + DTC analysis context so JARVIS understands the exact platform.
- Connection Center UI: vehicle preview placeholder, confidence % pill, VIN, year/make/model, engine/transmission, decode-source line, and "ECU MODULES DETECTED" chips.
- Verified: backend 19/19 pytest; all frontend VIN + regression flows pass. NHTSA returned Jeep Wrangler Unlimited Sahara / Toledo / 3.6L / 4WD at 95% confidence.

## Implemented (2026-08-03) — Iteration 3: Native BLE production layer + Connection Diagnostics
- ELM327 command engine (`src/vehicle/obd/elm327.ts`): GATT service auto-resolve, notification buffering, serialized command queue with per-request timeout + latency, AT handshake (ATZ/ATE0/ATL0/ATS0/ATH1/ATSP0), voltage (ATRV), protocol auto-detect (ATDPN → AUTO/CAN 11/29-bit/ISO9141/KWP/J1850), supported-PID discovery (0100/0120/0140/0160 bitmasks), 200-entry request/response log.
- Pure OBD decoders (`src/vehicle/obd/decoders.ts`): Mode 01 PID map (30+ decoders), bitmask parser, Mode 03/07 DTC decode, Mode 09 VIN/CalID extraction, protocol name map.
- `BleProvider` rewritten (native): auto adapter detection (name/UUID candidates), full VehicleDataProvider incl. Mode 01 live polling with unsupported-PID fallback, Mode 03/07 DTCs, Mode 04 clear, Mode 02 freeze frame, Mode 09 VIN/CalID/ECU identity, getDiagnostics/getLog/readFreezeFrame/reconnect/onConnectionChange, and 3-attempt backoff auto-reconnect.
- SimulationProvider mirrors the full surface (synthetic OBD log, diagnostics, freeze frame) so everything is demoable in preview.
- NEW Connection Diagnostics screen (`app/ble-diagnostics.tsx`): adapter name, device ID (MAC/UUID), protocol, voltage, latency, quality, supported-PID count, reconnect counter + button, freeze-frame viewer, live OBD request/response log monitor.
- Docs: `/app/BLE_NATIVE_GUIDE.md` (architecture, EXPO_PUBLIC_VEHICLE_MODE=ble, permissions, Emergent build steps, Innova/ELM327 compatibility, hardware test checklist). app.json BLE permissions verified.
- Tested (frontend): all new + regression flows pass; iteration-2 blockers confirmed fixed.

## Implemented (2026-08-03) — Iteration 2: Innova BLE Integration Module
- Modular swappable vehicle data layer (`src/vehicle/`): `VehicleDataProvider` interface, `SimulationProvider` (driving-cycle state machine, 43 PIDs), `BleProvider` (react-native-ble-plx ELM327 transport, native-only, web stub `bleProvider.web.ts`). Transport selected via `EXPO_PUBLIC_VEHICLE_MODE` (default simulation). Service context auto-connects + streams + history.
- Vehicle Connection Center (`app/connect.tsx`): animated radar scan → found → connecting → connected/failed, adapter card (model/signal/battery/firmware/protocol/quality), automatic vehicle identification (VIN/year/make/model/trim/engine/trans/fuel/odometer/emissions/ECU/CalIDs/protocols) → Save to Garage, JARVIS TTS announcement, failure-cause recovery steps.
- Expanded Live Diagnostics: 43 grouped PIDs with live sensor rows + chart chip selector.
- Vehicle Health: 12 subsystem color-coded scores, heuristic AI findings (offline), DTC accordion with per-code cloud AI analysis (`POST /api/dtc/analyze`, GPT-5.4), predictive maintenance with life bars.
- Professional Scan Reports (`app/reports.tsx` + `POST/GET /api/reports`): AI-generated findings + next steps, list, expand, native Share.
- app.json: BLE plugin + Android BLUETOOTH_SCAN/CONNECT/FINE_LOCATION + iOS NSBluetoothAlwaysUsageDescription.
- Fixed FE↔BE vehicle payload schema mismatch (dtc/analyze + reports now accept string/dict), hardened reports render, replaced invalid icon. Backend 15/15 pytest pass.

## Implemented (2026-08-03) — Iteration 1
- Auth (register/login/me, JWT, bcrypt) — tested 11/11 backend pytest.
- Garage: add/list/activate(single-active)/delete vehicles.
- AI Repair Assistant: /api/chat with telemetry+vehicle context (GPT 5.4), persistent history, voice record→STT→send, TTS auto-playback, suggestion chips.
- Home Dashboard: animated AI orb, OBD-II indicator, 8 live gauges, fuel trims, voice FAB.
- Live Diagnostics: sensor chip row + live line chart + streaming sensor rows.
- Vehicle Health: overall + per-system color-coded scores, DTC accordion, predictive maintenance reminders.

## Backlog
- P1: Real Bluetooth OBD-II adapter integration (needs native build).
- P1: Additional sections — Maintenance History, Trip Data, Parts Lookup, Service Manuals, Wiring Diagrams, CAN Bus Analyzer, Oscilloscope, Performance Logs, Customer Reports, AI Memory.
- P2: Customizable/reorderable dashboard gauges, cloud sync, offline AI, streaming chat responses.
- P2: Silence RN-web shadow/pointerEvents deprecation warnings.

## Next Tasks
- Add Maintenance History + Trip Data screens next (highest user value from remaining sections).
