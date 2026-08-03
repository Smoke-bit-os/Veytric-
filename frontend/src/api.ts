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

  speak: (text: string, voice = "onyx") =>
    request("/voice/speak", { method: "POST", body: JSON.stringify({ text, voice }) }),

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
