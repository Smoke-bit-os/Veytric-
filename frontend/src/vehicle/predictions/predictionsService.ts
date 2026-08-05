// Predictive maintenance domain service. Numbers/urgency are computed by the
// heuristic backend engine (offline-first via cache). No AI, no BLE coupling.
import { api } from "@/src/api";
import { fetchCached } from "../intelligence/cache";

export type Urgency = "overdue" | "soon" | "upcoming" | "ok";

export interface PredictionItem {
  key: string;
  name: string;
  intervalKm: number;
  lastServiceKm: number | null;
  kmSince: number;
  remainingKm: number;
  remainingLifePct: number;
  dueMileage: number | null;
  urgency: Urgency;
  confidence: number;
  reasons: string[];
}

export interface PredictionResult {
  mileage: number;
  items: PredictionItem[];
}

export const URGENCY_META: Record<Urgency, { label: string; color: string }> = {
  overdue: { label: "OVERDUE", color: "#FF3D00" },
  soon: { label: "DUE SOON", color: "#FFB300" },
  upcoming: { label: "UPCOMING", color: "#00B0FF" },
  ok: { label: "OK", color: "#00E676" },
};

export const predictionsService = {
  get: (id: string) => fetchCached<PredictionResult>(`predictions:${id}`, () => api.vehiclePredictions(id)),
};
