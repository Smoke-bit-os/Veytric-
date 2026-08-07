import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
export const TOKEN_KEY = "jarvis_token";

async function authHeaders(): Promise<Record<string, string>> {
  const token = await storage.secureGet<string>(TOKEN_KEY, "");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(path: string, options: RequestInit = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(await authHeaders()),
    ...(options.headers || {}),
  };
  const res = await fetch(`${BASE}/api${path}`, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail || "Request failed");
  }
  return data;
}

export const api = {
  register: (name: string, email: string, password: string) =>
    request("/auth/register", { method: "POST", body: JSON.stringify({ name, email, password }) }),
  login: (email: string, password: string) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  me: () => request("/auth/me"),

  vehicles: () => request("/vehicles"),
  addVehicle: (v: any) => request("/vehicles", { method: "POST", body: JSON.stringify(v) }),
  activateVehicle: (id: string) => request(`/vehicles/${id}/activate`, { method: "POST" }),
  deleteVehicle: (id: string) => request(`/vehicles/${id}`, { method: "DELETE" }),

  chat: (payload: any) => request("/chat", { method: "POST", body: JSON.stringify(payload) }),
  chatHistory: (sessionId: string) => request(`/chat/history/${sessionId}`),

  analyzeDtc: (payload: any) => request("/dtc/analyze", { method: "POST", body: JSON.stringify(payload) }),
  decodeVin: (vin: string) => request("/vin/decode", { method: "POST", body: JSON.stringify({ vin }) }),

  upsertVehicleByVin: (payload: any) => request("/vehicles/upsert-by-vin", { method: "POST", body: JSON.stringify(payload) }),
  getVehicleProfile: (id: string) => request(`/vehicles/${id}`),
  patchVehicle: (id: string, updates: any) => request(`/vehicles/${id}`, { method: "PATCH", body: JSON.stringify(updates) }),
  addVehicleHistory: (id: string, kind: string, entry: any) =>
    request(`/vehicles/${id}/history/${kind}`, { method: "POST", body: JSON.stringify(entry) }),
  addVehicleHealth: (id: string, score: number) =>
    request(`/vehicles/${id}/health`, { method: "POST", body: JSON.stringify({ score }) }),

  createRecording: (payload: any) => request("/recordings", { method: "POST", body: JSON.stringify(payload) }),
  listRecordings: (vehicleId?: string) => request(`/recordings${vehicleId ? `?vehicle_id=${vehicleId}` : ""}`),
  getRecording: (id: string) => request(`/recordings/${id}`),
  deleteRecording: (id: string) => request(`/recordings/${id}`, { method: "DELETE" }),
  vehiclePerformance: (id: string) => request(`/vehicles/${id}/performance`),
  analyzeRecording: (id: string) => request(`/recordings/${id}/analyze`, { method: "POST" }),

  vehicleTimeline: (id: string, filter?: string) =>
    request(`/vehicles/${id}/timeline${filter && filter !== "all" ? `?filter=${filter}` : ""}`),
  vehiclePredictions: (id: string) => request(`/vehicles/${id}/predictions`),
  vehicleTrends: (id: string) => request(`/vehicles/${id}/trends`),
  explainTrends: (id: string) => request(`/vehicles/${id}/trends/explain`, { method: "POST" }),
  vehicleDashboard: (id: string) => request(`/vehicles/${id}/dashboard`),
  getHealthReport: (id: string) => request(`/vehicles/${id}/health-report`),
  createHealthReport: (id: string) => request(`/vehicles/${id}/health-report`, { method: "POST" }),

  interpretDiagnostics: (payload: any) => request("/diagnostics/interpret", { method: "POST", body: JSON.stringify(payload) }),
  createScan: (payload: any) => request("/scans", { method: "POST", body: JSON.stringify(payload) }),
  listScans: (vehicleId?: string) => request(`/scans${vehicleId ? `?vehicle_id=${vehicleId}` : ""}`),
  getScan: (id: string) => request(`/scans/${id}`),
  analyzeScan: (id: string) => request(`/scans/${id}/analyze`, { method: "POST" }),
  deleteScan: (id: string) => request(`/scans/${id}`, { method: "DELETE" }),
  createReport: (payload: any) => request("/reports", { method: "POST", body: JSON.stringify(payload) }),
  listReports: () => request("/reports"),
  getReport: (id: string) => request(`/reports/${id}`),

  speak: (text: string, voice = "onyx") =>
    request("/voice/speak", { method: "POST", body: JSON.stringify({ text, voice }) }),

  getSubscription: () => request("/subscription"),
  aiAnalyze: (payload: any) => request("/ai/analyze", { method: "POST", body: JSON.stringify(payload) }),
  startTrial: () => request("/subscription/start-trial", { method: "POST" }),
  restorePurchases: () => request("/subscription/restore", { method: "POST" }),
  validateReceipt: () => request("/subscription/validate", { method: "POST" }),
  developerSetSubscription: (action: string) =>
    request("/subscription/developer/set", { method: "POST", body: JSON.stringify({ action }) }),

  transcribe: async (uri: string) => {
    const form = new FormData();
    form.append("file", { uri, name: "voice.m4a", type: "audio/m4a" } as any);
    const res = await fetch(`${BASE}/api/voice/transcribe`, {
      method: "POST",
      headers: { ...(await authHeaders()) },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail || "Transcription failed");
    return data;
  },
};
