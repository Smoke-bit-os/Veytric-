// VEYTRIC — Capability Router (Prompt 1, Phase 1B)
// Resolves a capability through registered providers with an explicit, ordered
// policy and ALWAYS ends in a normalized result: EvidenceRecord[] on success, or
// an UNAVAILABLE record (never a fabricated value) on failure.
//
// Production-safety: on a native production runtime (isDev === false) any
// non-production/simulation provider is filtered OUT — provider failure can
// never route to simulation.
import {
  makeUnavailable,
  UnavailableReason,
  EvidenceRecord,
} from "@/src/evidence";
import {
  CapabilityRequest,
  Provider,
  ProviderError,
  ProviderErrorCode,
  ProviderRegistry,
  RouterContext,
} from "./registry";

export interface RouterResolution {
  ok: boolean;
  records: EvidenceRecord[];
  /** The provider that produced the records (on success). */
  providerId?: string;
  /** Structured errors from each attempted provider (on failure). */
  attempts: { providerId: string; code: ProviderErrorCode; message: string }[];
}

const ERROR_TO_REASON: Record<ProviderErrorCode, UnavailableReason> = {
  [ProviderErrorCode.Unavailable]: UnavailableReason.INACCESSIBLE,
  [ProviderErrorCode.Unsupported]: UnavailableReason.UNSUPPORTED,
  [ProviderErrorCode.PermissionDenied]: UnavailableReason.UNAUTHORIZED,
  [ProviderErrorCode.AuthenticationRequired]: UnavailableReason.UNAUTHORIZED,
  [ProviderErrorCode.OwnershipFailure]: UnavailableReason.UNAUTHORIZED,
  [ProviderErrorCode.Timeout]: UnavailableReason.TIMEOUT,
  [ProviderErrorCode.Disconnected]: UnavailableReason.DISCONNECTED,
  [ProviderErrorCode.MalformedResponse]: UnavailableReason.MALFORMED,
  [ProviderErrorCode.PartialResponse]: UnavailableReason.PARTIAL,
  [ProviderErrorCode.StaleData]: UnavailableReason.STALE_BEYOND_POLICY,
  [ProviderErrorCode.RateLimited]: UnavailableReason.INACCESSIBLE,
  [ProviderErrorCode.ProviderConfigurationError]: UnavailableReason.PROVIDER_ERROR,
  [ProviderErrorCode.ProviderFailure]: UnavailableReason.PROVIDER_ERROR,
  [ProviderErrorCode.UnsafeOperationRejected]: UnavailableReason.INACCESSIBLE,
};

function withTimeout<T>(p: Promise<T>, ms: number, providerId: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new ProviderError(ProviderErrorCode.Timeout, `Provider ${providerId} timed out after ${ms}ms`, providerId)),
      ms
    );
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

export class CapabilityRouter {
  constructor(private registry: ProviderRegistry) {}

  /** Providers eligible for this runtime + capability (production-safe, ordered). */
  private eligible(req: CapabilityRequest, ctx: RouterContext): Provider[] {
    const nativeProduction = ctx.runtime.platform !== "web" && !ctx.runtime.isDev;
    return this.registry.providersFor(req.capability).filter((p) => {
      if (!p.platforms.includes(ctx.runtime.platform)) return false;
      // Fail closed: no simulation/non-production provider on native production.
      if (nativeProduction && p.nonProduction) return false;
      return true;
    });
  }

  async resolve(req: CapabilityRequest, ctx: RouterContext): Promise<RouterResolution> {
    const attempts: RouterResolution["attempts"] = [];
    const fail = (reason: UnavailableReason, note: string): RouterResolution => ({
      ok: false,
      records: [makeUnavailable({ userId: req.userId, vehicleId: req.vehicleId ?? undefined,
        sessionId: req.sessionId ?? undefined, reason, notes: note, decodedName: req.capability })],
      attempts,
    });

    // 1) Authentication gate.
    if (ctx.isAuthenticated && !(await ctx.isAuthenticated(req.userId)))
      return fail(UnavailableReason.UNAUTHORIZED, "not authenticated");

    // 2) Ownership gate (only when a vehicle is targeted).
    if (req.vehicleId && ctx.ownsVehicle && !(await ctx.ownsVehicle(req.userId, req.vehicleId)))
      return fail(UnavailableReason.UNAUTHORIZED, "vehicle ownership check failed");

    // 3) Candidate providers.
    const candidates = this.eligible(req, ctx);
    if (candidates.length === 0)
      return fail(UnavailableReason.UNSUPPORTED, `no provider for ${req.capability} on ${ctx.runtime.platform}`);

    // 4) Ordered execution with availability + health + timeout.
    for (const p of candidates) {
      try {
        if (!(await p.isAvailable(ctx))) {
          attempts.push({ providerId: p.providerId, code: ProviderErrorCode.Unavailable, message: "not available" });
          continue;
        }
        const h = await p.health();
        if (h === "down") {
          attempts.push({ providerId: p.providerId, code: ProviderErrorCode.Unavailable, message: "health down" });
          continue;
        }
        const records = await withTimeout(p.execute(req, ctx), p.timeoutMs, p.providerId);
        if (records && records.length > 0)
          return { ok: true, records, providerId: p.providerId, attempts };
        attempts.push({ providerId: p.providerId, code: ProviderErrorCode.Unavailable, message: "empty result" });
      } catch (e) {
        const code = e instanceof ProviderError ? e.code : ProviderErrorCode.ProviderFailure;
        attempts.push({ providerId: p.providerId, code, message: (e as Error).message });
        // continue to the next provider (never invent a result)
      }
    }

    // 5) No provider succeeded -> UNAVAILABLE with the most recent failure reason.
    const last = attempts[attempts.length - 1];
    const reason = last ? ERROR_TO_REASON[last.code] : UnavailableReason.INACCESSIBLE;
    return fail(reason, last ? `${last.providerId}: ${last.message}` : "no provider succeeded");
  }
}
