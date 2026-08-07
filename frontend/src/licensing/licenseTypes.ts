// Core licensing types — the single vocabulary for tiers, subscription state
// and the feature registry. The backend is the source of truth; these mirror
// the shape returned by GET /api/subscription.

export type Tier = "free" | "pro" | "shop";

export type SubStatus = "none" | "trial" | "active" | "grace" | "expired";

export type Entitlement = {
  tier: Tier;
  storedTier?: Tier;
  status: SubStatus;
  trialUsed: boolean;
  trialDaysRemaining: number;
  trialEnd?: string | null;
  inGrace: boolean;
  gracePeriodEnd?: string | null;
  subscriptionEnd?: string | null;
  autoRenew?: boolean;
  provider?: string;
  lastValidation?: string | null;
  _cachedAt?: string;
};

export type FeatureDef = {
  key: string;
  label: string;
  description: string;
  tier: Tier;
  category: string;
};
