// Advanced scan workflows. Each workflow declares which diagnostic sections it
// gathers; runScan assembles the derived results and persists an AI report.

import { api } from "@/src/api";
import { DetectedModule } from "../ecu/ecuService";
import { ReadinessMonitor } from "./dtcClassifier";
import { ReliabilityReport } from "./reliability";
import { Dtc, VehicleIdentity } from "../types";

export type WorkflowKey = "full" | "quick" | "health" | "prepurchase" | "charging" | "cooling";

export interface WorkflowDef {
  key: WorkflowKey;
  name: string;
  icon: string;
  desc: string;
  sections: ("modules" | "dtcs" | "readiness" | "systems" | "reliability")[];
  systemFilter?: string[]; // limit systems for focused tests
  durationMs: number;      // simulated scan sweep for UX
}

export const WORKFLOWS: WorkflowDef[] = [
  { key: "full", name: "Full Vehicle Scan", icon: "car-connected", desc: "Every module, all DTCs, readiness & system health", sections: ["modules", "dtcs", "readiness", "systems", "reliability"], durationMs: 5000 },
  { key: "quick", name: "Quick Scan", icon: "flash", desc: "Fast DTC sweep + data quality", sections: ["dtcs", "reliability"], durationMs: 2200 },
  { key: "health", name: "Health Check", icon: "heart-pulse", desc: "System-by-system condition score", sections: ["systems", "reliability"], durationMs: 3200 },
  { key: "prepurchase", name: "Pre-Purchase Inspection", icon: "clipboard-check", desc: "Modules, DTCs, readiness & VIN verification", sections: ["modules", "dtcs", "readiness", "systems"], durationMs: 5200 },
  { key: "charging", name: "Charging System Test", icon: "car-battery", desc: "Alternator & battery evaluation", sections: ["systems", "reliability"], systemFilter: ["charging"], durationMs: 2800 },
  { key: "cooling", name: "Cooling System Evaluation", icon: "coolant-temperature", desc: "Thermal management assessment", sections: ["systems", "reliability"], systemFilter: ["cooling"], durationMs: 2800 },
];

export interface SystemResult { key: string; name: string; level: string; note: string }

export function overallScore(systems: SystemResult[], dtcs: Dtc[], rel: ReliabilityReport | null): number {
  let base = 100;
  base -= dtcs.filter((d) => d.type === "current" || d.type === "permanent").length * 12;
  base -= dtcs.filter((d) => d.type === "pending").length * 5;
  base -= systems.filter((s) => s.level === "bad").length * 10;
  base -= systems.filter((s) => s.level === "warn").length * 5;
  if (rel) base = Math.round(base * 0.8 + rel.dataQuality * 0.2);
  return Math.max(0, Math.min(100, Math.round(base)));
}

export interface RunScanArgs {
  workflow: WorkflowDef;
  vehicleId?: string;
  identity: VehicleIdentity | null;
  modules: DetectedModule[];
  dtcs: Dtc[];
  readiness: ReadinessMonitor[];
  systems: SystemResult[];
  reliability: ReliabilityReport | null;
}

export async function runScan(a: RunScanArgs) {
  const { workflow, sections } = { workflow: a.workflow, sections: a.workflow.sections };
  const score = overallScore(a.systems, a.dtcs, a.reliability);
  return api.createScan({
    vehicle_id: a.vehicleId,
    vin: a.identity?.vin || "",
    vehicle: a.identity ? `${a.identity.year} ${a.identity.make} ${a.identity.model} ${a.identity.trim || ""}`.trim() : "Vehicle",
    workflow: workflow.key,
    modules: sections.includes("modules") ? a.modules : [],
    dtcs: sections.includes("dtcs") ? a.dtcs : [],
    readiness: sections.includes("readiness") ? a.readiness : [],
    systems: sections.includes("systems") ? a.systems : [],
    metrics: sections.includes("reliability") && a.reliability ? a.reliability : {},
    overall_score: score,
  });
}

export const scanService = {
  list: (vehicleId?: string) => api.listScans(vehicleId),
  get: (id: string) => api.getScan(id),
  analyze: (id: string) => api.analyzeScan(id),
  remove: (id: string) => api.deleteScan(id),
};
