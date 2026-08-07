import {
  AIProvider,
  AIProviderType,
  AIResponse,
  AIVehicleContext,
  AIAnalyzeOptions,
  JARVIS_SYSTEM_PROMPT,
  buildContextBlock,
} from "./types";
import { aiSecureStorage } from "./secureStorage";

// ============================================================================
//  OpenAI BYOK provider — calls api.openai.com DIRECTLY from the device using
//  the user's own key. The key is read from SecureStore and never sent to our
//  servers, logs, or analytics. The user pays OpenAI directly.
// ============================================================================

const BASE = "https://api.openai.com/v1";
const TIMEOUT_MS = 30000;

async function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  const ctl = new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Request timed out")), ms));
  return Promise.race([p, ctl]);
}

class OpenAIProvider implements AIProvider {
  name = "OpenAI (Your Key)";
  type = AIProviderType.OPENAI_USER_KEY;
  private key = "";

  async connect(): Promise<boolean> {
    this.key = await aiSecureStorage.getOpenAIKey();
    return !!this.key;
  }

  async testConnection(): Promise<boolean> {
    const key = this.key || (await aiSecureStorage.getOpenAIKey());
    if (!key) return false;
    try {
      const res = await withTimeout(
        fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${key}` } }),
        15000,
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  async analyze(prompt: string, vehicleData?: AIVehicleContext, opts?: AIAnalyzeOptions): Promise<AIResponse> {
    const key = this.key || (await aiSecureStorage.getOpenAIKey());
    const model = await aiSecureStorage.getOpenAIModel();
    if (!key) return { ok: false, text: "", provider: this.name, error: "No OpenAI API key saved." };

    const messages: any[] = [{ role: "system", content: (opts?.system || JARVIS_SYSTEM_PROMPT) }];
    for (const h of opts?.history || vehicleData?.history || []) {
      messages.push({ role: h.role, content: h.content });
    }
    messages.push({ role: "user", content: prompt + buildContextBlock(vehicleData) });

    try {
      const res = await withTimeout(
        fetch(`${BASE}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
          body: JSON.stringify({ model, messages }),
        }),
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error?.message || `OpenAI error (${res.status})`;
        return { ok: false, text: "", provider: this.name, model, error: msg };
      }
      const text = data?.choices?.[0]?.message?.content ?? "";
      return { ok: true, text, provider: this.name, model };
    } catch (e: any) {
      return { ok: false, text: "", provider: this.name, model, error: e?.message || "Request failed" };
    }
  }

  async disconnect(): Promise<void> {
    this.key = "";
  }
}

export const openaiProvider = new OpenAIProvider();
