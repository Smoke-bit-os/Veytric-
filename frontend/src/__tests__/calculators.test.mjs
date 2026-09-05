// VEYTRIC — Calculators + freshness tests (Prompt 1, Phase 1C).
// Runs the REAL src/evidence calculators/freshness (transpiled in-memory).
// Run: node src/__tests__/calculators.test.mjs
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
  makeMeasured, SourceType, Freshness, ProvenanceLabel, DataClass,
  computeFreshness, isPresentableAsLive, leastFresh, beginSession, isInSession,
  celsiusToFahrenheit, totalFuelTrim, average, rateOfChange, minimum, maximum,
  delta, dataQualitySummary,
} = E;

let failed = 0;
const ok = (c, m) => { if (c) console.log("✅", m); else { console.error("❌ FAIL:", m); failed++; } };

function measured(value, unit, freshness = Freshness.LIVE, ts = 1000, name = "V") {
  return makeMeasured({ userId: "u1", vehicleId: "v1", sessionId: "s1", providerId: "ble",
    sourceType: SourceType.VEHICLE_OBD, decodedName: name, decodedValue: value, decodedUnit: unit, timestamp: ts, freshness });
}

// --- unit conversion + input refs + determinism ---
{
  const c = measured(100, "°C");
  const f1 = celsiusToFahrenheit(c);
  const f2 = celsiusToFahrenheit(c);
  ok(f1.provenanceLabel === ProvenanceLabel.CALCULATED && f1.decodedValue === 212, "C->F is correct + CALCULATED");
  ok(f1.inputEvidenceIds.includes(c.evidenceId), "calculation references input evidence id");
  ok(f1.calculationId === "calc.c_to_f@1", "calculation carries versioned id");
  ok(f1.decodedValue === f2.decodedValue, "deterministic for identical input");
  ok(f1.timestamp === c.timestamp, "preserves source timestamp");
}

// --- fuel trim total ---
{
  const stft = measured(2.5, "%");
  const ltft = measured(3.75, "%");
  ok(totalFuelTrim(stft, ltft).decodedValue === 6.25, "total fuel trim = STFT + LTFT");
}

// --- incompatible units rejected -> UNAVAILABLE ---
{
  const a = measured(10, "°C");
  const b = measured(20, "psi");
  ok(average([a, b]).provenanceLabel === ProvenanceLabel.UNAVAILABLE, "incompatible units -> UNAVAILABLE");
}

// --- NaN / non-numeric input rejected ---
{
  const bad = makeMeasured({ userId: "u1", providerId: "ble", sourceType: SourceType.VEHICLE_OBD,
    decodedName: "VIN", decodedValue: "1FT...", decodedUnit: "" });
  ok(average([bad]).provenanceLabel === ProvenanceLabel.UNAVAILABLE, "non-numeric input -> UNAVAILABLE");
}

// --- division by zero (rate of change, identical timestamps) ---
{
  const a = measured(10, "km/h", Freshness.LIVE, 5000);
  const b = measured(20, "km/h", Freshness.LIVE, 5000);
  ok(rateOfChange(a, b).provenanceLabel === ProvenanceLabel.UNAVAILABLE, "division by zero -> UNAVAILABLE (no guess)");
  const c = measured(10, "km/h", Freshness.LIVE, 4000);
  const d = measured(20, "km/h", Freshness.LIVE, 5000);
  ok(rateOfChange(c, d).decodedValue === 10, "rate of change = 10 (10 units over 1s)");
}

// --- stale inputs -> result retains stale limitation ---
{
  const a = measured(10, "%", Freshness.STALE, 100);
  const b = measured(20, "%", Freshness.LIVE, 200);
  const r = average([a, b]);
  ok(r.provenanceLabel === ProvenanceLabel.CALCULATED && r.freshness === Freshness.STALE && r.limitations?.degraded === true,
     "calculation from stale input retains STALE + degraded limitation");
}

// --- min/max/delta ---
{
  ok(minimum([measured(5, "x"), measured(2, "x"), measured(9, "x")]).decodedValue === 2, "minimum");
  ok(maximum([measured(5, "x"), measured(2, "x"), measured(9, "x")]).decodedValue === 9, "maximum");
  ok(delta(measured(5, "x"), measured(8, "x")).decodedValue === 3, "delta");
}

// --- data quality summary ---
{
  const r = dataQualitySummary([measured(1, "x", Freshness.LIVE), measured(1, "x", Freshness.STALE)]);
  ok(r.decodedValue === 0.5, "data quality = fresh fraction (0.5)");
}

// --- freshness policy (per data class) ---
{
  ok(computeFreshness(1000, DataClass.LIVE_PID) === Freshness.LIVE, "1s live PID -> LIVE");
  ok(computeFreshness(4000, DataClass.LIVE_PID) === Freshness.RECENT, "4s live PID -> RECENT");
  ok(computeFreshness(4000, DataClass.VOLTAGE) === Freshness.LIVE, "4s voltage -> LIVE (class-specific threshold)");
  ok(computeFreshness(null, DataClass.LIVE_PID) === Freshness.UNKNOWN, "no age -> UNKNOWN");
  ok(computeFreshness(-5, DataClass.LIVE_PID) === Freshness.UNKNOWN, "negative age -> UNKNOWN");
  ok(!isPresentableAsLive(Freshness.UNKNOWN) && !isPresentableAsLive(Freshness.STALE), "UNKNOWN/STALE are NOT presentable as live");
  ok(isPresentableAsLive(Freshness.LIVE), "LIVE is presentable as live");
  ok(leastFresh([Freshness.LIVE, Freshness.STALE, Freshness.RECENT]) === Freshness.STALE, "leastFresh picks the least-fresh state");
}

// --- session boundaries ---
{
  const s1 = beginSession();
  const s2 = beginSession();
  ok(s1 !== s2, "each session id is unique");
  ok(isInSession("s1", "s1") && !isInSession("s1", "s2") && !isInSession(null, "s1"),
     "isInSession matches only same, non-null session");
}

if (failed === 0) console.log("\nAll calculator + freshness tests passed.");
else { console.error(`\n${failed} assertion(s) failed.`); process.exitCode = 1; }
