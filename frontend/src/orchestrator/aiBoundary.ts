// VEYTRIC — AI boundary + response validation (Prompt 2, Phase 2E)
// Screens/agents NEVER call an AI provider directly. They go through this
// versioned boundary, which receives only a redacted read-only evidence
// envelope and returns STRUCTURED output that is validated before use. No model
// routing / fallback / billing here (that is Prompt 3). Keeps Cloud/BYOK/Local.
import { EvidenceEnvelope } from "@/src/evidence";

export const AI_BOUNDARY_VERSION = 1 as const;

export interface StructuredAIResponse {
  responseId: string;
  taskId: string;
  sessionId?: string | null;
  summary: string;
  citedEvidenceIds: string[];
  observations: string[];
  interpretations: string[];
  unknowns: string[];
  contradictions: string[];
  suggestedAdditionalInfo: string[];
  safetyNotes: string[];
  confidence: "low" | "medium" | "high";
  limitations: string[];
  provenance: "AI_INTERPRETATION"; // always
}

export interface AIBoundary {
  /** Implemented by an adapter over the EXISTING approved AI abstraction. */
  interpret(env: EvidenceEnvelope, taskId: string): Promise<StructuredAIResponse>;
}

const FORBIDDEN = [
  /\b\d{2,5}\s?rpm\b/i,            // invented RPM reading
  /\bP[0-9]{4}\b/,                  // invented DTC
  /\bcode\s+cleared\b/i,           // claims a code was cleared
  /\brepair (?:was )?(?:successful|verified|completed)\b/i, // repair success
  /\bsafe to drive\b/i,            // unsupported safety-to-drive claim
];

/** Validate a model response against the envelope. Returns structured errors. */
export function validateAIResponse(resp: StructuredAIResponse, env: EvidenceEnvelope): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (resp.provenance !== "AI_INTERPRETATION") errors.push("AI output must be labeled AI_INTERPRETATION");

  const known = new Set(env.records.map((r) => r.evidenceId));
  const unavailable = new Set(
    env.records.filter((r) => r.provenanceLabel === "UNAVAILABLE").map((r) => r.decodedName || "")
  );
  for (const id of resp.citedEvidenceIds)
    if (!known.has(id)) errors.push(`cites nonexistent evidence: ${id}`);

  // AI must not fabricate readings/codes/results/specs/claims.
  const blob = [resp.summary, ...resp.observations, ...resp.interpretations].join(" \n ");
  for (const re of FORBIDDEN)
    if (re.test(blob)) errors.push(`AI text asserts a fabricated value/claim (${re})`);

  // AI must not claim an UNAVAILABLE item actually exists as a fact.
  for (const name of unavailable)
    if (name && new RegExp(`\\b${name}\\b\\s+(is|=|reads|measured)`, "i").test(blob))
      errors.push(`claims UNAVAILABLE item exists: ${name}`);

  return { ok: errors.length === 0, errors };
}

/** Test/dev boundary that returns a safe, structured response with no fabrication. */
export class NoopAIBoundary implements AIBoundary {
  async interpret(env: EvidenceEnvelope, taskId: string): Promise<StructuredAIResponse> {
    const cited = env.records.filter((r) => r.provenanceLabel !== "UNAVAILABLE").map((r) => r.evidenceId);
    return {
      responseId: `air_${Date.now().toString(36)}`,
      taskId,
      sessionId: env.owner.sessionId ?? null,
      summary: `Reviewed ${cited.length} evidence record(s).`,
      citedEvidenceIds: cited,
      observations: [],
      interpretations: [],
      unknowns: env.unavailableItems.map((u) => u.name),
      contradictions: [],
      suggestedAdditionalInfo: [],
      safetyNotes: [],
      confidence: "low",
      limitations: ["Interpretation only; not a measured vehicle reading."],
      provenance: "AI_INTERPRETATION",
    };
  }
}
