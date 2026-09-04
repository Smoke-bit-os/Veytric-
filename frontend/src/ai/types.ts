// ============================================================================
//  AI Provider System — universal types. Mirrors the VehicleDataProvider
//  pattern: a single interface with swappable implementations (OpenAI BYOK,
//  JARVIS Cloud, Local/Ollama). Diagnostics code never depends on a concrete
//  provider — it talks only to this interface via the AI context.
// ============================================================================

export enum AIProviderType {
  JARVIS_CLOUD = "JARVIS_CLOUD",
  OPENAI_USER_KEY = "OPENAI_USER_KEY",
  LOCAL_AI = "LOCAL_AI",
}

// Rich context passed with every AI request. All fields optional so any caller
// can send whatever it has (profile + live data + diagnostics).
export type AIVehicleContext = {
  profile?: {
    vin?: string;
    year?: number | string;
    make?: string;
    model?: string;
    trim?: string;
    engine?: string;
    mileage?: number;
  };
  live?: Record<string, number | string | null | undefined>;
  diagnostics?: {
    dtcs?: string[];
    freezeFrame?: Record<string, any>;
    ecu?: string[];
    healthScore?: number | null;
    maintenance?: string[];
  };
  history?: { role: "user" | "assistant"; content: string }[];
};

export type AIResponse = {
  ok: boolean;
  text: string;
  provider: string;
  model?: string;
  error?: string;
};

export type AIAnalyzeOptions = {
  system?: string;   // override the default JARVIS system prompt
  history?: { role: "user" | "assistant"; content: string }[];
};

export interface AIProvider {
  name: string;
  type: AIProviderType;
  connect(): Promise<boolean>;
  analyze(prompt: string, vehicleData?: AIVehicleContext, opts?: AIAnalyzeOptions): Promise<AIResponse>;
  testConnection(): Promise<boolean>;
  disconnect(): Promise<void>;
}

export const JARVIS_SYSTEM_PROMPT =
  "You are VEYTRIC — AI Vehicle Intelligence, an elite AI automotive diagnostic assistant for mechanics and enthusiasts. " +
  "You combine live OBD-II sensor data with deep automotive knowledge. Give confident, technically " +
  "precise diagnostics. When relevant, reference the live sensor values provided. Structure answers " +
  "with a short direct assessment, likely causes (ranked), and concrete guided testing / repair steps. " +
  "Be concise. Use short paragraphs and bullet steps.";

// Builds a compact text context block from structured vehicle data.
export function buildContextBlock(v?: AIVehicleContext): string {
  if (!v) return "";
  const parts: string[] = [];
  if (v.profile) {
    const p = v.profile;
    const line = [p.year, p.make, p.model, p.trim].filter(Boolean).join(" ");
    if (line) parts.push(`Vehicle: ${line}${p.engine ? ` (${p.engine})` : ""}`);
    if (p.vin) parts.push(`VIN: ${p.vin}`);
    if (p.mileage != null) parts.push(`Mileage: ${p.mileage} km`);
  }
  if (v.live && Object.keys(v.live).length) {
    parts.push(`Live sensors: ${JSON.stringify(v.live)}`);
  }
  if (v.diagnostics) {
    const d = v.diagnostics;
    if (d.dtcs?.length) parts.push(`Active DTCs: ${d.dtcs.join(", ")}`);
    if (d.healthScore != null) parts.push(`Health score: ${d.healthScore}`);
    if (d.ecu?.length) parts.push(`ECU modules: ${d.ecu.join(", ")}`);
    if (d.maintenance?.length) parts.push(`Maintenance history: ${d.maintenance.join("; ")}`);
    if (d.freezeFrame && Object.keys(d.freezeFrame).length) parts.push(`Freeze frame: ${JSON.stringify(d.freezeFrame)}`);
  }
  return parts.length ? `\n\nCONTEXT:\n${parts.join("\n")}` : "";
}
