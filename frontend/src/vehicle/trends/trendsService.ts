// Trend analysis domain service. Series + heuristic findings from the backend
// (offline-first via cache). AI explanation is fetched on demand (not cached).
import { api } from "@/src/api";
import { fetchCached } from "../intelligence/cache";
import { isCloudActive, runPreparedOnActive } from "@/src/ai/diagnosticAI";

export interface TrendFinding {
  key: string;
  label: string;
  direction: "rising" | "declining" | "stable" | "recurring";
  severity: "good" | "info" | "warn" | "bad";
  slope: number;
  delta: number;
  unit: string;
  first?: number;
  last?: number;
  summary: string;
}

export interface TrendResult {
  series: { battery: number[]; coolant: number[]; health: number[]; maxSpeed: number[] };
  repeatedDtcs: { code: string; count: number }[];
  findings: TrendFinding[];
}

export const trendsService = {
  get: (id: string) => fetchCached<TrendResult>(`trends:${id}`, () => api.vehicleTrends(id)),
  // Provider-aware trend explanation. Not enough data → backend returns an
  // explanation directly (both modes). Otherwise Cloud generates server-side;
  // BYOK/Local run the prepared prompt on the user's engine (no quota).
  explain: async (id: string): Promise<{ explanation: string; provider?: string }> => {
    if (await isCloudActive()) return api.explainTrends(id);
    const prep = await api.explainTrends(id, true);
    if (!prep?.prompt) return prep; // { explanation: "Not enough data…" }
    const res = await runPreparedOnActive(prep);
    return { explanation: res.text, provider: res.provider };
  },
};
