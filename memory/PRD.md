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

## Implemented (2026-08-03)
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
