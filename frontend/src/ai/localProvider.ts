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
//  Local AI provider — talks to an Ollama server (or compatible) at a
//  user-configured URL. Fully offline / private. NOTE: this cannot run inside
//  Expo Go / web preview and needs an Ollama server reachable from the device
//  (e.g. a LAN IP). Test on a real device against a running Ollama instance.
// ============================================================================

const TIMEOUT_MS = 45000;

async function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  const ctl = new Promise<T>((_, reject) => setTimeout(() => reject(new Error("Request timed out")), ms));
  return Promise.race([p, ctl]);
}

class LocalProvider implements AIProvider {
  name = "Local AI";
  type = AIProviderType.LOCAL_AI;

  async connect(): Promise<boolean> {
    return this.testConnection();
  }

  async testConnection(): Promise<boolean> {
    const url = await aiSecureStorage.getLocalUrl();
    try {
      const res = await withTimeout(fetch(`${url}/api/tags`), 8000);
      return res.ok;
    } catch {
      return false;
    }
  }

  async analyze(prompt: string, vehicleData?: AIVehicleContext, opts?: AIAnalyzeOptions): Promise<AIResponse> {
    const url = await aiSecureStorage.getLocalUrl();
    const model = await aiSecureStorage.getLocalModel();
    const system = opts?.system || JARVIS_SYSTEM_PROMPT;
    const full = `${system}\n\n${prompt}${buildContextBlock(vehicleData)}`;
    try {
      const res = await withTimeout(
        fetch(`${url}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model, prompt: full, stream: false }),
        }),
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, text: "", provider: this.name, model, error: data?.error || `Local AI error (${res.status})` };
      }
      return { ok: true, text: data?.response ?? "", provider: this.name, model };
    } catch (e: any) {
      return {
        ok: false,
        text: "",
        provider: this.name,
        model,
        error: e?.message === "Request timed out" ? "Local AI timed out" : "Could not reach the local AI server",
      };
    }
  }

  async disconnect(): Promise<void> {}
}

export const localProvider = new LocalProvider();
