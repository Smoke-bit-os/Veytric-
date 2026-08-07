import { AIProvider, AIProviderType } from "./types";
import { openaiProvider } from "./openaiProvider";
import { cloudProvider } from "./cloudProvider";
import { localProvider } from "./localProvider";
import { aiSecureStorage } from "./secureStorage";

// Factory + selection logic. Returns the singleton provider for a given type.
export function getProvider(type: AIProviderType): AIProvider {
  switch (type) {
    case AIProviderType.OPENAI_USER_KEY:
      return openaiProvider;
    case AIProviderType.LOCAL_AI:
      return localProvider;
    case AIProviderType.JARVIS_CLOUD:
    default:
      return cloudProvider;
  }
}

// Resolves the active provider on startup:
//   1. Honor an explicit user selection if one is saved.
//   2. Else, if an OpenAI key exists, use BYOK.
//   3. Else default to JARVIS Cloud.
export async function resolveInitialProviderType(): Promise<AIProviderType> {
  const saved = await aiSecureStorage.getProviderType();
  if (saved && (Object.values(AIProviderType) as string[]).includes(saved)) {
    return saved as AIProviderType;
  }
  if (await aiSecureStorage.hasOpenAIKey()) return AIProviderType.OPENAI_USER_KEY;
  return AIProviderType.JARVIS_CLOUD;
}
