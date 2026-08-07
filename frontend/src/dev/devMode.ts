import { storage } from "@/src/utils/storage";
import { licenseCache } from "@/src/licensing/licenseCache";

// Developer Mode gate. Available only in development/debug builds by default.
// In production a hidden flag would be required (and biometric confirmation).
// Unlock is via a 7-tap on the app version in About; the unlocked state is
// remembered until logout / reinstall (cleared alongside the session).

const DEV_UNLOCK_KEY = "jarvis_dev_unlocked";

export const devMode = {
  // True only in dev/preview builds. Production release builds hide dev tools.
  isAvailable(): boolean {
    return !!__DEV__;
  },

  async isUnlocked(): Promise<boolean> {
    if (!devMode.isAvailable()) return false;
    return !!(await storage.getItem<boolean>(DEV_UNLOCK_KEY, false));
  },

  async unlock(): Promise<void> {
    await storage.setItem(DEV_UNLOCK_KEY, true);
  },

  async relock(): Promise<void> {
    await storage.removeItem(DEV_UNLOCK_KEY);
  },

  // Clear only the encrypted license cache.
  async clearLicenseCache(): Promise<void> {
    await licenseCache.clear();
  },
};

export const DEV_LICENSE_ACTIONS = [
  { action: "free", label: "Simulate Free" },
  { action: "trial", label: "Simulate Trial" },
  { action: "pro", label: "Simulate Pro" },
  { action: "shop", label: "Simulate Shop" },
  { action: "expired", label: "Simulate Expired" },
  { action: "grace", label: "Simulate Grace Period" },
  { action: "reset_trial", label: "Reset Trial" },
  { action: "clear", label: "Clear Subscription" },
] as const;
