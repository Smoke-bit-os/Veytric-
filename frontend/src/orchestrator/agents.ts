// VEYTRIC — Bounded diagnostic agents (Prompt 2, Phase 2D)
// Agents request CAPABILITIES through the router; they never import providers,
// BLE, or AI directly, never see BYOK keys, and never mutate measured evidence.
// Each declares an explicit permission scope.
import {
  EvidenceRecord, EvidenceEnvelope, ProvenanceLabel, UnavailableReason, AuthorityZone,
  validateEvidence, makeUnavailable, average, minimum, maximum,
} from "@/src/evidence";
import { Capability, RouterContext } from "@/src/providers/registry";
import { CapabilityRouter } from "@/src/providers/router";
import { AIBoundary, StructuredAIResponse, validateAIResponse } from "./aiBoundary";

export interface AgentPermissions {
  name: string;
  capabilities: Capability[];   // may request
  readZones: AuthorityZone[];   // may read
  canAppend: boolean;           // may append evidence
  aiAllowed: boolean;
  researchAllowed: boolean;
  persistAllowed: boolean;
  timeoutMs: number;
  retries: number;
}

// ---- Vehicle Evidence Agent: collects vehicle evidence via the router ----
export class VehicleEvidenceAgent {
  readonly permissions: AgentPermissions = {
    name: "vehicle_evidence",
    capabilities: ["vehicle.read_dtcs", "vehicle.read_vin", "vehicle.read_voltage", "vehicle.live_pid", "vehicle.read_readiness", "vehicle.read_mode06"],
    readZones: [AuthorityZone.ZONE1_VEHICLE], canAppend: true, aiAllowed: false,
    researchAllowed: false, persistAllowed: true, timeoutMs: 8000, retries: 0,
  };
  constructor(private router: CapabilityRouter, private ctx: RouterContext) {}
  async collect(cap: Capability, userId: string, vehicleId?: string, sessionId?: string): Promise<EvidenceRecord[]> {
    if (!this.permissions.capabilities.includes(cap)) throw new Error(`${this.permissions.name} not permitted: ${cap}`);
    const res = await this.router.resolve({ capability: cap, userId, vehicleId, sessionId }, this.ctx);
    return res.records; // measured on success, else UNAVAILABLE — never fabricated
  }
}

// ---- Evidence Integrity Agent: deterministic validation (no LLM) ----
export class EvidenceIntegrityAgent {
  readonly permissions: AgentPermissions = {
    name: "evidence_integrity", capabilities: [], readZones: [AuthorityZone.ZONE1_VEHICLE, AuthorityZone.ZONE2_AUTHORITATIVE, AuthorityZone.ZONE3_RESEARCH_AI],
    canAppend: true, aiAllowed: false, researchAllowed: false, persistAllowed: false, timeoutMs: 1000, retries: 0,
  };
  review(records: EvidenceRecord[]): { clean: EvidenceRecord[]; contradictions: [string, string][]; dropped: string[] } {
    const clean: EvidenceRecord[] = []; const dropped: string[] = []; const seen = new Map<string, EvidenceRecord>();
    for (const r of records) {
      const v = validateEvidence(r);
      if (!v.ok) {
        // unsafe/malformed -> UNAVAILABLE (never a plausible default)
        clean.push(makeUnavailable({ userId: r.userId, vehicleId: r.vehicleId ?? undefined, sessionId: r.sessionId ?? undefined,
          reason: UnavailableReason.MALFORMED, decodedName: r.decodedName ?? undefined, notes: v.errors[0] }));
        dropped.push(r.evidenceId); continue;
      }
      const key = `${r.provenanceLabel}|${r.pid ?? ""}|${r.decodedName ?? ""}|${r.decodedValue ?? ""}`;
      if (seen.has(key)) continue; // dedupe mirrored evidence
      seen.set(key, r); clean.push(r);
    }
    // contradictions: same measured PID/name with differing values
    const contradictions: [string, string][] = [];
    const byName = new Map<string, EvidenceRecord>();
    for (const r of clean.filter((x) => x.provenanceLabel === ProvenanceLabel.MEASURED)) {
      const k = r.decodedName ?? r.pid ?? "";
      const prev = byName.get(k);
      if (prev && prev.decodedValue !== r.decodedValue) contradictions.push([prev.evidenceId, r.evidenceId]);
      else byName.set(k, r);
    }
    return { clean, contradictions, dropped };
  }
}

// ---- Deterministic Calculation Agent (ordinary code, not an LLM) ----
export class DeterministicCalculationAgent {
  readonly permissions: AgentPermissions = {
    name: "deterministic_calc", capabilities: ["vehicle.performance_recording"], readZones: [AuthorityZone.ZONE1_VEHICLE],
    canAppend: true, aiAllowed: false, researchAllowed: false, persistAllowed: false, timeoutMs: 1000, retries: 0,
  };
  average = average; minimum = minimum; maximum = maximum; // registered calculators only
}

// ---- Explanation & Report Agents: AI only via the boundary, cite evidence ----
export class ExplanationAgent {
  readonly permissions: AgentPermissions = {
    name: "explanation", capabilities: ["ai.interpret"], readZones: [AuthorityZone.ZONE1_VEHICLE, AuthorityZone.ZONE2_AUTHORITATIVE, AuthorityZone.ZONE3_RESEARCH_AI],
    canAppend: true, aiAllowed: true, researchAllowed: false, persistAllowed: false, timeoutMs: 20000, retries: 0,
  };
  constructor(private ai: AIBoundary) {}
  async explain(env: EvidenceEnvelope, taskId: string): Promise<{ response: StructuredAIResponse; ok: boolean; errors: string[] }> {
    const response = await this.ai.interpret(env, taskId);
    const { ok, errors } = validateAIResponse(response, env);
    return { response, ok, errors };
  }
}

// ---- Safety Review Agent: deterministic policy ----
export class SafetyReviewAgent {
  readonly permissions: AgentPermissions = {
    name: "safety_review", capabilities: [], readZones: [AuthorityZone.ZONE1_VEHICLE], canAppend: false,
    aiAllowed: false, researchAllowed: false, persistAllowed: false, timeoutMs: 500, retries: 0,
  };
  review(action: string): { allowed: boolean; requiresConfirmation: boolean; note: string } {
    if (/clear|erase/i.test(action)) return { allowed: true, requiresConfirmation: true, note: "Code clearing requires explicit user confirmation and a real connection." };
    if (/write|control|actuat|command/i.test(action)) return { allowed: false, requiresConfirmation: false, note: "Bidirectional vehicle control is not authorized in this version." };
    return { allowed: true, requiresConfirmation: false, note: "" };
  }
}

export const AGENT_REGISTRY = [
  "intake", "vehicle_evidence", "evidence_integrity", "deterministic_calc",
  "research", "explanation", "report", "safety_review",
] as const;
