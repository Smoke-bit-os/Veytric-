// VEYTRIC — Evidence envelope (AI + report normalization) tests (Prompt 1, Phase 1F).
// Run: node src/__tests__/envelope.test.mjs
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

const E = load(path.join(FRONTEND_ROOT, "src/evidence/index.ts"));
const {
  buildEvidenceEnvelope, toAIContext, toReportSections, attachAiInterpretation,
  makeMeasured, makeCalculated, makeRecommended, makeAiInterpretation, makeUnavailable,
  SourceType, UnavailableReason, ProvenanceLabel, Freshness,
} = E;

let failed = 0;
const ok = (c, m) => { if (c) console.log("✅", m); else { console.error("❌ FAIL:", m); failed++; } };
const throws = (fn, m) => { try { fn(); console.error("❌ FAIL (expected throw):", m); failed++; } catch { console.log("✅", m); } };

const owner = { userId: "u1", vehicleId: "v1", sessionId: "s1" };
const meas = makeMeasured({ ...owner, providerId: "ble", sourceType: SourceType.VEHICLE_OBD,
  decodedName: "RPM", decodedValue: 1726, decodedUnit: "rpm", rawResponse: "410C1AF8", freshness: Freshness.LIVE });
const calc = makeCalculated({ ...owner, calculationId: "calc.avg@1", inputEvidenceIds: [meas.evidenceId],
  decodedName: "Avg RPM", decodedValue: 1700, decodedUnit: "rpm" });
const rec = makeRecommended({ ...owner, decodedName: "Oil interval", decodedValue: 7500, decodedUnit: "mi", basis: "OEM schedule" });
const na = makeUnavailable({ ...owner, reason: UnavailableReason.UNSUPPORTED, decodedName: "Mode 06" });

// 1) build strips raw by default, keeps records read-only
{
  const env = buildEvidenceEnvelope({ owner, task: { requested: "diagnose" }, records: [meas, calc, rec, na] });
  ok(env.records.length === 4, "envelope contains all records");
  ok(env.records[0].rawResponse === null, "raw response stripped by default");
  ok(env.unavailableItems.length === 1 && env.unavailableItems[0].reason === "unsupported", "UNAVAILABLE item captured explicitly");
  throws(() => { env.records[0].decodedValue = 9999; }, "source evidence is frozen (AI/report cannot mutate)");
}

// 2) includeRaw redacts raw (does not expose sensitive content)
{
  const measVin = makeMeasured({ ...owner, providerId: "ble", sourceType: SourceType.VEHICLE_OBD,
    decodedName: "note", decodedValue: 1, rawResponse: "VIN 1HGBH41JXMN109186 token Bearer abc.def.ghi" });
  const env = buildEvidenceEnvelope({ owner, task: { requested: "x" }, records: [measVin], includeRaw: true });
  ok(env.records[0].rawResponse.includes("[REDACTED_VIN]") && !env.records[0].rawResponse.includes("abc.def.ghi"),
     "includeRaw redacts VIN + token");
}

// 3) ownership guard
{
  const other = makeMeasured({ userId: "u2", providerId: "ble", sourceType: SourceType.VEHICLE_OBD, decodedName: "x", decodedValue: 1 });
  throws(() => buildEvidenceEnvelope({ owner, task: { requested: "x" }, records: [other] }),
    "envelope rejects another user's evidence (isolation)");
}

// 4) AI context separates facts/calcs/recommendations/hypotheses + carries citation rule
{
  const env = buildEvidenceEnvelope({ owner, task: { requested: "diagnose", safetyRestrictions: ["no clearing without confirm"] }, records: [meas, calc, rec, na] });
  const ctx = toAIContext(env);
  ok(ctx.facts_measured.length === 1 && ctx.facts_calculated.length === 1 && ctx.recommendations.length === 1,
     "AI context separates measured / calculated / recommended");
  ok(ctx.unavailable.length === 1 && ctx.instructions.includes("Cite evidence IDs"), "AI context flags unavailable + requires citations");
  ok(ctx.safetyRestrictions.length === 1, "AI context carries safety restrictions");
}

// 5) AI can only APPEND an AI_INTERPRETATION that cites known evidence; cannot mutate
{
  const env = buildEvidenceEnvelope({ owner, task: { requested: "x" }, records: [meas, calc] });
  const ai = makeAiInterpretation({ ...owner, decodedName: "hyp", decodedValue: "lean B1", inputEvidenceIds: [calc.evidenceId] });
  const env2 = attachAiInterpretation(env, ai);
  ok(env2.records.length === 3 && env.records.length === 2, "attaching AI returns a NEW envelope; original unchanged");
  const measRec = makeMeasured({ ...owner, providerId: "ble", sourceType: SourceType.VEHICLE_OBD, decodedName: "x", decodedValue: 1 });
  throws(() => attachAiInterpretation(env, measRec), "cannot attach a MEASURED record as AI output");
  const aiBadCite = makeAiInterpretation({ ...owner, decodedName: "h", decodedValue: "z", inputEvidenceIds: ["ev_unknown"] });
  throws(() => attachAiInterpretation(env, aiBadCite), "AI citing an unknown evidence id is rejected");
}

// 6) report preserves provenance, marks recommendations, keeps UNAVAILABLE, live vs historical
{
  const hist = makeRecommended({ ...owner, decodedName: "Tire rotation", decodedValue: 5000, decodedUnit: "mi", basis: "schedule" });
  const env = buildEvidenceEnvelope({ owner, task: { requested: "report" }, records: [meas, rec, na, hist] });
  const sec = toReportSections(env);
  ok(sec.measured[0].provenance === "MEASURED" && sec.measured[0].presentedAs === "live", "report marks measured as live");
  ok(sec.recommendations[0].note.includes("not a measured condition"), "report marks recommendation, not measurement");
  ok(sec.unavailable.length === 1, "report keeps UNAVAILABLE items (never removed)");
}

if (failed === 0) console.log("\nAll envelope tests passed.");
else { console.error(`\n${failed} assertion(s) failed.`); process.exitCode = 1; }
