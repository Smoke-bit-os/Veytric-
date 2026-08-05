// Session comparison + analysis helpers (transport-agnostic).
import { api } from "@/src/api";

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
  analyze: (id: string) => api.analyzeRecording(id),
  performance: (vehicleId: string) => api.vehiclePerformance(vehicleId),
};
