// VEYTRIC — Capability Router + Provider Registry tests (Prompt 1, Phase 1B).
// Runs the REAL src/providers + src/evidence TS (transpiled in-memory; no native
// imports). Proves ordered routing, timeout -> structured error -> UNAVAILABLE,
// ownership/auth gates, unsupported -> UNAVAILABLE, and — critically — that a
// native production runtime NEVER falls back to a simulation provider.
//
// Run: node src/__tests__/providerRouter.test.mjs
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, "../.."); // /app/frontend

const cache = new Map();
function resolveId(id, fromFile) {
  let p;
  if (id.startsWith("@/")) p = path.join(FRONTEND_ROOT, id.slice(2));
  else if (id.startsWith(".")) p = path.resolve(path.dirname(fromFile), id);
  else throw new Error("unexpected import: " + id);
  if (fs.existsSync(p + ".ts")) return p + ".ts";
  if (fs.existsSync(path.join(p, "index.ts"))) return path.join(p, "index.ts");
  throw new Error("cannot resolve: " + id + " from " + fromFile);
}
function loadTs(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const src = fs.readFileSync(file, "utf8");
  const js = ts.transpileModule(src, { compilerOptions: { module: "CommonJS", target: "ES2019" } }).outputText;
  const mod = { exports: {} };
  cache.set(file, mod);
  const req = (id) => loadTs(resolveId(id, file));
  vm.runInNewContext(js, { module: mod, exports: mod.exports, require: req, console, setTimeout, clearTimeout });
  return mod.exports;
}

const P = path.join(FRONTEND_ROOT, "src/providers");
const { ProviderRegistry, ProviderError, ProviderErrorCode } = loadTs(path.join(P, "registry.ts"));
const { CapabilityRouter } = loadTs(path.join(P, "router.ts"));
const { BleVehicleAdapter } = loadTs(path.join(P, "adapters/bleVehicleAdapter.ts"));
const { ProvenanceLabel, AuthorityZone } = loadTs(path.join(FRONTEND_ROOT, "src/evidence/index.ts"));

let failed = 0;
const ok = (c, m) => { if (c) console.log("✅", m); else { console.error("❌ FAIL:", m); failed++; } };

const NATIVE_PROD = { platform: "android", isDev: false };
const NATIVE_DEV = { platform: "android", isDev: true };

// --- fake providers ---------------------------------------------------------
function fakeProvider(over = {}) {
  return {
    providerId: over.providerId || "fake.vehicle",
    providerVersion: "1.0.0",
    providerType: over.providerType || "vehicle",
    authorityZone: AuthorityZone.ZONE1_VEHICLE,
    platforms: over.platforms || ["ios", "android"],
    capabilities: over.capabilities || ["vehicle.read_voltage"],
    canProduceMeasured: over.canProduceMeasured ?? true,
    nonProduction: over.nonProduction ?? false,
    timeoutMs: over.timeoutMs ?? 1000,
    priority: over.priority ?? 10,
    isAvailable: over.isAvailable || (() => true),
    health: over.health || (() => "ok"),
    execute: over.execute,
  };
}

