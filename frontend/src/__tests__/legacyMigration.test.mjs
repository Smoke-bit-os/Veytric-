// Node test for the one-time legacy migration (Google-only auth gate).
//
// Runs the REAL src/legacyMigration.ts logic: we transpile it in-memory with
// the TypeScript compiler and stub the only native import (the storage
// singleton), then drive it with an in-memory storage fake. No jest needed.
//
// Run: node src/__tests__/legacyMigration.test.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(__dirname, "../legacyMigration.ts");

function loadModule() {
  const source = fs.readFileSync(SRC, "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: "CommonJS", target: "ES2019" },
  }).outputText;
  const sandboxModule = { exports: {} };
  const fakeRequire = (id) => {
    if (id === "@/src/utils/storage") return { storage: {} }; // never used (injected)
    throw new Error("unexpected require: " + id);
  };
  vm.runInNewContext(js, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    require: fakeRequire,
  });
  return sandboxModule.exports;
}

function makeStorage(initial = {}) {
  const kv = { ...initial };
  return {
    getItem: async (k, f) => (k in kv ? kv[k] : f),
    setItem: async (k, v) => { kv[k] = v; return true; },
    removeItem: async (k) => { delete kv[k]; return true; },
    secureRemove: async (k) => { delete kv[k]; return true; },
    clearNamespace: async (p) => { Object.keys(kv).forEach((k) => { if (k.startsWith(p)) delete kv[k]; }); },
    _dump: () => kv,
  };
}

function assert(cond, msg) {
  if (!cond) { console.error("❌ FAIL:", msg); process.exitCode = 1; throw new Error(msg); }
  console.log("✅", msg);
}

const { runLegacyMigration, hasLegacyMigrationRun, MIGRATION_FLAG } = loadModule();

async function main() {
  // --- Test 1: removes legacy identity data, preserves safe prefs, sets flag
  const s = makeStorage({
    jarvis_token: "legacy-jwt-token",
    jarvis_guest: true,
    jarvis_current_uid: "legacy_uid_123",
    jarvis_openai_api_key: "sk-legacy",
    "veh_intel:predictions:x": { a: 1 },
    "veh:state": { b: 2 },
    "scan:cache": { c: 3 },
    "vin_decode:legacy_uid_123:VIN": { d: 4 },
    // safe device-only prefs that MUST survive
    theme: "dark",
    units: "metric",
  });
  const ran = await runLegacyMigration(s);
  assert(ran === true, "migration runs on first launch");
  const kv = s._dump();
  assert(!("jarvis_token" in kv), "legacy session token removed");
  assert(!("jarvis_guest" in kv), "guest flag removed");
  assert(!("jarvis_current_uid" in kv), "legacy cached uid removed");
  assert(!("jarvis_openai_api_key" in kv), "legacy BYOK key removed");
  assert(!("veh_intel:predictions:x" in kv), "veh_intel namespace cleared");
  assert(!("veh:state" in kv), "veh namespace cleared");
  assert(!("scan:cache" in kv), "scan namespace cleared");
  assert(!("vin_decode:legacy_uid_123:VIN" in kv), "vin_decode namespace cleared");
  assert(kv.theme === "dark", "theme preference preserved");
  assert(kv.units === "metric", "units preference preserved");
  assert(kv[MIGRATION_FLAG] === true, "migration flag set");

  // --- Test 2: does not repeat on subsequent launches
  const ran2 = await runLegacyMigration(s);
  assert(ran2 === false, "migration does NOT run a second time");
  assert((await hasLegacyMigrationRun(s)) === true, "hasLegacyMigrationRun reports done");

  // --- Test 3: does not erase a valid NEW Google session
  // (Real ordering: migration runs first, THEN a Google token is written.)
  await s.setItem("jarvis_token", "NEW-google-session-token");
  const ran3 = await runLegacyMigration(s);
  assert(ran3 === false, "already-done migration is a no-op");
  assert(s._dump().jarvis_token === "NEW-google-session-token", "new Google session token NOT erased");

  // --- Test 4: fresh install (flag already set from a prior version) stays clean
  const s2 = makeStorage({ [MIGRATION_FLAG]: true, jarvis_token: "google-tok" });
  const ran4 = await runLegacyMigration(s2);
  assert(ran4 === false, "no migration when flag already present");
  assert(s2._dump().jarvis_token === "google-tok", "existing session untouched when flag present");

  console.log("\nAll legacyMigration tests passed.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
