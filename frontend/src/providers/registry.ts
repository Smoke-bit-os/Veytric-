// VEYTRIC — Versioned Provider Registry + structured errors (Prompt 1, Phase 1B)
// Additive. Providers are ADAPTERS around verified services; they never replace
// them. Every provider must fail safely and ultimately let the router return
// UNAVAILABLE when authoritative info cannot be obtained.
import { AuthorityZone, EvidenceRecord } from "@/src/evidence";

export const PROVIDER_REGISTRY_VERSION = 1 as const;

export type Capability =
  | "vehicle.live_pid"
  | "vehicle.supported_pids"
  | "vehicle.read_dtcs"
  | "vehicle.clear_dtcs"
  | "vehicle.read_vin"
  | "vehicle.read_voltage"
  | "vehicle.read_readiness"
  | "vehicle.read_mode06"
  | "vehicle.scan_modules"
  | "vehicle.raw_can"
  | "vehicle.performance_recording"
  | "vehicle.history"
  | "specification.lookup"
  | "maintenance.recommendation"
  | "research.lookup"
  | "ai.interpret"
  | "report.generate";

export type Platform = "web" | "ios" | "android";
export type ProviderType = "vehicle" | "simulation" | "specification" | "maintenance" | "research" | "ai" | "report";
export type HealthState = "ok" | "degraded" | "down";

/** Structured provider error codes — NO generic success-with-default after failure. */
export enum ProviderErrorCode {
  Unavailable = "unavailable",
  Unsupported = "unsupported",
  PermissionDenied = "permission_denied",
  AuthenticationRequired = "authentication_required",
  OwnershipFailure = "ownership_failure",
  Timeout = "timeout",
  Disconnected = "disconnected",
  MalformedResponse = "malformed_response",
  PartialResponse = "partial_response",
  StaleData = "stale_data",
  RateLimited = "rate_limited",
  ProviderConfigurationError = "provider_configuration_error",
  ProviderFailure = "provider_failure",
  UnsafeOperationRejected = "unsafe_operation_rejected",
}

export class ProviderError extends Error {
  code: ProviderErrorCode;
  providerId?: string;
  constructor(code: ProviderErrorCode, message: string, providerId?: string) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.providerId = providerId;
  }
}

export interface CapabilityRequest {
  capability: Capability;
  userId: string;
  vehicleId?: string | null;
  sessionId?: string | null;
  params?: Record<string, any>;
}

export interface RouterRuntime {
  platform: Platform;
  isDev: boolean; // mirrors __DEV__ (native dev build)
}

export interface RouterContext {
  runtime: RouterRuntime;
  /** Ownership gate — must return true before a provider executes. */
  ownsVehicle?: (userId: string, vehicleId: string) => boolean | Promise<boolean>;
  /** Authententication gate — false => AuthenticationRequired. */
  isAuthenticated?: (userId: string) => boolean | Promise<boolean>;
  now?: () => number;
}

export interface Provider {
  providerId: string;
  providerVersion: string;
  providerType: ProviderType;
  authorityZone: AuthorityZone;
  platforms: Platform[];
  capabilities: Capability[];
  /** True only for real vehicle/measurement providers. */
  canProduceMeasured: boolean;
  /** Marks a non-production provider (e.g. simulation). Filtered out of native production. */
  nonProduction?: boolean;
  timeoutMs: number;
  /** Router order: lower runs first. */
  priority?: number;

  isAvailable(ctx: RouterContext): boolean | Promise<boolean>;
  health(): HealthState | Promise<HealthState>;
  /** Execute the capability. Return EvidenceRecords or throw a ProviderError. */
  execute(req: CapabilityRequest, ctx: RouterContext): Promise<EvidenceRecord[]>;
}

export class ProviderRegistry {
  readonly version = PROVIDER_REGISTRY_VERSION;
  private providers: Provider[] = [];

  register(p: Provider): void {
    if (this.providers.some((x) => x.providerId === p.providerId))
      throw new Error(`Duplicate providerId: ${p.providerId}`);
    // A provider that declares it produces measured evidence but is a
    // non-production/simulation type is a configuration error.
    if (p.canProduceMeasured && p.nonProduction)
      throw new Error(`Provider ${p.providerId} cannot both be non-production and produce MEASURED evidence`);
    this.providers.push(p);
  }

  all(): readonly Provider[] {
    return this.providers;
  }

  /** Providers declaring a capability, ordered by priority (stable). */
  providersFor(capability: Capability): Provider[] {
    return this.providers
      .filter((p) => p.capabilities.includes(capability))
      .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }
}
