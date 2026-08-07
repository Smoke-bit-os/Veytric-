import { Entitlement } from "./licenseTypes";
import { TRIAL_REMINDER_DAYS } from "./licenseConstants";

// Offline trial / grace engine. When the device is offline we can no longer
// ask the backend, so we recompute the effective state from the cached
// timestamps. This keeps the countdown accurate and auto-downgrades to Free
// on expiry until connectivity returns and the backend re-validates.

export function reconcile(ent: Entitlement): Entitlement {
  const now = Date.now();

  if (ent.status === "trial" && ent.trialEnd) {
    const end = new Date(ent.trialEnd).getTime();
    if (end <= now) {
      return { ...ent, tier: "free", status: "expired", trialDaysRemaining: 0 };
    }
    const days = Math.max(0, Math.ceil((end - now) / 86400000));
    return { ...ent, tier: "pro", status: "trial", trialDaysRemaining: days };
  }

  if ((ent.status === "active" || ent.status === "grace") && ent.subscriptionEnd) {
    const subEnd = new Date(ent.subscriptionEnd).getTime();
    if (subEnd <= now) {
      const graceEnd = ent.gracePeriodEnd ? new Date(ent.gracePeriodEnd).getTime() : 0;
      if (graceEnd > now) {
        return { ...ent, status: "grace", inGrace: true };
      }
      return { ...ent, tier: "free", status: "expired", inGrace: false };
    }
  }

  return ent;
}

// Which reminder milestone (if any) applies for the given days remaining.
export function trialReminderStage(daysRemaining: number): number | null {
  return TRIAL_REMINDER_DAYS.includes(daysRemaining) ? daysRemaining : null;
}
