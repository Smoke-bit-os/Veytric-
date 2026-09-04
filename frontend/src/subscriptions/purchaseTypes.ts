import { Tier } from "@/src/licensing/licenseTypes";

// Provider-agnostic purchase types. The rest of the app talks only to the
// Purchases interface — never directly to RevenueCat / StoreKit / Play Billing.

export type Product = {
  id: string;
  planId: Tier;
  period: "monthly" | "annual";
  title: string;
  price: string;
};

export type PurchaseResult = {
  success: boolean;
  planId?: Tier;
  cancelled?: boolean;
  error?: string;
};

export interface PurchasesApi {
  name: string;
  initialize(): Promise<void>;
  getProducts(): Promise<Product[]>;
  purchasePlan(planId: Tier, period?: "monthly" | "annual"): Promise<PurchaseResult>;
  restorePurchases(): Promise<any>;
  getSubscriptionStatus(): Promise<any>;
  validateReceipt(): Promise<any>;
  refreshEntitlements(): Promise<any>;
  cancelSubscriptionInfo(): { url: string | null; message: string };
  dispose(): Promise<void>;
}

export const MOCK_PRODUCTS: Product[] = [
  { id: "pro_monthly", planId: "pro", period: "monthly", title: "VEYTRIC Pro (Monthly)", price: "$9.99" },
  { id: "pro_annual", planId: "pro", period: "annual", title: "VEYTRIC Pro (Annual)", price: "$79.99" },
  { id: "shop_monthly", planId: "shop", period: "monthly", title: "VEYTRIC Shop (Monthly)", price: "$29.99" },
  { id: "shop_annual", planId: "shop", period: "annual", title: "VEYTRIC Shop (Annual)", price: "$249.99" },
];
