// VEYTRIC — Orchestrator core (Prompt 2, Phase 2C)
// Coordinates a typed task: auth/ownership -> capability -> evidence -> validate
// -> (calculate) -> immutable envelope. The orchestrator (not any model) owns
// workflow, validation, freshness, timeouts and UNAVAILABLE behavior.
import {
  buildEvidenceEnvelope, validateEvidence, EvidenceEnvelope, EvidenceRecord,
} from "@/src/evidence";
import { Capability, RouterContext } from "@/src/providers/registry";
import { CapabilityRouter as Router } from "@/src/providers/router";
import { DiagnosticTask, TaskResult, TaskState, TaskType } from "./taskTypes";
import { TaskMachine } from "./stateMachine";

export interface OrchestratorDeps {
  router: Router;
  ctx: RouterContext;
  /** Evidence a task already has (for VALIDATE/NORMALIZE/REPORT tasks). */
  evidenceStore?: (task: DiagnosticTask) => EvidenceRecord[];
}

const CAP_FOR_TASK: Partial<Record<TaskType, Capability>> = {
  [TaskType.READ_VEHICLE_EVIDENCE]: "vehicle.live_pid",
};

export class Orchestrator {
  constructor(private deps: OrchestratorDeps) {}

  async run(task: DiagnosticTask): Promise<TaskResult> {
    const m = new TaskMachine(task);
    const warn: string[] = [];
    const done = (state: TaskState, evidence: EvidenceRecord[], reason?: string, envRef?: string): TaskResult => ({
      taskId: task.taskId, state, evidence, warnings: warn,
      unavailableReason: reason ?? null, envelopeRef: envRef ?? null, completedAt: Date.now(),
    });

    try {
      m.transition(TaskState.VALIDATING);
      // Ownership is derived from the authenticated router context, never the client.
      if (task.vehicleId && this.deps.ctx.ownsVehicle && !(await this.deps.ctx.ownsVehicle(task.userId, task.vehicleId))) {
        m.transition(TaskState.UNAVAILABLE);
        return done(TaskState.UNAVAILABLE, [], "ownership check failed");
      }

      let records: EvidenceRecord[] = [];
      const cap = task.requiredCapability as Capability | undefined ?? CAP_FOR_TASK[task.taskType];

      if (cap) {
        m.transition(TaskState.ACQUIRING_EVIDENCE);
        const res = await this.deps.router.resolve(
          { capability: cap, userId: task.userId, vehicleId: task.vehicleId, sessionId: task.sessionId },
          this.deps.ctx,
        );
        records = res.records; // always has records (measured or UNAVAILABLE)
        if (!res.ok) {
          m.transition(TaskState.UNAVAILABLE);
          return done(TaskState.UNAVAILABLE, records, res.attempts.at(-1)?.message ?? "no provider succeeded");
        }
      } else {
        // Tasks that operate on already-collected evidence.
        records = this.deps.evidenceStore?.(task) ?? [];
      }

      m.transition(TaskState.NORMALIZING);
      // Only this user's, validated records survive; the rest are dropped with a warning.
      const clean = records.filter((r) => {
        if (r.userId !== task.userId) { warn.push(`dropped cross-user evidence ${r.evidenceId}`); return false; }
        const v = validateEvidence(r);
        if (!v.ok) { warn.push(`invalid evidence ${r.evidenceId}: ${v.errors[0]}`); return false; }
        return true;
      });

      const env: EvidenceEnvelope = buildEvidenceEnvelope({
        owner: { userId: task.userId, vehicleId: task.vehicleId, sessionId: task.sessionId },
        task: { requested: task.taskType, safetyRestrictions: task.safetyContext },
        records: clean,
      });

      m.transition(env.records.length > 0 ? TaskState.COMPLETED : TaskState.PARTIAL);
      return done(m.state, [...env.records], undefined, `env_${task.taskId}`);
    } catch (e) {
      if (!m.isTerminal()) m.transition(TaskState.FAILED, (e as Error).message);
      return done(TaskState.FAILED, [], (e as Error).message);
    }
  }
}
