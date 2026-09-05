// VEYTRIC — Codes screen runtime (Prompt 2, Phase 2F vertical slice)
// Routes the Codes screen through the Prompt-1 Capability Router + Prompt-2
// Orchestrator + evidence boundary, WITHOUT touching the verified BLE/ELM327
// engine or the VehicleDataProvider interface. It consumes a duck-typed
// snapshot of the existing provider (the same DTC list the engine already
// returned) and produces a provenance/freshness-labeled view.
//
// Truth rules enforced here:
//   • MEASURED codes are emitted ONLY when a real ECU response exists
//     (ecuCommunication === true). Otherwise → DISCONNECTED / UNAVAILABLE.
//   • Simulated codes (web/dev preview) are labeled SIMULATED and are NEVER
//     presented as live/measured vehicle evidence.
//   • Nothing is fabricated: values come verbatim from the provider snapshot.
import { ProviderRegistry, RouterContext } from "@/src/providers/registry";
import { CapabilityRouter } from "@/src/providers/router";
import { BleVehicleAdapter, WrappedVehicleProvider } from "@/src/providers/adapters/bleVehicleAdapter";
import { Orchestrator } from "./core";
import { createTask } from "./stateMachine";
import { TaskType, TaskState } from "./taskTypes";
import {
  ProvenanceLabel,
  PROVENANCE_DISPLAY,
  Freshness,
  UnavailableReason,
  computeFreshness,
  isPresentableAsLive,
  DataClass,
} from "@/src/evidence";

/** Distinct, non-conflated code classifications required by the spec. */
export enum CodeStatus {
  CURRENT = "CURRENT",
  PENDING = "PENDING",
  PERMANENT = "PERMANENT",
  MANUFACTURER = "MANUFACTURER",
  STORED = "STORED",
}

export type CodesMode = "MEASURED" | "SIMULATION" | "DISCONNECTED" | "UNAVAILABLE";

export interface CodeItem {
  code: string;
  desc: string;
  status: CodeStatus;
  provenance: string;    // PROVENANCE_DISPLAY label, or "SIMULATED"
  freshness: Freshness;
  presentedAsLive: boolean;
}

export interface CodesView {
  mode: CodesMode;
  bannerLabel: string;
  reason?: string | null;
  items: CodeItem[];
  measuredCount: number;
  taskState: TaskState;
  taskId: string;
  /** True only when codes may be shown as real, current vehicle evidence. */
  isLiveEvidence: boolean;
}

export interface CodesSnapshot {
  userId: string;
  vehicleId?: string | null;
  sessionId?: string | null;
  mode: "ble" | "simulation";
  ecuCommunication: boolean;
  protocol: string;
  vin?: string | null;
  dtcs: { code: string; desc: string; type: string }[];
  platform: "web" | "ios" | "android";
  isDev: boolean;
  now?: number;
}

export function statusForType(t: string): CodeStatus {
  switch ((t || "").toLowerCase()) {
    case "pending":
      return CodeStatus.PENDING;
    case "permanent":
      return CodeStatus.PERMANENT;
    case "manufacturer":
      return CodeStatus.MANUFACTURER;
    case "stored":
    case "history":
      return CodeStatus.STORED;
    case "current":
    case "confirmed":
    default:
      return CodeStatus.CURRENT;
  }
}

/** Read trouble codes through the orchestrator + evidence boundary. */
export async function runCodesRead(snap: CodesSnapshot): Promise<CodesView> {
  const now = snap.now ?? Date.now();
  const descByCode = new Map(snap.dtcs.map((d) => [d.code, d.desc]));

  // Simulation (web / dev preview) — clearly labeled, NEVER measured/live.
  if (snap.mode === "simulation") {
    return {
      mode: "SIMULATION",
      bannerLabel: "SIMULATED — preview only, not from a real vehicle",
      reason: null,
      items: snap.dtcs.map((d) => ({
        code: d.code,
        desc: d.desc || "Manufacturer-specific code",
        status: statusForType(d.type),
        provenance: "SIMULATED",
        freshness: Freshness.UNKNOWN,
        presentedAsLive: false,
      })),
      measuredCount: 0,
      taskState: TaskState.COMPLETED,
      taskId: "sim",
      isLiveEvidence: false,
    };
  }

  // Real vehicle path — registry -> router -> orchestrator -> evidence envelope.
  const registry = new ProviderRegistry();
  const wrapped: WrappedVehicleProvider = {
    mode: snap.mode,
    readDtcs: async () => snap.dtcs,
    getStatusReport: () => ({
      ecuCommunication: snap.ecuCommunication,
      protocol: snap.protocol,
      vinReceived: !!snap.vin,
    }),
    getIdentity: () => ({ vin: snap.vin ?? undefined }),
    getLatestSignals: () => null,
    getDiagnostics: () => null,
  };
  registry.register(new BleVehicleAdapter(wrapped));
  const router = new CapabilityRouter(registry);
  const ctx: RouterContext = {
    runtime: { platform: snap.platform, isDev: snap.isDev },
    now: () => now,
  };
  const orch = new Orchestrator({ router, ctx });
  const task = createTask({
    taskType: TaskType.READ_VEHICLE_EVIDENCE,
    userId: snap.userId,
    vehicleId: snap.vehicleId ?? null,
    sessionId: snap.sessionId ?? null,
    requiredCapability: "vehicle.read_dtcs",
  });
  const result = await orch.run(task);

  const items: CodeItem[] = [];
  for (const r of result.evidence) {
    if (r.provenanceLabel !== ProvenanceLabel.MEASURED) continue;
    if (r.decodedName === "Stored DTC count") continue; // "no codes" marker
    const code = String(r.decodedValue);
    const fresh = computeFreshness(Date.now() - r.timestamp, DataClass.DTC);
    items.push({
      code,
      desc: descByCode.get(code) || "Manufacturer-specific code",
      status: statusForType(String(r.decodedUnit || "")),
      provenance: PROVENANCE_DISPLAY[r.provenanceLabel],
      freshness: fresh,
      presentedAsLive: isPresentableAsLive(fresh),
    });
  }

  // No measured evidence -> explicit DISCONNECTED / UNAVAILABLE (never a guess).
  if (result.state !== TaskState.COMPLETED && result.state !== TaskState.PARTIAL) {
    const na = result.evidence.find((r) => r.provenanceLabel === ProvenanceLabel.UNAVAILABLE);
    const reason = na?.limitations?.reason;
    const disconnected = reason === UnavailableReason.DISCONNECTED;
    return {
      mode: disconnected ? "DISCONNECTED" : "UNAVAILABLE",
      bannerLabel: disconnected
        ? "No live vehicle connection"
        : "Trouble codes unavailable",
      reason: na?.limitations?.notes || reason || null,
      items: [],
      measuredCount: 0,
      taskState: result.state,
      taskId: task.taskId,
      isLiveEvidence: false,
    };
  }

  return {
    mode: "MEASURED",
    bannerLabel: "LIVE — measured from your vehicle",
    reason: null,
    items,
    measuredCount: items.length,
    taskState: result.state,
    taskId: task.taskId,
    isLiveEvidence: true,
  };
}
