import { Tier } from "@/src/licensing/licenseTypes";
import { PurchasesApi, Product, PurchaseResult, MOCK_PRODUCTS } from "./purchaseTypes";
import { subscriptionService } from "./subscriptionService";

// Development-only purchase provider. Simulates a store purchase by driving the
// backend developer endpoint. Never used in production release builds.

export const mockPurchases: PurchasesApi = {
  name: "mock",
  async initialize() {},
  async getProducts(): Promise<Product[]> {
    return MOCK_PRODUCTS;
  },
  async purchasePlan(planId: Tier): Promise<PurchaseResult> {
    try {
      await subscriptionService.developerSet(planId === "shop" ? "shop" : "pro");
      return { success: true, planId };
    } catch (e: any) {
      return { success: false, error: e?.message || "Purchase failed" };
    }
  },
  async restorePurchases() {
    return subscriptionService.restore();
  },
  async getSubscriptionStatus() {
    return subscriptionService.get();
  },
  async validateReceipt() {
    return subscriptionService.validate();
  },
  async refreshEntitlements() {
    return subscriptionService.get();
  },
  cancelSubscriptionInfo() {
    return { url: null, message: "Use Developer Mode to change or reset the subscription." };
  },
  async dispose() {},
};
