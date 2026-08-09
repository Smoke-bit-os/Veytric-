// ============================================================================
//  DiagnosticAIService — provider-aware routing for ALL heavy diagnostic AI
//  (scan reports, health reports, trend explanations, recording analysis, DTC
//  analysis, module/system interpretation).
//
//  The backend PREPARES the prompt/context; the actual inference is routed to
//  the active provider:
//    • JARVIS Cloud → existing backend endpoint (persists + counts quota)
//    • BYOK (OpenAI user key) → prepared prompt runs on api.openai.com directly
//    • Local (Ollama) → prepared prompt runs on the user's local server
//
//  BYOK/Local NEVER consume the JARVIS Cloud quota and NEVER silently fall back
//  to Cloud — a provider failure throws a ProviderError so the UI can surface
//  the real error and offer retry/configure.
// ============================================================================

import { AIProviderType } from "./types";
import { getProvider, resolveInitialProviderType } from "./aiProvider";

export type DiagnosticProviderTag = "cloud" | "byok" | "local";

export interface DiagnosticResult {
  text: string;
  provider: DiagnosticProviderTag;
  model?: string;
  generatedAt: string;
}

export interface PreparedPrompt {
  system?: string;
  prompt: string;
}

// A provider (BYOK/Local) request failed. NEVER caught-and-fallen-back to Cloud.
export class ProviderError extends Error {
  provider: DiagnosticProviderTag;
  constructor(message: string, provider: DiagnosticProviderTag) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
  }
}

function tag(t: AIProviderType): DiagnosticProviderTag {
  return t === AIProviderType.OPENAI_USER_KEY ? "byok" : t === AIProviderType.LOCAL_AI ? "local" : "cloud";
}

// The active engine, resolved fresh each call so a provider switch in Settings
// takes effect immediately for the very next diagnostic request.
export async function activeProviderTag(): Promise<DiagnosticProviderTag> {
  return tag(await resolveInitialProviderType());
}

export async function isCloudActive(): Promise<boolean> {
  return (await resolveInitialProviderType()) === AIProviderType.JARVIS_CLOUD;
}

// Runs an already-prepared prompt on the active NON-cloud engine (BYOK/Local).
// Throws ProviderError on failure — the caller must NOT fall back to Cloud.
export async function runPreparedOnActive(prep: PreparedPrompt): Promise<DiagnosticResult> {
  const t = await resolveInitialProviderType();
  const providerTag = tag(t);
  const provider = getProvider(t);
  await provider.connect().catch(() => {});
  const res = await provider.analyze(prep.prompt, undefined, { system: prep.system });
  if (!res.ok || !res.text) {
    throw new ProviderError(res.error || `${provider.name} request failed`, providerTag);
  }
  return { text: res.text, provider: providerTag, model: res.model, generatedAt: new Date().toISOString() };
}
