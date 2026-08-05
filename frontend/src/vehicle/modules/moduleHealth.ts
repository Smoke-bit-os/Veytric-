// Intelligent module health — scores each detected ECU from its DTC load and
// communication reliability, and offers an on-demand AI explanation.

import { Dtc } from "../types";
import { DetectedModule } from "../ecu/ecuService";
import { moduleKeyForDtc } from "../ecu/ecuDatabase";
import { api } from "@/src/api";

export interface ModuleHealth {
  key: string;
  name: string;
  status: DetectedModule["status"];
  commReliability: number;   // 0..100
  score: number;             // 0..100 overall
  level: "good" | "warn" | "bad";
  activeIssues: Dtc[];       // current + permanent
  historyIssues: Dtc[];      // pending
  confidence: number;        // 0..1
}

export function computeModuleHealth(modules: DetectedModule[], dtcs: Dtc[], commScore: number): ModuleHealth[] {
  return modules.map((m) => {
    const mine = dtcs.filter((d) => moduleKeyForDtc(d.code) === m.key);
    const active = mine.filter((d) => d.type === "current" || d.type === "permanent" || d.type === "manufacturer");
    const pending = mine.filter((d) => d.type === "pending");
    const commReliability = m.status === "online" ? Math.max(40, commScore) : 15;
    let score = commReliability;
    score -= active.length * 22;
    score -= pending.length * 8;
    score = Math.max(0, Math.min(100, Math.round(score)));
    const level: ModuleHealth["level"] = score >= 80 ? "good" : score >= 60 ? "warn" : "bad";
    const confidence = m.status === "online" ? (mine.length ? 0.88 : 0.8) : 0.4;
    return { key: m.key, name: m.name, status: m.status, commReliability, score, level, activeIssues: active, historyIssues: pending, confidence };
  });
}

export async function explainModule(module: ModuleHealth, vehicle: string): Promise<string> {
  const res = await api.interpretDiagnostics({
    kind: "module",
    title: module.name,
    vehicle,
    context: {
      status: module.status,
      commReliability: module.commReliability,
      score: module.score,
      activeIssues: module.activeIssues.map((d) => `${d.code} ${d.desc}`),
      historyIssues: module.historyIssues.map((d) => `${d.code} ${d.desc}`),
    },
  });
  return res?.interpretation || "";
}
