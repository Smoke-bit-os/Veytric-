import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { AIProvider, AIProviderType, AIResponse, AIVehicleContext, AIAnalyzeOptions } from "./types";
import { getProvider, resolveInitialProviderType } from "./aiProvider";
import { aiSecureStorage, maskKey, isValidOpenAIKeyFormat } from "./secureStorage";
import { api } from "@/src/api";

// ============================================================================
//  AI Engine context — the single hub the whole app uses for AI. Screens call
//  useAI().analyze(...) and never care which provider is active. Switching
//  providers persists and takes effect immediately.
// ============================================================================

type AIContextValue = {
  providerType: AIProviderType;
  providerName: string;
  ready: boolean;
  setProviderType: (t: AIProviderType) => Promise<void>;
  analyze: (prompt: string, vehicleData?: AIVehicleContext, opts?: AIAnalyzeOptions) => Promise<AIResponse>;
  testConnection: () => Promise<boolean>;

  // Cloud usage meter (Free = monthly quota)
  usage: { tier: string; requests_used: number; requests_limit: number | null; remaining: number | null; unlimited: boolean } | null;
  refreshUsage: () => Promise<void>;

  // BYOK / OpenAI
  hasOpenAIKey: boolean;
  maskedKey: string;
  openaiModel: string;
  saveOpenAIKey: (key: string) => Promise<{ ok: boolean; error?: string }>;
  removeOpenAIKey: () => Promise<void>;
  setOpenAIModel: (m: string) => Promise<void>;
  testOpenAI: () => Promise<boolean>;

  // Local
  localUrl: string;
  localModel: string;
  setLocalUrl: (u: string) => Promise<void>;
  setLocalModel: (m: string) => Promise<void>;
  testLocal: () => Promise<boolean>;
};

const AICtx = createContext<AIContextValue>({} as AIContextValue);

export function AIEngineProvider({ children }: { children: React.ReactNode }) {
  const [providerType, setType] = useState<AIProviderType>(AIProviderType.JARVIS_CLOUD);
  const [ready, setReady] = useState(false);
  const [hasOpenAIKey, setHasKey] = useState(false);
  const [maskedKey, setMasked] = useState("");
  const [openaiModel, setModel] = useState("");
  const [localUrl, setUrl] = useState("");
  const [localModel, setLocalM] = useState("");
  const [usage, setUsage] = useState<AIContextValue["usage"]>(null);

  const refreshUsage = useCallback(async () => {
    try {
      setUsage(await api.aiUsage());
    } catch {
      /* offline / guest — leave last known */
    }
  }, []);

  const refreshConfig = useCallback(async () => {
    const key = await aiSecureStorage.getOpenAIKey();
    setHasKey(!!key);
    setMasked(key ? maskKey(key) : "");
    setModel(await aiSecureStorage.getOpenAIModel());
    setUrl(await aiSecureStorage.getLocalUrl());
    setLocalM(await aiSecureStorage.getLocalModel());
  }, []);

  useEffect(() => {
    (async () => {
      const t = await resolveInitialProviderType();
      setType(t);
      await refreshConfig();
      getProvider(t).connect().catch(() => {});
      setReady(true);
      refreshUsage();
    })();
  }, [refreshConfig]);

  const current = (): AIProvider => getProvider(providerType);

  const setProviderType = useCallback(async (t: AIProviderType) => {
    await aiSecureStorage.setProviderType(t);
    setType(t);
    getProvider(t).connect().catch(() => {});
  }, []);

  const analyze = useCallback(
    (prompt: string, vehicleData?: AIVehicleContext, opts?: AIAnalyzeOptions) =>
      current().analyze(prompt, vehicleData, opts),
    [providerType],
  );

  const testConnection = useCallback(() => current().testConnection(), [providerType]);

  const saveOpenAIKey = useCallback(async (key: string) => {
    if (!isValidOpenAIKeyFormat(key)) return { ok: false, error: "Invalid key format. Expected an OpenAI key starting with sk-." };
    await aiSecureStorage.saveOpenAIKey(key);
    const { openaiProvider } = await import("./openaiProvider");
    await openaiProvider.connect();
    const okConn = await openaiProvider.testConnection();
    if (!okConn) {
      await aiSecureStorage.removeOpenAIKey();
      await refreshConfig();
      return { ok: false, error: "Key saved but connection test failed — key rejected by OpenAI." };
    }
    await refreshConfig();
    return { ok: true };
  }, [refreshConfig]);

  const removeOpenAIKey = useCallback(async () => {
    await aiSecureStorage.removeOpenAIKey();
    await refreshConfig();
  }, [refreshConfig]);

  const setOpenAIModel = useCallback(async (m: string) => {
    await aiSecureStorage.setOpenAIModel(m);
    setModel(await aiSecureStorage.getOpenAIModel());
  }, []);

  const testOpenAI = useCallback(async () => {
    const { openaiProvider } = await import("./openaiProvider");
    await openaiProvider.connect();
    return openaiProvider.testConnection();
  }, []);

  const setLocalUrl = useCallback(async (u: string) => {
    await aiSecureStorage.setLocalUrl(u);
    setUrl(await aiSecureStorage.getLocalUrl());
  }, []);

  const setLocalModel = useCallback(async (m: string) => {
    await aiSecureStorage.setLocalModel(m);
    setLocalM(await aiSecureStorage.getLocalModel());
  }, []);

  const testLocal = useCallback(async () => localProviderTest(), []);

  return (
    <AICtx.Provider
      value={{
        providerType,
        providerName: current().name,
        ready,
        setProviderType,
        analyze,
        testConnection,
        usage,
        refreshUsage,
        hasOpenAIKey,
        maskedKey,
        openaiModel,
        saveOpenAIKey,
        removeOpenAIKey,
        setOpenAIModel,
        testOpenAI,
        localUrl,
        localModel,
        setLocalUrl,
        setLocalModel,
        testLocal,
      }}
    >
      {children}
    </AICtx.Provider>
  );
}

async function localProviderTest(): Promise<boolean> {
  const { localProvider } = await import("./localProvider");
  return localProvider.testConnection();
}

export const useAI = () => useContext(AICtx);
