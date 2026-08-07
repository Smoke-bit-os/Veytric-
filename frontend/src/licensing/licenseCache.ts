import { storage } from "@/src/utils/storage";
import { LICENSE_CACHE_KEY } from "./licenseConstants";
import { Entitlement } from "./licenseTypes";

// Offline-first encrypted cache. SecureStore (Keychain / EncryptedSharedPrefs)
// encrypts values at rest. We serialize the entitlement to a JSON string
// (SecureStore only stores strings) and never cache secrets or receipts.

export const licenseCache = {
  async load(): Promise<Entitlement | null> {
    const raw = await storage.secureGet<string>(LICENSE_CACHE_KEY, "");
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Entitlement;
    } catch {
      return null;
    }
  },

  async save(ent: Entitlement): Promise<void> {
    const payload: Entitlement = { ...ent, _cachedAt: new Date().toISOString() };
    await storage.secureSet(LICENSE_CACHE_KEY, JSON.stringify(payload));
  },

  async clear(): Promise<void> {
    await storage.secureRemove(LICENSE_CACHE_KEY);
  },
};
