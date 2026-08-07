import { api } from "@/src/api";

// Thin wrapper over the backend subscription endpoints. Both the licensing
// layer and the purchase providers read authoritative state through here so
// the backend stays the single source of truth.

export const subscriptionService = {
  get: () => api.getSubscription(),
  startTrial: () => api.startTrial(),
  restore: () => api.restorePurchases(),
  validate: () => api.validateReceipt(),
  developerSet: (action: string) => api.developerSetSubscription(action),
};
