import React, { createContext, useContext, useMemo } from "react";
import { mockPurchases } from "./mockPurchases";
import { revenueCatProvider } from "./revenueCatProvider";
import { PurchasesApi } from "./purchaseTypes";

// Selects the active billing provider. In development builds we use the mock
// provider (drives the backend developer endpoint) so the full upgrade flow is
// testable without native billing. Production uses RevenueCat once configured.

const PurchasesCtx = createContext<PurchasesApi>(mockPurchases);

export function PurchasesProvider({ children }: { children: React.ReactNode }) {
  const provider = useMemo<PurchasesApi>(() => {
    // __DEV__ is true in Expo Go / preview. Real builds fall back to RevenueCat.
    if (__DEV__) return mockPurchases;
    return (revenueCatProvider as any).configured ? revenueCatProvider : mockPurchases;
  }, []);

  return <PurchasesCtx.Provider value={provider}>{children}</PurchasesCtx.Provider>;
}

export const usePurchases = () => useContext(PurchasesCtx);
