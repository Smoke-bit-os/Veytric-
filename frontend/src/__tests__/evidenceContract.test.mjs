// VEYTRIC — Evidence contract tests, TS side (Prompt 1, Phase 1A).
//
// Runs the REAL src/evidence contract (transpiled in-memory with the TypeScript
// compiler; the contract has no native imports) against the SAME canonical
// sample the backend validates (docs/evidence_sample.json), and asserts the
// provenance/authority invariants. No jest needed.
//
// Run: node src/__tests__/evidenceContract.test.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EV_DIR = path.resolve(__dirname, "../evidence");
const SAMPLE = path.resolve(__dirname, "../../../docs/evidence_sample.json");

// Minimal CommonJS module loader for the evidence/* files (they only import
// each other via relative paths).
const cache = new Map();
function loadTs(absNoExt) {
  if (cache.has(absNoExt)) return cache.get(absNoExt).exports;
  const file = absNoExt.endsWith(".ts") ? absNoExt : absNoExt + ".ts";
  const src = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(src, {
    compilerOptions: { module: "CommonJS", target: "ES2019" },
  }).outputText;
  const mod = { exports: {} };
  cache.set(absNoExt, mod);
  const req = (id) => {
    if (id.startsWith(".")) return loadTs(path.resolve(path.dirname(file), id));
    throw new Error("unexpected import: " + id);
  };
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: req, console });
  return mod.exports;
}

const {
  validateEvidence, validateReferenceGraph, assertEvidence,
  makeMeasured, makeCalculated, makeUnavailable, makeAiInterpretation,
  makeRecommended, ProvenanceLabel, SourceType, AuthorityZone, UnavailableReason,
  Freshness,
} = loadTs(path.join(EV_DIR, "index"));

let failed = 0;
function ok(cond, msg) {
  if (cond) console.log("✅", msg);
  else { console.error("❌ FAIL:", msg); failed++; }
}
function throws(fn, msg) {
  try { fn(); console.error("❌ FAIL (expected throw):", msg); failed++; }
  catch { console.log("✅", msg); }
}

// --- shared canonical sample validates on the TS side ---
const sample = JSON.parse(fs.readFileSync(SAMPLE, "utf8"));
let allValid = true;
const labels = new Set();
for (const r of sample.records) {
  const res = validateEvidence(r);
  if (!res.ok) { allValid = false; console.error("  sample invalid:", r.evidenceId, res.errors); }
  labels.add(r.provenanceLabel);
}
ok(allValid, "shared canonical sample validates on TS contract");
ok(labels.size === Object.keys(ProvenanceLabel).length, "sample exercises every provenance class");
ok(validateReferenceGraph(sample.records).ok, "sample reference graph is legal (no Zone-1 depends on Zone-3)");

// --- factory enforcement ---
const meas = makeMeasured({
  userId: "u1", vehicleId: "v1", sessionId: "s1", providerId: "ble.elm327",
  decodedName: "RPM", decodedValue: 1200, decodedUnit: "rpm",
  requestMode: "01", pid: "0C", rawResponse: "41 0C 12 C0",
});
ok(meas.provenanceLabel === ProvenanceLabel.MEASURED && meas.authorityZone === AuthorityZone.ZONE1_VEHICLE,
   "makeMeasured -> ZONE1 MEASURED");

const calc = makeCalculated({
  userId: "u1", calculationId: "calc.avg@1", inputEvidenceIds: [meas.evidenceId],
  decodedName: "Avg RPM", decodedValue: 1200, decodedUnit: "rpm",
});
ok(calc.inputEvidenceIds.includes(meas.evidenceId), "makeCalculated retains input evidence references");

const na = makeUnavailable({ userId: "u1", reason: UnavailableReason.UNSUPPORTED, decodedName: "Mode 06" });
ok(na.provenanceLabel === ProvenanceLabel.UNAVAILABLE && na.decodedValue == null,
   "makeUnavailable carries a reason and no value");

const ai = makeAiInterpretation({
  userId: "u1", decodedName: "hyp", decodedValue: "possible intake leak",
  inputEvidenceIds: [calc.evidenceId], confidence: 0.5,
});
ok(ai.authorityZone === AuthorityZone.ZONE3_RESEARCH_AI, "makeAiInterpretation -> ZONE3");

// AI record cannot be forged into MEASURED
throws(() => assertEvidence({ ...ai, provenanceLabel: ProvenanceLabel.MEASURED }),
       "forging AI record into MEASURED is rejected");

// MEASURED cannot depend on other evidence
throws(() => assertEvidence({ ...meas, inputEvidenceIds: ["ev_ai"] }),
       "MEASURED with inputEvidenceIds is rejected");

// CALCULATED without inputs rejected
throws(() => makeCalculated({ userId: "u1", calculationId: "c", inputEvidenceIds: [], decodedName: "x", decodedValue: 1 }),
       "CALCULATED without inputs is rejected");

// UNAVAILABLE with a value rejected
throws(() => assertEvidence({ ...na, decodedValue: 1234 }),
       "UNAVAILABLE with a value is rejected");

// Recommended cannot claim vehicle authority
throws(() => assertEvidence({ ...makeRecommended({ userId: "u1", decodedName: "Oil", decodedValue: 7500, basis: "OEM schedule" }), authorityZone: AuthorityZone.ZONE1_VEHICLE }),
       "RECOMMENDED cannot claim ZONE1 authority");

// One-way reference graph blocks a MEASURED depending on Zone-3
const badGraph = validateReferenceGraph([ai, { ...meas, inputEvidenceIds: [ai.evidenceId] }]);
ok(!badGraph.ok, "reference graph blocks MEASURED depending on Zone-3 AI");

if (failed === 0) console.log("\nAll evidence contract tests passed.");
else { console.error(`\n${failed} assertion(s) failed.`); process.exitCode = 1; }
