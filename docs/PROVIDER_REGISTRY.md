# VEYTRIC — Provider Registry & Capability Router

_Prompt 1._ Phase 1A documented the contract intent. **Phase 1B (implemented)**
adds the executable registry + router + BLE adapter and their tests:
`frontend/src/providers/registry.ts`, `router.ts`,
`adapters/bleVehicleAdapter.ts`, tests `frontend/src/__tests__/providerRouter.test.mjs`.
Existing services are wrapped (never replaced).

## Design rules (binding)
- One versioned Provider Registry contract; one Capability Router.
- **Do not replace** established working services — wrap them with adapters.
- Every provider **fails safely** and ultimately returns **UNAVAILABLE** when
  authoritative information cannot be obtained.
- No silent boundary crossing: native production provider failure never routes
  to simulation; BYOK/Local AI never silently falls back to paid Cloud.

## Capability Router (Phase 1B)
`resolve(capabilityRequest)` →
1. verify auth + user/vehicle ownership,
2. find providers declaring the capability,
3. check platform + runtime availability + health,
4. apply an explicit ordered-provider policy,
5. execute with timeout,
6. return normalized `EvidenceRecord`(s) or a structured error → **UNAVAILABLE**.

Never invents a result; never crosses a prohibited provider boundary.

### Capabilities (names align with existing conventions)
`vehicle.live_pid · vehicle.supported_pids · vehicle.read_dtcs ·
vehicle.clear_dtcs · vehicle.read_vin · vehicle.read_voltage ·
vehicle.read_readiness · vehicle.read_mode06 · vehicle.scan_modules ·
vehicle.raw_can · vehicle.performance_recording · vehicle.history ·
specification.lookup · maintenance.recommendation · research.lookup ·
ai.interpret · report.generate`

## Provider Registry contract (Phase 1B)
Each registered provider declares: `providerId`, `providerVersion`,
`providerType`, `authorityZone`, supported platforms, supported capabilities,
`canProduceMeasuredEvidence` (bool), availability check, health check,
request/query method, timeout policy, retry policy, cancellation behavior,
structured errors, source metadata, auth requirements, user/vehicle ownership
requirements, redaction requirements, retention requirements.

### Structured provider errors (distinct)
`Unavailable · Unsupported · PermissionDenied · AuthenticationRequired ·
OwnershipFailure · Timeout · Disconnected · MalformedResponse · PartialResponse ·
StaleData · RateLimited · ProviderConfigurationError · ProviderFailure ·
UnsafeOperationRejected`. **No** generic "success + believable default" after failure.

## Current provider surface to be wrapped
| Capability area | Existing module | Zone | Produces MEASURED? |
|---|---|---|---|
| Vehicle telemetry / DTC / VIN / voltage / readiness / Mode 06 / modules | `frontend/src/vehicle/bleProvider.ts` via `vehicle/types.ts::VehicleDataProvider` (+ `obd/*`, `ecu/*`, `system-monitor/*`) | ZONE1 | **Yes** (native BLE only) |
| Simulation (web/dev only) | `frontend/src/vehicle/simulationProvider.ts` | non-production | No (marked non-production; cannot enter native production or history) |
| VIN specification | `frontend/src/vehicle/vin/*` + NHTSA vPIC | ZONE2 | No (OEM_SPECIFICATION / government_vin) |
| Maintenance schedules | `frontend/src/vehicle/maintenance/*` | ZONE2/3 | No (RECOMMENDED) |
| AI interpretation | `frontend/src/ai/*` + backend `/api/ai/*` | ZONE3 | No (AI_INTERPRETATION) |
| Report generation | backend `/api/reports` | derived | No |

Adapters translate these outputs into `EvidenceRecord`s
(`frontend/src/evidence/*`) without changing the wrapped interfaces.
