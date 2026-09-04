import { Entitlement, Tier } from "./licenseTypes";

// Centralized configuration — change trial length / pricing / limits here
// without touching business logic or screens.

export const LICENSE_CACHE_KEY = "jarvis_license_v1";

export const TRIAL_DAYS = 30;
export const GRACE_DAYS = 3;

// Reminder milestones (days remaining) for trial expiry prompts.
export const TRIAL_REMINDER_DAYS = [7, 3, 1, 0];

export const TIER_RANK: Record<Tier, number> = { free: 0, pro: 1, shop: 2 };

export const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  pro: "VEYTRIC Pro",
  shop: "VEYTRIC Shop",
};

export const TIER_ACCENT: Record<Tier, string> = {
  free: "#9AA0B1",
  pro: "#00E5FF",
  shop: "#B36BFF",
};

export const PRICING: Record<Exclude<Tier, "free">, { monthly: string; annual: string }> = {
  pro: { monthly: "$9.99", annual: "$79.99" },
  shop: { monthly: "$29.99", annual: "$249.99" },
};

// Max saved vehicles per tier (Free is limited to a single vehicle).
export const VEHICLE_LIMITS: Record<Tier, number> = {
  free: 1,
  pro: Number.POSITIVE_INFINITY,
  shop: Number.POSITIVE_INFINITY,
};

export const DEFAULT_ENTITLEMENT: Entitlement = {
  tier: "free",
  storedTier: "free",
  status: "none",
  trialUsed: false,
  trialDaysRemaining: 0,
  inGrace: false,
};
