// VEYTRIC — Golden decoder-fixture + redaction tests (Prompt 1, Phase 1D).
// Runs the REAL decoders (src/vehicle/obd/decoders.ts) against sanitized golden
// fixtures and asserts exact values / safe failures. Also verifies raw-capture
// redaction. Run: node src/__tests__/decoderFixtures.test.mjs
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

const D = load(path.join(FRONTEND_ROOT, "src/vehicle/obd/decoders.ts"));
const { extractBytes, MODE01, decodeDtcs, decodeVin, parseSupportedPids } = D;
const { redactRaw } = load(path.join(FRONTEND_ROOT, "src/evidence/rawCapture.ts"));
const golden = JSON.parse(fs.readFileSync(path.join(FRONTEND_ROOT, "src/vehicle/obd/__fixtures__/golden_obd.json"), "utf8"));

let failed = 0;
const ok = (c, m) => { if (c) console.log("✅", m); else { console.error("❌ FAIL:", m); failed++; } };

/** Safe Mode-01 decode: returns null if bytes are insufficient or value non-finite. */
function safeMode01(resp, pid) {
  const bytes = extractBytes(resp, "41", pid);
  if (!bytes || bytes.length === 0) return null;
  const dec = MODE01[pid];
  if (!dec) return null;
  const out = dec.decode(bytes);
  const v = out[dec.key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

for (const f of golden.fixtures) {
  const e = f.expect;
  if (e.kind === "mode01") {
    ok(safeMode01(f.response, e.pid) === e.value, `${f.id}: ${e.signalKey} == ${e.value}`);
  } else if (e.kind === "mode01_fail") {
    ok(safeMode01(f.response, e.pid) === null, `${f.id}: fails safe (null, no fabricated value)`);
  } else if (e.kind === "dtc") {
    const codes = decodeDtcs(f.response, e.codeType).map((d) => d.code);
    ok(JSON.stringify(codes) === JSON.stringify(e.codes) && codes.every((c) => decodeDtcs(f.response, e.codeType).find((d) => d.code === c).type === e.codeType),
       `${f.id}: DTCs == ${JSON.stringify(e.codes)} (${e.codeType})`);
  } else if (e.kind === "vin") {
    ok(decodeVin(f.response) === e.vin, `${f.id}: VIN == ${e.vin}`);
  } else if (e.kind === "supported_pids") {
    const sup = parseSupportedPids(f.response, e.base);
    ok(e.includes.every((p) => sup.includes(p)) && e.excludes.every((p) => !sup.includes(p)),
       `${f.id}: supported PIDs include ${e.includes} / exclude ${e.excludes}`);
  } else if (e.kind === "unsupported") {
    // OBD *Mode 06* (on-board test results) has no decoder/export in decoders.ts.
    ok(D.MODE06 === undefined && D.decodeMode06 === undefined,
       `${f.id}: no Mode 06 service decoder (routes to UNAVAILABLE)`);
  }
}

// determinism: decoding the same response twice yields identical results
ok(safeMode01("410C1AF8", "0C") === safeMode01("410C1AF8", "0C"), "decode is deterministic for identical input");

// --- redaction ---
ok(redactRaw("VIN 1HGBH41JXMN109186 stored").includes("[REDACTED_VIN]"), "redacts a 17-char VIN");
ok(!redactRaw("Authorization: Bearer abc.def.ghi123").includes("abc.def.ghi123"), "redacts a bearer token");
ok(redactRaw("key sk-ABCDEFGH12345678").includes("[REDACTED_KEY]"), "redacts an sk- key");
ok(redactRaw("card 4111111111111111 ok").includes("[REDACTED_NUM]"), "redacts a long PAN-like number");
ok(redactRaw("mail a@b.com").includes("[REDACTED_EMAIL]"), "redacts an email");
ok(redactRaw("410C1AF8") === "410C1AF8", "does not corrupt normal OBD hex frames");

if (failed === 0) console.log("\nAll decoder-fixture + redaction tests passed.");
else { console.error(`\n${failed} assertion(s) failed.`); process.exitCode = 1; }
