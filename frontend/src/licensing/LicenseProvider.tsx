import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/src/auth";
import { subscriptionService } from "@/src/subscriptions/subscriptionService";
import { licenseService } from "./licenseService";
import { licenseCache } from "./licenseCache";
import { reconcile } from "./trialEngine";
import { tierHasFeature, requiredTier } from "./featureRegistry";
import { DEFAULT_ENTITLEMENT, TIER_LABELS } from "./licenseConstants";
import { Entitlement, Tier } from "./licenseTypes";

// ============================================================================
//  LicenseProvider — the single source of truth for feature authorization in
//  the app. Loads the cached entitlement first (instant, offline-first), then
//  revalidates with the backend. Screens use useEntitlement()/useLicense()
//  and NEVER read tiers directly.
// ============================================================================

type LicenseContextValue = {
  entitlement: Entitlement;
  loading: boolean;
  offline: boolean;
  refresh: () => Promise<void>;
  startTrial: () => Promise<{ ok: boolean; error?: string }>;
  restore: () => Promise<{ configured: boolean; message: string }>;
  developerSet: (action: string) => Promise<void>;
  clearCache: () => Promise<void>;
};

const LicenseCtx = createContext<LicenseContextValue>({
  entitlement: DEFAULT_ENTITLEMENT,
  loading: true,
  offline: false,
  refresh: async () => {},
  startTrial: async () => ({ ok: false }),
  restore: async () => ({ configured: false, message: "" }),
  developerSet: async () => {},
  clearCache: async () => {},
});

export function LicenseProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [entitlement, setEntitlement] = useState<Entitlement>(DEFAULT_ENTITLEMENT);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const isGuest = (user as any)?.id === "guest";

  const apply = useCallback(async (ent: Entitlement, cache = true) => {
    const reconciled = reconcile(ent);
    setEntitlement(reconciled);
    if (cache) await licenseCache.save(reconciled);
  }, []);

  const refresh = useCallback(async () => {
    // Guests / logged-out users are always Free (local only).
    if (!user || isGuest) {
      setEntitlement(DEFAULT_ENTITLEMENT);
      setOffline(false);
      setLoading(false);
      return;
    }
    try {
      const ent = await licenseService.fetch();
      setOffline(false);
      await apply(ent, true);
    } catch {
      // Offline — fall back to reconciled cache.
      setOffline(true);
      const cached = await licenseCache.load();
      setEntitlement(cached ? reconcile(cached) : DEFAULT_ENTITLEMENT);
    } finally {
      setLoading(false);
    }
  }, [user, isGuest, apply]);

  // Initial + reactive load. Load cache immediately for a fast paint, then
  // revalidate against the backend whenever the auth user changes.
  const bootedFor = useRef<string | null>(null);
  useEffect(() => {
    if (authLoading) return;
    const uid = (user as any)?.id ?? "none";
    if (bootedFor.current === uid) return;
    bootedFor.current = uid;
    (async () => {
      setLoading(true);
      const cached = await licenseCache.load();
      if (cached && user && !isGuest) setEntitlement(reconcile(cached));
      await refresh();
    })();
  }, [authLoading, user, isGuest, refresh]);

  const startTrial = useCallback(async () => {
    try {
      const res = await subscriptionService.startTrial();
      await apply(res.entitlement as Entitlement, true);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, error: e?.message || "Could not start trial" };
    }
  }, [apply]);

  const restore = useCallback(async () => {
    try {
      const res = await subscriptionService.restore();
      if (res.entitlement) await apply(res.entitlement as Entitlement, true);
      return { configured: res.status !== "not_configured", message: res.message || "" };
    } catch {
      return { configured: false, message: "Could not reach the store." };
    }
  }, [apply]);

  const developerSet = useCallback(async (action: string) => {
    const res = await subscriptionService.developerSet(action);
    await apply(res.entitlement as Entitlement, true);
  }, [apply]);

  const clearCache = useCallback(async () => {
    await licenseCache.clear();
    await refresh();
  }, [refresh]);

  return (
    <LicenseCtx.Provider
      value={{ entitlement, loading, offline, refresh, startTrial, restore, developerSet, clearCache }}
    >
      {children}
    </LicenseCtx.Provider>
  );
}

// ---- Hooks -----------------------------------------------------------------

export function useLicense() {
  const c = useContext(LicenseCtx);
  return {
    tier: c.entitlement.tier as Tier,
    tierLabel: TIER_LABELS[c.entitlement.tier],
    status: c.entitlement.status,
    trialDaysRemaining: c.entitlement.trialDaysRemaining,
    trialUsed: c.entitlement.trialUsed,
    inGrace: c.entitlement.inGrace,
    entitlement: c.entitlement,
    loading: c.loading,
    offline: c.offline,
    refresh: c.refresh,
    startTrial: c.startTrial,
    restore: c.restore,
    developerSet: c.developerSet,
    clearCache: c.clearCache,
  };
}

export function useEntitlement(feature: string) {
  const c = useContext(LicenseCtx);
  const hasAccess = tierHasFeature(c.entitlement.tier, feature);
  const req = requiredTier(feature);
  return {
    hasAccess,
    requiredTier: req,
    reason: hasAccess ? null : `Requires ${TIER_LABELS[req]}`,
  };
}
