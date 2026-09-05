// VEYTRIC — Orchestrator state machine (Prompt 2, Phase 2A)
// Explicit, validated, timestamped, auditable task-state transitions. The
// ORCHESTRATOR (not any model) owns workflow state. Illegal transitions throw;
// terminal states are immutable; cancellation is allowed from any active state.
import {
  DiagnosticTask,
  DiagnosticTaskInput,
  TASK_CONTRACT_VERSION,
  TaskState,
} from "./taskTypes";

const T = TaskState;

/** Allowed forward transitions (cancellation handled separately). */
const TRANSITIONS: Record<TaskState, TaskState[]> = {
  [T.CREATED]: [T.VALIDATING],
  [T.VALIDATING]: [T.AWAITING_CONNECTION, T.ACQUIRING_EVIDENCE, T.NORMALIZING, T.RETRIEVING, T.INTERPRETING, T.UNAVAILABLE, T.FAILED],
  [T.AWAITING_CONNECTION]: [T.ACQUIRING_EVIDENCE, T.UNAVAILABLE, T.FAILED],
  [T.ACQUIRING_EVIDENCE]: [T.NORMALIZING, T.PARTIAL, T.UNAVAILABLE, T.FAILED],
  [T.NORMALIZING]: [T.CALCULATING, T.RETRIEVING, T.INTERPRETING, T.VALIDATING_OUTPUT, T.COMPLETED, T.PARTIAL, T.UNAVAILABLE, T.FAILED],
  [T.CALCULATING]: [T.RETRIEVING, T.INTERPRETING, T.VALIDATING_OUTPUT, T.COMPLETED, T.PARTIAL, T.UNAVAILABLE, T.FAILED],
  [T.RETRIEVING]: [T.INTERPRETING, T.VALIDATING_OUTPUT, T.COMPLETED, T.PARTIAL, T.UNAVAILABLE, T.FAILED],
  [T.INTERPRETING]: [T.VALIDATING_OUTPUT, T.COMPLETED, T.PARTIAL, T.UNAVAILABLE, T.FAILED],
  [T.VALIDATING_OUTPUT]: [T.COMPLETED, T.PARTIAL, T.UNAVAILABLE, T.FAILED],
  // terminal states — no outgoing transitions
  [T.COMPLETED]: [],
  [T.PARTIAL]: [],
  [T.UNAVAILABLE]: [],
  [T.CANCELLED]: [],
  [T.FAILED]: [],
};

const TERMINAL = new Set<TaskState>([T.COMPLETED, T.PARTIAL, T.UNAVAILABLE, T.CANCELLED, T.FAILED]);

export function isTerminal(s: TaskState): boolean {
  return TERMINAL.has(s);
}

export function canTransition(from: TaskState, to: TaskState): boolean {
  if (to === T.CANCELLED) return !isTerminal(from); // cancel from any active state
  return (TRANSITIONS[from] || []).includes(to);
}

export interface AuditEvent {
  from: TaskState;
  to: TaskState;
  at: number;
  note?: string;
}

/** In-memory idempotency store; a backing store (Mongo/AsyncStorage) is injected
 *  in later phases. Same idempotencyKey => same taskId (no duplicate tasks on
 *  restart, no duplicated saved evidence / reports / future billable actions). */
export interface IdempotencyStore {
  get(key: string): string | undefined;
  set(key: string, taskId: string): void;
}
export function memoryIdempotencyStore(): IdempotencyStore {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k), set: (k, v) => void m.set(k, v) };
}

let _seq = 0;
function genTaskId(): string {
  _seq = (_seq + 1) % 1_000_000;
  return `task_${Date.now().toString(36)}_${_seq.toString(36)}`;
}

export function createTask(input: DiagnosticTaskInput, store?: IdempotencyStore): DiagnosticTask {
  let taskId: string;
  if (input.idempotencyKey && store) {
    const existing = store.get(input.idempotencyKey);
    taskId = existing ?? genTaskId();
    if (!existing) store.set(input.idempotencyKey, taskId);
  } else {
    taskId = genTaskId();
  }
  return { ...input, contractVersion: TASK_CONTRACT_VERSION, taskId, createdAt: Date.now() };
}

/** Drives one task's lifecycle with a validated, auditable transition log. */
export class TaskMachine {
  private _state: TaskState = T.CREATED;
  private _audit: AuditEvent[] = [];

  constructor(public readonly task: DiagnosticTask) {}

  get state(): TaskState {
    return this._state;
  }
  get audit(): readonly AuditEvent[] {
    return this._audit;
  }
  isTerminal(): boolean {
    return isTerminal(this._state);
  }

  /** Apply a transition. Throws on an illegal or post-terminal transition. */
  transition(to: TaskState, note?: string): TaskState {
    if (isTerminal(this._state))
      throw new Error(`Task ${this.task.taskId} is terminal (${this._state}); cannot -> ${to}`);
    if (!canTransition(this._state, to))
      throw new Error(`Illegal transition ${this._state} -> ${to}`);
    this._audit.push({ from: this._state, to, at: Date.now(), note });
    this._state = to;
    return this._state;
  }

  /** Cancel from any active state (idempotent once cancelled). */
  cancel(note = "cancelled"): TaskState {
    if (this._state === T.CANCELLED) return this._state;
    return this.transition(T.CANCELLED, note);
  }
}
