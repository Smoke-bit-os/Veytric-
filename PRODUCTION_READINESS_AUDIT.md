# JARVIS AI — Production API & Secrets Readiness Audit
_Audit date: 2026-08-07 · Scope: entire codebase (backend `server.py`, Expo app, `src/vehicle/*`)_

Legend: ✅ Production Ready · 🟡 Partially Implemented · 🔴 Missing · ⚪ Mock/Simulation

---

## 1. API Integration Matrix

| Integration | Status | Notes |
|---|---|---|
| Email/Password Auth | ✅ | JWT (HS256), bcrypt hashing, 30-day token, token in SecureStore |
| Google Sign In | 🔴 | Not implemented |
| Apple Sign In | 🔴 | Not implemented |
| AI — GPT-5.4 (chat, DTC, reports, scans, trends, health) | 🟡 | Works via Emergent Universal Key; no retry/timeout/rate-limit/cost controls |
| AI — Whisper STT / OpenAI TTS | 🟡 | Implemented via Emergent key; same robustness gaps |
| BLE — react-native-ble-plx | 🟡 | Native-only, plugin + permissions configured; unusable in Expo Go/web |
| OBD-II (ELM327: live PID, DTC, clear, freeze frame, VIN, supported-PID discovery) | ✅ (native) / ⚪ (preview) | Full ELM327 engine; simulated in web/preview |
| VIN Decode — NHTSA vPIC | ✅ | Backend proxy (5s timeout) + local WMI fallback + client offline cache |
| Maps | 🔴 | No `react-native-maps`/`expo-location`; no map screens |
| File Export — PDF/CSV/JSON + native share | ✅ (native) | expo-print / expo-file-system / expo-sharing; web shows info message |
| Subscriptions (App Store / Play / receipts / restore / trial) | 🔴 | None |
| Cloud backend (FastAPI + MongoDB) | 🟡 | CRUD + JWT; no multi-device sync/conflict resolution; AsyncStorage read-cache only |
| Analytics / Crash reporting / Performance | 🔴 | None (no Sentry/analytics SDK) |

---

## 2. Detailed Findings

### Authentication
- **Current:** `POST /api/auth/register|login|me`. bcrypt (`gensalt`), JWT `sub`+`exp` (30 days), verified per request against `db.users`. Client stores token via `storage.secureSet` (expo-secure-store).
- **Missing:** Google/Apple sign-in; token **refresh** (single long-lived token, no rotation/revocation); **brute-force/rate limiting** on login; email verification / password reset.
- **Keys/accounts needed:** Google OAuth client IDs (iOS/Android/Web); Apple Developer + Services ID + .p8 key for Sign in with Apple.
- **Security:** ✅ no plaintext passwords, no hardcoded secrets. 🟡 30-day non-revocable token; 🟡 no login throttling.

### AI (GPT-5.4 + Whisper + TTS)
- **Current:** `EMERGENT_LLM_KEY` from env; `LlmChat(...).with_model("openai","gpt-5.4")` across chat, `/dtc/analyze`, `/reports`, `/recordings/{id}/analyze`, trends explain, health report, `/diagnostics/interpret`, `/scans/{id}/analyze`. Each wrapped in try/except with `logger.error` and safe HTTP 500 / fallback text.
- **Missing:** retry w/ backoff, explicit per-call timeout, request rate limiting, cost budgeting/usage metering, streaming. Offline fallback = graceful error only (no cached AI).
- **Keys:** `EMERGENT_LLM_KEY` (present). Budget top-up: Profile → Manage plan → Universal Key.

