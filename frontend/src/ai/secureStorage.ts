import { storage } from "@/src/utils/storage";

// ============================================================================
//  Secure storage for AI credentials + config.
//  - API keys live ONLY in SecureStore (Keychain / Android Keystore), never in
//    AsyncStorage, files, logs, or analytics.
//  - Non-secret config (selected provider, model names, local URL) lives in
//    AsyncStorage.
// ============================================================================

const OPENAI_KEY = "jarvis_openai_api_key"; // SecureStore
const PROVIDER_TYPE_KEY = "jarvis_ai_provider_type"; // AsyncStorage
const OPENAI_MODEL_KEY = "jarvis_openai_model"; // AsyncStorage
const LOCAL_URL_KEY = "jarvis_local_ai_url"; // AsyncStorage
const LOCAL_MODEL_KEY = "jarvis_local_ai_model"; // AsyncStorage

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";
export const DEFAULT_LOCAL_URL = "http://localhost:11434";
export const DEFAULT_LOCAL_MODEL = "llama3.1";

// Basic OpenAI key format validation (sk-... / sk-proj-...).
export function isValidOpenAIKeyFormat(key: string): boolean {
  const k = (key || "").trim();
  return /^sk-[A-Za-z0-9_-]{20,}$/.test(k);
}

// Masks a stored key for display: sk-proj-****...last4.
export function maskKey(key: string): string {
  if (!key) return "";
  const k = key.trim();
  const prefix = k.startsWith("sk-proj-") ? "sk-proj-" : k.startsWith("sk-") ? "sk-" : "";
  const last4 = k.slice(-4);
  return `${prefix}${"*".repeat(16)}${last4}`;
}

export const aiSecureStorage = {
  // ---- OpenAI key (secure) ----
  async saveOpenAIKey(key: string): Promise<boolean> {
    return storage.secureSet(OPENAI_KEY, key.trim());
  },
  async getOpenAIKey(): Promise<string> {
    return (await storage.secureGet<string>(OPENAI_KEY, "")) || "";
  },
  async removeOpenAIKey(): Promise<boolean> {
    return storage.secureRemove(OPENAI_KEY);
  },
  async hasOpenAIKey(): Promise<boolean> {
    return !!(await storage.secureGet<string>(OPENAI_KEY, ""));
  },

  // ---- Config (non-secret) ----
  async getProviderType(): Promise<string> {
    return (await storage.getItem<string>(PROVIDER_TYPE_KEY, "")) || "";
  },
  async setProviderType(type: string): Promise<boolean> {
    return storage.setItem(PROVIDER_TYPE_KEY, type);
  },
  async getOpenAIModel(): Promise<string> {
    return (await storage.getItem<string>(OPENAI_MODEL_KEY, DEFAULT_OPENAI_MODEL)) || DEFAULT_OPENAI_MODEL;
  },
  async setOpenAIModel(model: string): Promise<boolean> {
    return storage.setItem(OPENAI_MODEL_KEY, model.trim() || DEFAULT_OPENAI_MODEL);
  },
  async getLocalUrl(): Promise<string> {
    return (await storage.getItem<string>(LOCAL_URL_KEY, DEFAULT_LOCAL_URL)) || DEFAULT_LOCAL_URL;
  },
  async setLocalUrl(url: string): Promise<boolean> {
    return storage.setItem(LOCAL_URL_KEY, url.trim().replace(/\/$/, "") || DEFAULT_LOCAL_URL);
  },
  async getLocalModel(): Promise<string> {
    return (await storage.getItem<string>(LOCAL_MODEL_KEY, DEFAULT_LOCAL_MODEL)) || DEFAULT_LOCAL_MODEL;
  },
  async setLocalModel(model: string): Promise<boolean> {
    return storage.setItem(LOCAL_MODEL_KEY, model.trim() || DEFAULT_LOCAL_MODEL);
  },
};
