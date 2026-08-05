// Trend analysis domain service. Series + heuristic findings from the backend
// (offline-first via cache). AI explanation is fetched on demand (not cached).
import { api } from "@/src/api";
import { fetchCached } from "../intelligence/cache";

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
  explain: (id: string) => api.explainTrends(id),
};