### BLE / OBD-II
- **Current:** `react-native-ble-plx@3.5.1` plugin in `app.json`; `bleProvider.ts` (native) + `bleProvider.web.ts` (stub) + `Elm327Connection` (GATT I/O, serialized queue, ATZ/ATE0/ATSP0 init, protocol auto-detect, voltage, supported-PID discovery, 4s cmd timeout, 200-entry log). Simulation provider drives preview.
- **Native permissions (configured):** Android `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `ACCESS_FINE_LOCATION`, `RECORD_AUDIO`; iOS `NSBluetoothAlwaysUsageDescription`, `NSMicrophoneUsageDescription`.
- **Gaps:** Android 12+ `neverForLocation` flag not set on BLUETOOTH_SCAN (Play policy nicety); cannot be validated in Expo Go — **requires a dev/production build + physical ELM327 adapter**.

### VIN Decode
- ✅ `POST /api/vin/decode` → NHTSA vPIC (`requests`, 5s timeout) + local WMI/checksum decoder fallback + client cache (`vin_decode_<VIN>`) → offline after first hit. Error handling logs and degrades to local. No API key required (public gov API).

### File Export
- ✅ `export.ts`: CSV/JSON (expo-file-system legacy), PDF (expo-print HTML), share (expo-sharing) for recordings, health report, scan report. Web preview returns an informational string instead of a file (expected).

### Cloud / Sync
- 🟡 FastAPI + MongoDB (`MONGO_URL`, `DB_NAME`). All data user-scoped by `user_id`. Offline: read-layer cache via AsyncStorage (`intelligence/cache.ts`). **No** write-sync, conflict resolution, or multi-device merge.

### Analytics / Crash / Privacy
- 🔴 No crash reporting (Sentry), analytics, or performance monitoring. Privacy policy + App/Play data-safety disclosures required before release (mic, Bluetooth, location usage).

---

## 3. Secrets Management (Phase 3 — DONE)
- Created **`/app/backend/.env.example`** and **`/app/frontend/.env.example`** documenting every current + planned variable.
- ✅ Verified: **no hardcoded secrets** in source; all secrets via `os.environ` / `EXPO_PUBLIC_*`. Real `.env` files are not committed.
- Rule enforced: client bundle (`EXPO_PUBLIC_*`) must never hold private secrets (receipt-validation/Apple/Play secrets live server-side only).

---

## 4. Security Review
| Item | Status |
|---|---|
| Secrets via env (no hardcode) | ✅ |
| Password hashing (bcrypt) | ✅ |
| Token at rest (SecureStore) | ✅ |
| Token refresh / revocation | 🔴 (30-day static token) |
| Login rate limiting / brute-force | 🔴 |
| CORS | 🟡 `allow_origins=["*"]` — tighten via `CORS_ALLOW_ORIGINS` for prod |
| TLS | ✅ handled by platform ingress |
| Env separation (dev/prod) | 🟡 add `ENVIRONMENT` switch |
| Certificate validation | ✅ default (system trust) |

---

## 5. Checklists

### Missing Developer Accounts
- [ ] Apple Developer Program (Sign in with Apple, App Store, push, builds)
- [ ] Google Cloud project (OAuth client IDs + Maps SDK)
- [ ] Google Play Console (billing, data safety)
- [ ] RevenueCat (recommended for cross-store subscriptions) — optional
- [ ] Sentry account — optional but recommended

### Missing API Keys / Credentials
- [ ] `GOOGLE_CLIENT_ID` / iOS / Android / Web client IDs
- [ ] Apple `Services ID`, `TEAM_ID`, `KEY_ID`, `.p8` private key
- [ ] `GOOGLE_MAPS_API_KEY` (Android; iOS uses Apple Maps)
- [ ] `APPLE_SHARED_SECRET` + Play service account (receipt validation)
- [ ] `SENTRY_DSN`
- [x] `EMERGENT_LLM_KEY` (present) · [x] `JWT_SECRET` (present) · [x] `MONGO_URL`/`DB_NAME` (present)

### Environment Variables (authoritative list)
Backend: `MONGO_URL`, `DB_NAME`, `JWT_SECRET`, `EMERGENT_LLM_KEY` (present); planned: `GOOGLE_CLIENT_ID/SECRET`, `APPLE_CLIENT_ID/TEAM_ID/KEY_ID/PRIVATE_KEY`, `GOOGLE_MAPS_API_KEY`, `REVENUECAT_SECRET_KEY`, `APPLE_SHARED_SECRET`, `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `SENTRY_DSN`, `CORS_ALLOW_ORIGINS`, `ENVIRONMENT`.
Frontend: `EXPO_PUBLIC_BACKEND_URL` (present); planned `EXPO_PUBLIC_GOOGLE_*_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`, `EXPO_PUBLIC_REVENUECAT_*`, `EXPO_PUBLIC_SENTRY_DSN`.

### Native Configuration
- [x] BLE plugin + Android/iOS permissions
- [x] Mic (audio) permissions/usage strings
- [ ] `expo-location` + usage strings (needed only if Maps/GPS breadcrumbs added)
- [ ] Apple Sign In entitlement (`expo-apple-authentication` plugin)
- [ ] Google Maps API key block in `app.json` (Android)
- [ ] Android 12+ `BLUETOOTH_SCAN` `neverForLocation` refinement

### App Store Readiness
- [ ] Sign in with Apple (required if any 3rd-party login is offered)
- [ ] Subscription products + receipt validation + Restore Purchases
- [ ] Privacy nutrition labels (Bluetooth, Mic, Location, Diagnostics data)
- [ ] Screenshots, description, support URL, privacy policy URL

### Google Play Readiness
- [ ] Billing + Play receipt validation
- [ ] Data safety form (Bluetooth/Mic/Location)
- [ ] Target API level compliance; `neverForLocation` on BLE scan

### Deployment Checklist
- [x] Secrets via env; `.env.example` committed
- [ ] Set strong production `JWT_SECRET`; `ENVIRONMENT=production`
- [ ] Restrict CORS to real origins
- [ ] Add login rate limiting + token refresh
- [ ] Add Sentry (backend + app)
- [ ] Publish → Deploy → generate iOS/Android builds (Emergent)

---

## 6. Remaining Blockers Before v1.0
1. **Auth for stores:** Apple Sign In (mandatory once social login exists) + Google Sign In — needs Apple/Google accounts + keys.
2. **Monetization:** subscription/billing + receipt validation + restore — needs store products + secrets.
3. **AI robustness:** retry, timeout, rate limiting, cost controls.
4. **Security:** token refresh/revocation, login throttling, production CORS.
5. **Observability:** crash reporting + analytics + privacy policy.
6. **Hardware validation:** BLE/OBD-II must be tested on a real dev build with a physical ELM327 adapter (cannot verify in preview/Expo Go).
7. **Maps (if pursued):** add `react-native-maps`/`expo-location`, keys, and usage strings.

**Bottom line:** Core app (auth, AI, VIN, OBD-II engine, diagnostics, recorder, maintenance intelligence, exports) is functional. Blockers to public release are external-account/key-dependent (social auth, billing, analytics) plus AI/security hardening — none can be completed without the accounts/keys listed above, so they are documented rather than fabricated.
