// Predictive maintenance domain service. Numbers/urgency are computed by the
// heuristic backend engine (offline-first via cache). No AI, no BLE coupling.
import { api } from "@/src/api";
import { fetchCached } from "../intelligence/cache";

export type Urgency = "overdue" | "soon" | "upcoming" | "ok" | "inspect" | "test" | "unknown";
export type PredictionSource =
  | "LIVE_ECU"
  | "USER_SERVICE_HISTORY"
  | "MANUFACTURER_INTERVAL"
  | "GENERAL_INDUSTRY_INTERVAL"
  | "UNAVAILABLE";

export interface PredictionItem {
  key: string;
  name: string;
  intervalKm: number;
  lastServiceKm: number | null;
  kmSince: number;
  remainingKm: number | null;
  remainingLifePct: number | null;
  dueMileage: number | null;
  urgency: Urgency;
  source: PredictionSource;
  confidence: number | null;
  reasons: string[];
}

export interface PredictionResult {
  mileage: number | null;
  mileageKnown?: boolean;
  items: PredictionItem[];
}

export const URGENCY_META: Record<Urgency, { label: string; color: string }> = {
  overdue: { label: "OVERDUE", color: "#FF3D00" },
  soon: { label: "DUE SOON", color: "#FFB300" },
  upcoming: { label: "UPCOMING", color: "#00B0FF" },
  ok: { label: "OK", color: "#00E676" },
  inspect: { label: "INSPECT", color: "#FFB300" },
  test: { label: "TEST REQUIRED", color: "#FFB300" },
  unknown: { label: "UNKNOWN", color: "#90A4AE" },
};

export const SOURCE_META: Record<PredictionSource, { label: string; short: string }> = {
  LIVE_ECU: { label: "Live ECU / recorded measurement", short: "MEASURED" },
  USER_SERVICE_HISTORY: { label: "Based on your service history", short: "YOUR HISTORY" },
  MANUFACTURER_INTERVAL: { label: "Manufacturer recommendation", short: "MANUFACTURER" },
  GENERAL_INDUSTRY_INTERVAL: { label: "General industry recommendation (not vehicle-specific)", short: "GENERAL" },
  UNAVAILABLE: { label: "Insufficient maintenance data", short: "NO DATA" },
};

export const predictionsService = {
  get: (id: string) => fetchCached<PredictionResult>(`predictions:${id}`, () => api.vehiclePredictions(id)),
};
