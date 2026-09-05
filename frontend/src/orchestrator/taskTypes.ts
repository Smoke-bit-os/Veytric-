// VEYTRIC — Orchestrator typed task contract (Prompt 2, Phase 2A)
// Versioned request/result types for the Core Orchestrator. Additive; consumes
// the Prompt 1 evidence contract. No provider/AI imports here (pure types).
import { AuthorityZone, EvidenceRecord } from "@/src/evidence";

export const TASK_CONTRACT_VERSION = 1 as const;

/** Initial task types (advanced hypothesis/next-best-test is NOT in Prompt 2). */
export enum TaskType {
  READ_VEHICLE_EVIDENCE = "READ_VEHICLE_EVIDENCE",
  NORMALIZE_SCAN = "NORMALIZE_SCAN",
  SUMMARIZE_SCAN = "SUMMARIZE_SCAN",
  EXPLAIN_CODE = "EXPLAIN_CODE",
  EXPLAIN_PID = "EXPLAIN_PID",
  BUILD_REPORT_EVIDENCE = "BUILD_REPORT_EVIDENCE",
  REVIEW_MAINTENANCE_EVIDENCE = "REVIEW_MAINTENANCE_EVIDENCE",
  RESEARCH_TOPIC = "RESEARCH_TOPIC",
  VALIDATE_EVIDENCE = "VALIDATE_EVIDENCE",
  COMPARE_SESSIONS = "COMPARE_SESSIONS",
}

export enum TaskState {
  CREATED = "CREATED",
  VALIDATING = "VALIDATING",
  AWAITING_CONNECTION = "AWAITING_CONNECTION",
  ACQUIRING_EVIDENCE = "ACQUIRING_EVIDENCE",
  NORMALIZING = "NORMALIZING",
  CALCULATING = "CALCULATING",
  RETRIEVING = "RETRIEVING",
  INTERPRETING = "INTERPRETING",
  VALIDATING_OUTPUT = "VALIDATING_OUTPUT",
  COMPLETED = "COMPLETED",
  PARTIAL = "PARTIAL",
  UNAVAILABLE = "UNAVAILABLE",
  CANCELLED = "CANCELLED",
  FAILED = "FAILED",
}

export type OutputFormat = "structured" | "summary" | "report";

/** Cooperative cancellation token (orchestrator-controlled). */
export interface CancellationToken {
  cancelled: boolean;
}
export function newCancellationToken(): CancellationToken {
  return { cancelled: false };
}

export interface DiagnosticTaskInput {
  taskType: TaskType;
  userId: string;                 // authenticated internal VEYTRIC user id
  vehicleId?: string | null;
  sessionId?: string | null;
  requiredCapability?: string;    // Capability from the Prompt 1 router
  inputEvidenceIds?: string[];
  userSymptoms?: string[];
  safetyContext?: string[];
  allowedZones?: AuthorityZone[]; // trust-zone restriction for this task
  maxEvidenceAgeMs?: number;      // freshness policy for this task
  timeoutMs?: number;
  outputFormat?: OutputFormat;
  /** Stable key for idempotency across app restarts (optional). */
  idempotencyKey?: string;
  auditMeta?: Record<string, string>;
}

export interface DiagnosticTask extends DiagnosticTaskInput {
  contractVersion: number;
  taskId: string;
  createdAt: number;
}

export interface TaskResult {
  taskId: string;
  state: TaskState;
  evidence: EvidenceRecord[];
  envelopeRef?: string | null;
  aiResponseRef?: string | null;
  warnings: string[];
  unavailableReason?: string | null;
  completedAt?: number;
}
