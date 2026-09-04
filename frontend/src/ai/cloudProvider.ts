import {
  AIProvider,
  AIProviderType,
  AIResponse,
  AIVehicleContext,
  AIAnalyzeOptions,
} from "./types";
import { api } from "@/src/api";
import { storage } from "@/src/utils/storage";
import { TOKEN_KEY } from "@/src/api";

// ============================================================================
//  JARVIS Cloud provider — powered by the JARVIS backend (GPT via the managed
//  key). This is the default, zero-setup option. Uses the additive
//  POST /api/ai/analyze endpoint so all providers share one analyze() surface.
// ============================================================================

class CloudProvider implements AIProvider {
  name = "VEYTRIC Cloud AI";
  type = AIProviderType.JARVIS_CLOUD;

  async connect(): Promise<boolean> {
    return !!(await storage.secureGet<string>(TOKEN_KEY, ""));
  }

  async testConnection(): Promise<boolean> {
    try {
      // Lightweight authenticated ping.
      await api.me();
      return true;
    } catch {
      return false;
    }
  }

  async analyze(prompt: string, vehicleData?: AIVehicleContext, opts?: AIAnalyzeOptions): Promise<AIResponse> {
    try {
      const res = await api.aiAnalyze({
        prompt,
        system: opts?.system,
        vehicle: vehicleData?.profile,
        telemetry: vehicleData?.live,
        diagnostics: vehicleData?.diagnostics,
        history: (opts?.history || vehicleData?.history || []).slice(-8),
      });
      return { ok: true, text: res.text || "", provider: this.name, model: res.model };
    } catch (e: any) {
      return { ok: false, text: "", provider: this.name, error: e?.message || "Cloud AI unavailable" };
    }
  }

  async disconnect(): Promise<void> {}
}

export const cloudProvider = new CloudProvider();
