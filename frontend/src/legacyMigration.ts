// One-time, versioned legacy cleanup for the Google-only authentication gate.
//
// VEYTRIC retired email/password + guest login. On the first launch of this
// corrected version we must remove any legacy identity + unattributed cached
// data left on the device so nothing leaks into the new Google-only model.
//
// Guarantees:
//  - Runs EXACTLY ONCE, guarded by a versioned flag (MIGRATION_FLAG).
//  - Does NOT run on every launch.
//  - Runs BEFORE session restoration, so it can never erase a freshly-minted
//    Google session (that is created later in the same auth bootstrap).
//  - Preserves safe device-only preferences (theme, units) and BLE/OBD config
//    that carries no legacy user identity.
//  - A legacy BYOK OpenAI key cannot be safely attributed to the new Google
//    user, so it is securely removed; the user re-enters it if wanted.
import { storage } from "@/src/utils/storage";

// The subset of the storage singleton this module touches. Injectable so the
// migration can be unit-tested with an in-memory fake.
type MigrationStorage = {
  getItem: <T>(key: string, fallback: T) => Promise<T | null>;
  setItem: (key: string, value: any) => Promise<boolean>;
  removeItem: (key: string) => Promise<boolean>;
  secureRemove: (key: string) => Promise<boolean>;
  clearNamespace: (prefix: string) => Promise<void>;
};

// Bump the suffix to force a fresh migration in a future corrected release.
export const MIGRATION_FLAG = "veytric_migration_v3_done";

// Legacy identity / token keys (email-password + guest era).
const LEGACY_TOKEN_KEY = "jarvis_token";       // shared token slot (SecureStore)
const LEGACY_GUEST_KEY = "jarvis_guest";        // guest-mode flag
const LEGACY_UID_KEY = "jarvis_current_uid";    // cached legacy user id
// Legacy BYOK + AI-engine config tied to the old identity (SecureStore + Async).
const LEGACY_BYOK_KEY = "jarvis_openai_api_key"; // SecureStore secret
const LEGACY_AI_CONFIG_KEYS = [
  "jarvis_openai_model",   // BYOK model choice (reset with the wiped key)
  "jarvis_local_ai_url",   // local engine endpoint
  "jarvis_local_ai_model", // local engine model
  "jarvis_dev_unlocked",   // developer-mode unlock (must not carry across identities)
  "jarvis_trial_reminders" // trial reminder schedule tied to the old identity
];
// NOTE: "jarvis_ai_provider_type" is intentionally PRESERVED — it is a safe
// device-only preference (which engine the user prefers), not identity data.

// Namespaces holding unattributed / user-owned cached data.
const LEGACY_NAMESPACES = [
  "veh_intel:", // predictions / trends / dashboard caches
  "veh:",        // vehicle-scoped local state
  "scan:",       // cached scan state
  "vin_decode:", // user-scoped VIN/VPIC decode cache
];

export async function hasLegacyMigrationRun(s: MigrationStorage = storage): Promise<boolean> {
  return !!(await s.getItem<boolean>(MIGRATION_FLAG, false));
}

/**
 * Perform the one-time legacy cleanup. Returns true if the cleanup actually
 * ran this call, false if it was already done previously.
 */
export async function runLegacyMigration(s: MigrationStorage = storage): Promise<boolean> {
  if (await hasLegacyMigrationRun(s)) return false;

  // 1) Legacy session tokens + guest flag + cached legacy user id.
  await s.secureRemove(LEGACY_TOKEN_KEY);
  await s.removeItem(LEGACY_GUEST_KEY);
  await s.removeItem(LEGACY_UID_KEY);

  // 2) Legacy BYOK secret + AI-engine config tied to the old identity.
  await s.secureRemove(LEGACY_BYOK_KEY);
  for (const k of LEGACY_AI_CONFIG_KEYS) {
    await s.removeItem(k);
  }

  // 3) Unattributed / user-owned cached data.
  for (const ns of LEGACY_NAMESPACES) {
    await s.clearNamespace(ns);
  }

  // 4) Mark done so this never repeats.
  await s.setItem(MIGRATION_FLAG, true);
  return true;
}
