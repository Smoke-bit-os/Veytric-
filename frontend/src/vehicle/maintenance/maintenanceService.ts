// Maintenance / repair-log domain service + dashboard summary + AI health report.
// Repairs & notes are stored via the shared vehicle-history API (kinds repair/note).
import { api } from "@/src/api";
import { fetchCached } from "../intelligence/cache";

export interface DashboardSummary {
  vehicle_id: string;
  healthScore: number | null;
  mileage: number | null;
  lastScan: string | null;
  lastRecording: string | null;
  lastMaintenance: string | null;
  nextService: { name: string; dueMileage: number | null; urgency: string } | null;
  alerts: { key: string; name: string; urgency: string }[];
  trends: { key: string; direction: string; severity: string }[];
  counts: { scans: number; recordings: number; history: number };
}

export interface RepairInput {
  title: string;
  detail?: string;
  mileage?: number;
  cost?: number;
  parts?: string;
  labor?: string;
  linkedReportId?: string;
  linkedRecordingId?: string;
}

export const maintenanceService = {
  dashboard: (id: string) => fetchCached<DashboardSummary>(`dashboard:${id}`, () => api.vehicleDashboard(id)),

  addRepair: (id: string, r: RepairInput) =>
    api.addVehicleHistory(id, "repair", {
      title: r.title,
      detail: r.detail || "",
      meta: {
        mileage: r.mileage ?? null,
        cost: r.cost ?? null,
        parts: r.parts || "",
        labor: r.labor || "",
        linkedReportId: r.linkedReportId || null,
        linkedRecordingId: r.linkedRecordingId || null,
      },
    }),

  addNote: (id: string, title: string, detail?: string, mileage?: number) =>
    api.addVehicleHistory(id, "note", { title, detail: detail || "", meta: { mileage: mileage ?? null } }),

  getHealthReport: (id: string) => api.getHealthReport(id),
  createHealthReport: (id: string) => api.createHealthReport(id),
};
