import { Tier } from "@/src/licensing/licenseTypes";
import { PurchasesApi, Product, PurchaseResult } from "./purchaseTypes";
import { subscriptionService } from "./subscriptionService";

// Placeholder RevenueCat provider. Conforms to the PurchasesApi interface but
// stays disabled until credentials + product identifiers are supplied. Wiring
// real RevenueCat later is a configuration task, not an architectural change:
// implement initialize()/getProducts()/purchasePlan() against the SDK and
// point the backend /subscription/validate + /restore stubs at RevenueCat.

const NOT_CONFIGURED: PurchaseResult = {
  success: false,
  error: "In-app purchases are not configured yet. Add RevenueCat credentials to enable.",
};

export const revenueCatProvider: PurchasesApi = {
  name: "revenuecat",
  configured: false,
  async initialize() {
    /* configure Purchases with RevenueCat API key here */
  },
  async getProducts(): Promise<Product[]> {
    return [];
  },
  async purchasePlan(_planId: Tier): Promise<PurchaseResult> {
    return NOT_CONFIGURED;
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
    return { url: null, message: "Manage your subscription in the App Store or Google Play." };
  },
  async dispose() {},
} as PurchasesApi & { configured: boolean };
