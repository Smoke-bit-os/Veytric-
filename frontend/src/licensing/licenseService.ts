import { subscriptionService } from "@/src/subscriptions/subscriptionService";
import { Entitlement } from "./licenseTypes";

// Fetches authoritative entitlement state from the backend and normalizes it.
export const licenseService = {
  async fetch(): Promise<Entitlement> {
    const res = await subscriptionService.get();
    return res.entitlement as Entitlement;
  },
};
