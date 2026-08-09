// Vehicle Profile service — thin wrapper over the backend profile/history API.
// Keeps the profile domain isolated from transports and UI.

import { api } from "@/src/api";
import { VehicleIdentity } from "../types";

export const profileService = {
  upsertByVin: (vin: string, spec: Partial<VehicleIdentity>, nickname?: string, mileage?: number) =>
    api.upsertVehicleByVin({ vin, spec, nickname, mileage }),
  getProfile: (id: string) => api.getVehicleProfile(id),
  patch: (id: string, updates: { name?: string; mileage?: number; customerName?: string; customerNotes?: string }) => api.patchVehicle(id, updates),
  addHistory: (id: string, kind: "maintenance" | "parts" | "dtc", entry: { title: string; detail?: string; meta?: any }) =>
    api.addVehicleHistory(id, kind, entry),
  addHealthSample: (id: string, score: number) => api.addVehicleHealth(id, score),
};
