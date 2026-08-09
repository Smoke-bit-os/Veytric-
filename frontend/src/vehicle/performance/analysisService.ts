// Session comparison + analysis helpers (transport-agnostic).
import { api } from "@/src/api";
import { isCloudActive, runPreparedOnActive } from "@/src/ai/diagnosticAI";

export interface CompareRow {
  metric: string;
  a: number;
  b: number;
  delta: number;
  unit: string;
  significant: boolean;
}

const defs: { key: string; metric: string; unit: string; threshPct: number }[] = [
  { key: "peakRpm", metric: "Peak RPM", unit: "", threshPct: 8 },
  { key: "maxSpeed", metric: "Max Speed", unit: "km/h", threshPct: 8 },
  { key: "avgSpeed", metric: "Avg Speed", unit: "km/h", threshPct: 10 },
  { key: "lowestVoltage", metric: "Lowest Voltage", unit: "V", threshPct: 3 },
  { key: "highestCoolant", metric: "Peak Coolant", unit: "°C", threshPct: 5 },
];

export function compareSessions(a: any, b: any): CompareRow[] {
  const sa = a.summary || {};
  const sb = b.summary || {};
  const rows = defs.map((d) => {
    const va = sa[d.key] ?? 0;
    const vb = sb[d.key] ?? 0;
    const base = Math.max(1, Math.abs(va));
    const delta = Math.round((vb - va) * 100) / 100;
    return { metric: d.metric, a: va, b: vb, delta, unit: d.unit, significant: Math.abs(delta) / base * 100 >= d.threshPct };
  });
  rows.push({
    metric: "Health Score", a: a.health_score ?? 0, b: b.health_score ?? 0,
    delta: (b.health_score ?? 0) - (a.health_score ?? 0), unit: "", significant: Math.abs((b.health_score ?? 0) - (a.health_score ?? 0)) >= 5,
  });
  return rows;
}

export const analysisService = {
  list: (vehicleId?: string) => api.listRecordings(vehicleId),
  get: (id: string) => api.getRecording(id),
  remove: (id: string) => api.deleteRecording(id),
  // Provider-aware recording analysis. BYOK/Local run on the user's engine and
  // persist without touching the JARVIS Cloud quota; no silent cloud fallback.
  analyze: async (id: string): Promise<{ analysis: string; provider: string }> => {
    if (await isCloudActive()) {
      const r = await api.analyzeRecording(id);
      return { analysis: r.analysis, provider: "cloud" };
    }
    const prep = await api.analyzeRecording(id, true);
    const res = await runPreparedOnActive(prep);
    await api.saveRecordingAnalysis(id, { analysis: res.text, provider: res.provider, model: res.model }).catch(() => {});
    return { analysis: res.text, provider: res.provider };
  },
  performance: (vehicleId: string) => api.vehiclePerformance(vehicleId),
};
