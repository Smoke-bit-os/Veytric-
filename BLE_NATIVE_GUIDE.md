# JARVIS AI — Native BLE (Innova OBD-II) Guide

This app talks to a physical **Innova Wireless Bluetooth OBD-II adapter** (and
generic ELM327 BLE clones) through a production BLE transport built on
`react-native-ble-plx`. BLE is a **native module** — it does **not** run in Expo
Go or the web preview. You must build a native binary (Dev Client or production)
to use real hardware. Simulation Mode runs everywhere and mirrors the exact same
data model, so the UI/AI/diagnostics are identical.

---

## 1. Architecture (swappable transports)

```
UI / AI / Diagnostics  ──consumes──▶  Normalized VehicleData model
                                            ▲
                                 VehicleDataProvider (interface)
                                   ├── SimulationProvider   (default, all envs)
                                   └── BleProvider          (native only)
                                         └── Elm327Connection (GATT + AT engine)
                                               └── decoders.ts (pure OBD parsing)
```

- `src/vehicle/types.ts` — normalized model + provider interface.
- `src/vehicle/simulationProvider.ts` — driving-cycle simulator.
- `src/vehicle/bleProvider.ts` — real BLE transport (native).
- `src/vehicle/bleProvider.web.ts` — web stub so ble-plx is never web-bundled.
- `src/vehicle/obd/elm327.ts` — ELM327 command engine (init, protocol detect,
  serialized queue, notification buffering, logging, voltage, supported PIDs).
- `src/vehicle/obd/decoders.ts` — pure Mode 01/03/09 decoders + bitmask parser.
- `src/vehicle/service.tsx` — React context; picks the transport, streams data.

**Switching to real hardware = one env var. No UI/AI changes.**

---

## 2. Enable BLE mode

Set in `frontend/.env` (native build only):

```
EXPO_PUBLIC_VEHICLE_MODE=ble
```

Leave it unset (or `simulation`) for preview/demo. On a native build with `ble`,
`createProvider()` in `service.tsx` lazy-requires `BleProvider`.

---

## 3. Permissions (already configured in app.json)

**Android** (`expo.android.permissions`):
`BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `ACCESS_FINE_LOCATION`, `RECORD_AUDIO`.
The `react-native-ble-plx` config plugin injects the Android 12+ manifest flags.

**iOS** (`expo.ios.infoPlist`):
`NSBluetoothAlwaysUsageDescription`, `NSMicrophoneUsageDescription`.

At runtime the app requests BLE permission on first scan; the connection flow
shows recovery steps if permission or Bluetooth is unavailable.

---

## 4. Build instructions (Emergent-managed)

This project's builds are handled by Emergent — you do **not** run EAS CLI or
manage an Expo account yourself.

1. Click **Publish** (top-right) → **Deploy your app**.
2. Then **Generate iOS and Android builds** (provide the requested credentials).
3. Install the generated build on a real phone (Dev Client or production).
4. Ensure `EXPO_PUBLIC_VEHICLE_MODE=ble` was set before the build so the BLE
   transport is active.

> A Dev Client build is recommended while validating hardware — it lets you
> iterate on JS over the native BLE runtime.

---

## 5. Innova / ELM327 compatibility

The BLE layer auto-detects adapters advertising names matching:
`obd, elm, innova, obdii, vgate, viecar, ediag, konnwei, veepeak` (extend
`NAME_MATCH` in `bleProvider.ts` if your unit uses a different name).

GATT service/characteristic candidates probed (in order): `FFF0/FFF1/FFF2`,
`FFE0/FFE1`, Nordic UART `6E4000xx`. Add your adapter's UUIDs to
`SERVICE_CANDIDATES` in `obd/elm327.ts` if it isn't detected.

Handshake: `ATZ → ATE0 → ATL0 → ATS0 → ATH1 → ATSP0 → ATRV → 0100 → ATDPN`,
then supported-PID discovery via `0100/0120/0140/0160` bitmasks.

Protocol auto-detection maps `ATDPN` → AUTO / CAN 11-bit / CAN 29-bit /
ISO 9141-2 / ISO 14230 KWP / J1850, etc.

Implemented OBD services:
- **Mode 01** live data (RPM, speed, load, temps, MAP, MAF, throttle, trims,
  timing, O2/lambda, fuel level, baro, module voltage, oil temp, catalyst…).
- **Mode 03 / 07** current & pending DTCs.
- **Mode 04** clear DTCs.
- **Mode 02** freeze-frame snapshot.
- **Mode 09** VIN (PID 02), Calibration IDs (PID 04), ECU name (PID 0A).

Robustness: serialized command queue, per-request timeout + latency, request/
response logging (last 200 exchanges), unsupported-PID skipping, and automatic
reconnect (up to 3 backoff attempts) on unexpected disconnect.

---

## 6. Hardware test checklist (Innova OBD-II)

Run through this on a real vehicle + native build:

- [ ] Plug the Innova adapter into the OBD-II port; ignition **ON** (engine on
      for charging/live-load tests).
- [ ] Phone Bluetooth ON; grant the BLE permission prompt.
- [ ] **Connection Center**: adapter is discovered by name; status reaches
      "Vehicle connected".
- [ ] **Connection Diagnostics** screen shows: adapter name, device ID
      (MAC on Android / UUID on iOS), detected **protocol**, **voltage** (~13.8–
      14.6 V engine running), **latency** (typically 20–120 ms), quality, and a
      non-zero **supported PID** count.
- [ ] **OBD log monitor** shows real `»`/`«` traffic (not the simulation note).
- [ ] **Live dashboard**: RPM/speed/coolant/throttle track reality; rev the
      engine and confirm RPM + MAP/MAF respond.
- [ ] **DTCs**: if the MIL is on, current codes populate; "Ask JARVIS" returns
      analysis. Verify **Clear DTCs** turns the MIL off (re-scan after a drive
      cycle).
- [ ] **Freeze frame**: loads a captured snapshot when a DTC is present.
- [ ] **Vehicle ID**: VIN decodes to 17 chars; Cal IDs / ECU populate.
- [ ] **Reconnect**: unplug/replug the adapter — app auto-reconnects (watch the
      "RECONNECTS" counter) or the Reconnect button restores the link.
- [ ] **Unsupported PIDs**: no crashes on vehicles missing certain PIDs (they
      are skipped; gauges stay at last/zero).

Record any adapter that isn't detected (name + service UUIDs from a BLE scanner
app) and add it to `NAME_MATCH` / `SERVICE_CANDIDATES`.

---

## 7. Known native-only limitations

- Real BLE, microphone voice capture, and audio playback require a device build.
- iOS returns a random per-app device UUID (not the MAC) by design.
- Some manufacturer-specific PIDs (trans temp, oil pressure, gear, HP/torque)
  are estimated or unavailable over generic OBD-II and may read 0 until a
  vehicle-specific PID map is added.