async function main() {
  // 1) Ordered success: two providers, lower priority wins.
  {
    const reg = new ProviderRegistry();
    let ranSecond = false;
    reg.register(fakeProvider({ providerId: "p.high", priority: 50, execute: async () => { ranSecond = true; return [{ x: 1 }]; } }));
    reg.register(fakeProvider({ providerId: "p.low", priority: 5, execute: async (req) => [makeVoltage(req)] }));
    const res = await new CapabilityRouter(reg).resolve(
      { capability: "vehicle.read_voltage", userId: "u1", vehicleId: "v1" },
      { runtime: NATIVE_PROD, ownsVehicle: () => true, isAuthenticated: () => true });
    ok(res.ok && res.providerId === "p.low" && !ranSecond, "router runs providers in priority order; stops on first success");
  }

  // 2) Timeout -> UNAVAILABLE(timeout)
  {
    const reg = new ProviderRegistry();
    reg.register(fakeProvider({ timeoutMs: 30, execute: () => new Promise(() => {}) }));
    const res = await new CapabilityRouter(reg).resolve(
      { capability: "vehicle.read_voltage", userId: "u1" }, { runtime: NATIVE_PROD });
    ok(!res.ok && res.records[0].provenanceLabel === ProvenanceLabel.UNAVAILABLE, "timeout ends in UNAVAILABLE");
    ok(res.attempts.some(a => a.code === ProviderErrorCode.Timeout), "timeout recorded as structured Timeout error");
  }

  // 3) Fail-closed: native production never runs a simulation provider.
  {
    const reg = new ProviderRegistry();
    let simRan = false;
    reg.register(fakeProvider({ providerId: "sim", providerType: "simulation", nonProduction: true,
      canProduceMeasured: false, execute: async () => { simRan = true; return [{ x: 1 }]; } }));
    const router = new CapabilityRouter(reg);
    const prod = await router.resolve({ capability: "vehicle.read_voltage", userId: "u1" }, { runtime: NATIVE_PROD });
    ok(!prod.ok && !simRan, "native PRODUCTION excludes simulation provider (no fallback to sim)");
    const dev = await router.resolve({ capability: "vehicle.read_voltage", userId: "u1" }, { runtime: NATIVE_DEV });
    ok(dev.ok && simRan, "native DEV build MAY use simulation provider");
  }

  // 4) Ownership gate blocks execution before the provider runs.
  {
    const reg = new ProviderRegistry();
    let ran = false;
    reg.register(fakeProvider({ execute: async () => { ran = true; return [{ x: 1 }]; } }));
    const res = await new CapabilityRouter(reg).resolve(
      { capability: "vehicle.read_voltage", userId: "u1", vehicleId: "v_other" },
      { runtime: NATIVE_PROD, ownsVehicle: () => false });
    ok(!res.ok && !ran, "ownership failure fails BEFORE provider execution");
  }

  // 5) Unsupported capability -> UNAVAILABLE(unsupported)
  {
    const reg = new ProviderRegistry();
    reg.register(fakeProvider({ capabilities: ["vehicle.read_voltage"] }));
    const res = await new CapabilityRouter(reg).resolve(
      { capability: "vehicle.read_mode06", userId: "u1" }, { runtime: NATIVE_PROD });
    ok(!res.ok && res.records[0].limitations.reason === "unsupported", "no-provider capability -> UNAVAILABLE(unsupported)");
  }

  // 6) BLE adapter: MEASURED only with a real ECU response; else UNAVAILABLE.
  {
    const ecuOn = {
      mode: "ble",
      readDtcs: async () => [{ code: "P0171", desc: "System Lean", type: "current" }],
      getStatusReport: () => ({ ecuCommunication: true, protocol: "CAN", vinReceived: true }),
    };
    const reg = new ProviderRegistry();
    reg.register(new BleVehicleAdapter(ecuOn));
    const res = await new CapabilityRouter(reg).resolve(
      { capability: "vehicle.read_dtcs", userId: "u1", vehicleId: "v1" },
      { runtime: NATIVE_PROD, ownsVehicle: () => true });
    ok(res.ok && res.records[0].provenanceLabel === ProvenanceLabel.MEASURED && res.records[0].decodedValue === "P0171",
       "BLE adapter emits MEASURED DTC from a real ECU response");

    const ecuOff = { ...ecuOn, getStatusReport: () => ({ ecuCommunication: false, protocol: "Unknown", vinReceived: false }) };
    const reg2 = new ProviderRegistry();
    reg2.register(new BleVehicleAdapter(ecuOff));
    const res2 = await new CapabilityRouter(reg2).resolve(
      { capability: "vehicle.read_dtcs", userId: "u1", vehicleId: "v1" },
      { runtime: NATIVE_PROD, ownsVehicle: () => true });
    ok(!res2.ok && res2.records[0].provenanceLabel === ProvenanceLabel.UNAVAILABLE,
       "BLE adapter with NO real ECU response -> UNAVAILABLE (never fabricates)");
  }

  // helper to build a valid MEASURED voltage record via the real factory
  function makeVoltage(req) {
    const { makeMeasured, SourceType } = loadTs(path.join(FRONTEND_ROOT, "src/evidence/index.ts"));
    return makeMeasured({ userId: req.userId, vehicleId: req.vehicleId, providerId: "p.low",
      sourceType: SourceType.MEASUREMENT_DEVICE, decodedName: "Adapter voltage", decodedValue: 13.9, decodedUnit: "V" });
  }

  if (failed === 0) console.log("\nAll provider router tests passed.");
  else { console.error(`\n${failed} assertion(s) failed.`); process.exitCode = 1; }
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
