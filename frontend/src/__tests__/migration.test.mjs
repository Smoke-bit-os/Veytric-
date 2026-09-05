// VEYTRIC — Evidence migration tests (Prompt 1, Phase 1E).
// Runs the REAL src/evidence/migration.ts (transpiled in-memory).
// Run: node src/__tests__/migration.test.mjs
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
  migrateEvidence, migrateBatch, makeMeasured, SourceType,
  ProvenanceLabel, AuthorityZone, Freshness, Quality, RetentionClass, RedactionState,
  EVIDENCE_SCHEMA_VERSION,
} = E;

let failed = 0;
const ok = (c, m) => { if (c) console.log("✅", m); else { console.error("❌ FAIL:", m); failed++; } };

// current-schema valid MEASURED record
const current = makeMeasured({ userId: "u1", vehicleId: "v1", providerId: "ble",
  sourceType: SourceType.VEHICLE_OBD, decodedName: "RPM", decodedValue: 1726, decodedUnit: "rpm", timestamp: 111 });

// 1) current valid record migrates unchanged (idempotent)
{
  const m1 = migrateEvidence(current);
  ok(m1 && m1.evidenceId === current.evidenceId && m1.timestamp === 111, "current valid record preserved (id + timestamp)");
  const m2 = migrateEvidence(m1);
  ok(JSON.stringify(m2) === JSON.stringify(m1), "migration is idempotent for a current record");
}

// 2) legacy v0 WITH a valid explicit label is preserved (ts + owner)
{
  const legacy = {
    userId: "u9", vehicleId: "v9", timestamp: 500,
    sourceType: SourceType.VEHICLE_OBD, authorityZone: AuthorityZone.ZONE1_VEHICLE,
    provenanceLabel: ProvenanceLabel.MEASURED, providerId: "ble", decodedName: "Speed",
    decodedValue: 60, decodedUnit: "km/h", inputEvidenceIds: [],
  };
  const m = migrateEvidence(legacy);
  ok(m && m.schemaVersion === EVIDENCE_SCHEMA_VERSION && m.provenanceLabel === ProvenanceLabel.MEASURED
     && m.userId === "u9" && m.timestamp === 500, "legacy v0 with valid provenance upgraded + preserved");
}

// 3) legacy v0 WITHOUT provable provenance -> UNAVAILABLE (never MEASURED)
{
  const legacyUnknown = { userId: "u2", vehicleId: "v2", timestamp: 700, decodedName: "MysteryValue", decodedValue: 42 };
  const m = migrateEvidence(legacyUnknown);
  ok(m && m.provenanceLabel === ProvenanceLabel.UNAVAILABLE, "legacy unlabeled data NOT reclassified as MEASURED");
  ok(m && m.timestamp === 700 && m.userId === "u2", "downgraded record preserves timestamp + owner");
  ok(m && m.limitations && String(m.limitations.notes).includes("42"), "original legacy value preserved in notes");
  ok(m && m.decodedValue == null, "downgraded UNAVAILABLE carries no fabricated value");
}

// 4) unknown/future version -> fail safe (null)
{
  ok(migrateEvidence({ ...current, schemaVersion: 99 }) === null, "future schema version -> skipped (fail safe)");
}

// 5) missing owner -> dropped (no ownerless / cross-user record)
{
  const noOwner = { schemaVersion: 0, timestamp: 1, decodedValue: 5 };
  ok(migrateEvidence(noOwner) === null, "record without userId is dropped");
}

// 6) malformed inputs -> null
{
  ok(migrateEvidence(null) === null && migrateEvidence("x") === null && migrateEvidence([]) === null,
     "null / non-object / array inputs -> null");
}

// 7) rollback/disabled mode passes through only current valid records
{
  const legacy = { userId: "u1", timestamp: 1, decodedValue: 5 };
  ok(migrateEvidence(legacy, { enabled: false }) === null, "disabled mode does not upgrade legacy");
  ok(migrateEvidence(current, { enabled: false }) !== null, "disabled mode still returns a valid current record");
}

// 8) batch: mix of good/legacy/bad
{
  const res = migrateBatch([current, { userId: "u3", timestamp: 9, decodedValue: 1 }, null, { schemaVersion: 99, userId: "u4" }]);
  ok(res.migrated.length === 2 && res.skipped.length === 2, "batch migrates valid+legacy, skips null+future");
}

if (failed === 0) console.log("\nAll migration tests passed.");
else { console.error(`\n${failed} assertion(s) failed.`); process.exitCode = 1; }
