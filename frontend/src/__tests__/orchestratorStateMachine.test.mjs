// VEYTRIC — Orchestrator state-machine + task contract tests (Prompt 2, Phase 2A).
// Runs the REAL src/orchestrator modules (transpiled in-memory).
// Run: node src/__tests__/orchestratorStateMachine.test.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, "../..");
const cache = new Map();
function resolveId(id, from) {
  let p = id.startsWith("@/") ? path.join(FRONTEND_ROOT, id.slice(2)) : path.resolve(path.dirname(from), id);
  if (fs.existsSync(p + ".ts")) return p + ".ts";
  if (fs.existsSync(path.join(p, "index.ts"))) return path.join(p, "index.ts");
  throw new Error("cannot resolve " + id);
}
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: "CommonJS", target: "ES2019" } }).outputText;
  const mod = { exports: {} }; cache.set(file, mod);
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (id) => load(resolveId(id, file)), console });
  return mod.exports;
}

const O = load(path.join(FRONTEND_ROOT, "src/orchestrator/index.ts"));
const { TaskType, TaskState, TaskMachine, createTask, canTransition, isTerminal, memoryIdempotencyStore, TASK_CONTRACT_VERSION } = O;

let failed = 0;
const ok = (c, m) => { if (c) console.log("✅", m); else { console.error("❌ FAIL:", m); failed++; } };
const throws = (fn, m) => { try { fn(); console.error("❌ FAIL (expected throw):", m); failed++; } catch { console.log("✅", m); } };

const T = TaskState;
const mk = () => createTask({ taskType: TaskType.READ_VEHICLE_EVIDENCE, userId: "u1", vehicleId: "v1" });

// 1) createTask stamps contract version + unique id
{
  const a = mk(); const b = mk();
  ok(a.contractVersion === TASK_CONTRACT_VERSION && a.taskId !== b.taskId, "createTask stamps version + unique taskId");
}

// 2) idempotency: same key => same taskId (no duplicate on restart)
{
  const store = memoryIdempotencyStore();
  const a = createTask({ taskType: TaskType.NORMALIZE_SCAN, userId: "u1", idempotencyKey: "scan-42" }, store);
  const b = createTask({ taskType: TaskType.NORMALIZE_SCAN, userId: "u1", idempotencyKey: "scan-42" }, store);
  ok(a.taskId === b.taskId, "same idempotencyKey yields the same taskId");
}

// 3) legal happy path
{
  const m = new TaskMachine(mk());
  m.transition(T.VALIDATING);
  m.transition(T.ACQUIRING_EVIDENCE);
  m.transition(T.NORMALIZING);
  m.transition(T.COMPLETED);
  ok(m.state === T.COMPLETED, "legal happy-path transitions succeed");
  ok(m.audit.length === 4 && m.audit.every(e => typeof e.at === "number"), "every transition is recorded + timestamped");
}

// 4) illegal transition rejected
{
  const m = new TaskMachine(mk());
  throws(() => m.transition(T.COMPLETED), "CREATED -> COMPLETED is illegal");
  ok(m.state === T.CREATED, "state unchanged after illegal transition");
}

// 5) terminal is immutable
{
  const m = new TaskMachine(mk());
  m.transition(T.VALIDATING); m.transition(T.UNAVAILABLE);
  ok(isTerminal(T.UNAVAILABLE), "UNAVAILABLE is terminal");
  throws(() => m.transition(T.COMPLETED), "no transition out of a terminal state");
}

// 6) cancellation from any active state; idempotent
{
  const m = new TaskMachine(mk());
  m.transition(T.VALIDATING); m.transition(T.ACQUIRING_EVIDENCE);
  m.cancel();
  ok(m.state === T.CANCELLED, "cancel from active state -> CANCELLED");
  ok(m.cancel() === T.CANCELLED, "cancel is idempotent once cancelled");
  const done = new TaskMachine(mk());
  done.transition(T.VALIDATING); done.transition(T.FAILED);
  throws(() => done.cancel(), "cannot cancel a terminal (FAILED) task");
}

// 7) canTransition helper
{
  ok(canTransition(T.CREATED, T.VALIDATING) && !canTransition(T.CREATED, T.INTERPRETING), "canTransition matches the table");
  ok(canTransition(T.ACQUIRING_EVIDENCE, T.CANCELLED) && !canTransition(T.COMPLETED, T.CANCELLED), "cancel allowed from active, not terminal");
}

if (failed === 0) console.log("\nAll orchestrator state-machine tests passed.");
else { console.error(`\n${failed} assertion(s) failed.`); process.exitCode = 1; }
