// VEYTRIC — Orchestrator core + agents + AI boundary tests (Prompt 2, 2C/2D/2E).
// Run: node src/__tests__/orchestratorCore.test.mjs
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
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: (id) => load(resolveId(id, file)), console, setTimeout, clearTimeout });
  return mod.exports;
}

const O = load(path.join(FRONTEND_ROOT, "src/orchestrator/index.ts"));
const E = load(path.join(FRONTEND_ROOT, "src/evidence/index.ts"));
const P = load(path.join(FRONTEND_ROOT, "src/providers/registry.ts"));
const R = load(path.join(FRONTEND_ROOT, "src/providers/router.ts"));
const {
  Orchestrator, TaskType, TaskState, createTask, EvidenceIntegrityAgent,
  ExplanationAgent, NoopAIBoundary, validateAIResponse, SafetyReviewAgent,
} = O;
const { makeMeasured, makeUnavailable, makeAiInterpretation, buildEvidenceEnvelope, SourceType, UnavailableReason, ProvenanceLabel, AuthorityZone } = E;
const { ProviderRegistry } = P;
const { CapabilityRouter } = R;

let failed = 0;
const ok = (c, m) => { if (c) console.log("✅", m); else { console.error("❌ FAIL:", m); failed++; } };

const CTX = { runtime: { platform: "android", isDev: false }, ownsVehicle: () => true, isAuthenticated: () => true };

function vehicleProvider(records) {
  return {
    providerId: "fake.vehicle", providerVersion: "1", providerType: "vehicle",
    authorityZone: AuthorityZone.ZONE1_VEHICLE, platforms: ["android"], capabilities: ["vehicle.live_pid"],
    canProduceMeasured: true, timeoutMs: 1000, priority: 10,
    isAvailable: () => true, health: () => "ok", execute: async () => records,
  };
}

async function main() {
  // 1) Orchestrator happy path: capability -> evidence -> envelope -> COMPLETED
  {
    const reg = new ProviderRegistry();
    const rec = makeMeasured({ userId: "u1", vehicleId: "v1", providerId: "ble", sourceType: SourceType.VEHICLE_OBD, decodedName: "RPM", decodedValue: 1726, decodedUnit: "rpm" });
    reg.register(vehicleProvider([rec]));
    const orch = new Orchestrator({ router: new CapabilityRouter(reg), ctx: CTX });
    const task = createTask({ taskType: TaskType.READ_VEHICLE_EVIDENCE, userId: "u1", vehicleId: "v1", requiredCapability: "vehicle.live_pid" });
    const res = await orch.run(task);
    ok(res.state === TaskState.COMPLETED && res.evidence.length === 1, "orchestrator COMPLETED with measured evidence");
  }

  // 2) Ownership failure -> UNAVAILABLE
  {
    const reg = new ProviderRegistry(); reg.register(vehicleProvider([]));
    const orch = new Orchestrator({ router: new CapabilityRouter(reg), ctx: { ...CTX, ownsVehicle: () => false } });
    const res = await orch.run(createTask({ taskType: TaskType.READ_VEHICLE_EVIDENCE, userId: "u1", vehicleId: "vX", requiredCapability: "vehicle.live_pid" }));
    ok(res.state === TaskState.UNAVAILABLE && res.unavailableReason.includes("ownership"), "ownership failure -> UNAVAILABLE");
  }

  // 3) Orchestrator drops cross-user evidence
  {
    const reg = new ProviderRegistry();
    const other = makeMeasured({ userId: "uX", vehicleId: "v1", providerId: "ble", sourceType: SourceType.VEHICLE_OBD, decodedName: "RPM", decodedValue: 1, decodedUnit: "rpm" });
    reg.register(vehicleProvider([other]));
    const orch = new Orchestrator({ router: new CapabilityRouter(reg), ctx: CTX });
    const res = await orch.run(createTask({ taskType: TaskType.READ_VEHICLE_EVIDENCE, userId: "u1", vehicleId: "v1", requiredCapability: "vehicle.live_pid" }));
    ok(res.evidence.length === 0 && res.warnings.some((w) => w.includes("cross-user")), "orchestrator drops cross-user evidence");
  }

  // 4) Integrity agent: dedupe + contradictions + malformed->UNAVAILABLE
  {
    const a = makeMeasured({ userId: "u1", providerId: "ble", sourceType: SourceType.VEHICLE_OBD, decodedName: "RPM", decodedValue: 1000, decodedUnit: "rpm" });
    const dup = makeMeasured({ userId: "u1", providerId: "ble", sourceType: SourceType.VEHICLE_OBD, decodedName: "RPM", decodedValue: 1000, decodedUnit: "rpm" });
    const conflict = makeMeasured({ userId: "u1", providerId: "ble", sourceType: SourceType.VEHICLE_OBD, decodedName: "RPM", decodedValue: 2000, decodedUnit: "rpm" });
    const bad = { ...a, evidenceId: "ev_bad", decodedValue: NaN };
    const { clean, contradictions } = new EvidenceIntegrityAgent().review([a, dup, conflict, bad]);
    ok(clean.some((r) => r.provenanceLabel === ProvenanceLabel.UNAVAILABLE), "integrity converts malformed -> UNAVAILABLE");
    ok(contradictions.length === 1, "integrity flags contradicting measured values");
  }

  // 5) AI boundary: output labeled AI_INTERPRETATION, cites only known evidence
  {
    const meas = makeMeasured({ userId: "u1", providerId: "ble", sourceType: SourceType.VEHICLE_OBD, decodedName: "RPM", decodedValue: 1726, decodedUnit: "rpm" });
    const env = buildEvidenceEnvelope({ owner: { userId: "u1" }, task: { requested: "explain" }, records: [meas] });
    const { response, ok: good } = await new ExplanationAgent(new NoopAIBoundary()).explain(env, "task1");
    ok(response.provenance === "AI_INTERPRETATION" && good, "AI boundary returns valid AI_INTERPRETATION");
    const bad = { ...response, citedEvidenceIds: ["ev_ghost"] };
    ok(!validateAIResponse(bad, env).ok, "AI citing nonexistent evidence is rejected");
    const fab = { ...response, summary: "Engine shows P0300 and code cleared" };
    ok(!validateAIResponse(fab, env).ok, "AI fabricating a DTC / clear-claim is rejected");
  }

  // 6) Safety agent: code clearing needs confirmation; control refused
  {
    const s = new SafetyReviewAgent();
    ok(s.review("clear codes").requiresConfirmation, "code clearing requires confirmation");
    ok(!s.review("write actuator command").allowed, "bidirectional control is refused");
  }

  if (failed === 0) console.log("\nAll orchestrator core/agent/AI-boundary tests passed.");
  else { console.error(`\n${failed} assertion(s) failed.`); process.exitCode = 1; }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
