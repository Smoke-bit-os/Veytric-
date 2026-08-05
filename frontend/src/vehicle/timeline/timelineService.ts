// Timeline domain service — unified chronological vehicle history.
// Independent of BLE/Simulation transport; offline-first via cache.
import { api } from "@/src/api";
import { fetchCached } from "../intelligence/cache";

export type TimelineGroup = "all" | "diagnostics" | "maintenance" | "performance" | "repairs" | "parts" | "notes";

export interface TimelineEvent {
  ts: string;
  type: string;
  group: string;
  title: string;
  subtitle?: string;
  refId?: string;
  healthScore?: number | null;
  mileage?: number | null;
  cost?: number | null;
  hasAi?: boolean;
  severity?: "good" | "info" | "warn" | "bad";
}

export interface TimelineResult {
  vehicle_id: string;
  count: number;
  counts: Record<string, number>;
  events: TimelineEvent[];
}

export const FILTERS: { key: TimelineGroup; label: string; icon: string }[] = [
  { key: "all", label: "All", icon: "timeline-text" },
  { key: "diagnostics", label: "Diagnostics", icon: "stethoscope" },
  { key: "maintenance", label: "Maintenance", icon: "wrench" },
  { key: "performance", label: "Performance", icon: "chart-line" },
  { key: "repairs", label: "Repairs", icon: "car-wrench" },
  { key: "parts", label: "Parts", icon: "cog" },
  { key: "notes", label: "Notes", icon: "note-text" },
];

export const timelineService = {
  get: (id: string, filter: TimelineGroup = "all") =>
    fetchCached<TimelineResult>(`timeline:${id}:${filter}`, () => api.vehicleTimeline(id, filter)),
};
