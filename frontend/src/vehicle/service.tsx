import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { Platform } from "react-native";
import {
  AdapterInfo,
  BleStatusReport,
  ConnectionStatus,
  Dtc,
  VehicleData,
  VehicleDataProvider,
  VehicleIdentity,
  VehicleSignals,
} from "./types";
import { SimulationProvider } from "./simulationProvider";
import { PID_CATALOG } from "./health";

const HISTORY_LEN = 40;

// Transport selection (platform-aware, deterministic):
//   • WEB / browser preview  → ALWAYS SimulationProvider (native BLE cannot run
//     in a browser). This is unconditional so the preview never tries BLE.
//   • NATIVE (Android/iOS standalone build or dev build) → REAL BleProvider by
//     default. Only an explicit EXPO_PUBLIC_VEHICLE_MODE=simulation forces the
//     simulator on native (developer convenience). The default is "ble" so a
//     production APK/IPA uses real hardware even if the env var wasn't injected.
// NOTE: EXPO_PUBLIC_* values are inlined at BUILD time by Metro, so the APK
// carries whatever was set when it was built (see frontend/.env + eas.json).
function createProvider(): VehicleDataProvider {
  if (Platform.OS === "web") return new SimulationProvider();
  const mode = (process.env.EXPO_PUBLIC_VEHICLE_MODE || "ble").toLowerCase();
  if (mode === "simulation" || mode === "sim") return new SimulationProvider();
  const { BleProvider } = require("./bleProvider");
  return new BleProvider();
}

type FlatData = VehicleSignals & { connected: boolean; dtcs: { code: string; desc: string }[] };

interface Ctx {
  data: FlatData;
  signals: VehicleSignals;
  dtcs: Dtc[];
  identity: VehicleIdentity | null;
  adapter: AdapterInfo | null;
  connection: ConnectionStatus;
  mode: string;
  history: Record<string, number[]>;
  scan: () => Promise<AdapterInfo[]>;
  connect: (id?: string) => Promise<VehicleIdentity>;
  disconnect: () => Promise<void>;
  clearDtcs: () => Promise<void>;
  reconnect: () => Promise<void>;
  enrichIdentity: (partial: Partial<VehicleIdentity>) => void;
  getDiagnostics: () => import("./types").ConnectionDiagnostics | null;
  getLog: () => import("./types").ObdLogEntry[];
  getStatusReport: () => BleStatusReport;
  readFreezeFrame: (code?: string) => Promise<import("./types").FreezeFrame | null>;
}

const VehicleContext = createContext<Ctx>({} as Ctx);

const emptySignals = (): VehicleSignals =>
  Object.fromEntries(PID_CATALOG.map((p) => [p.key, 0])) as unknown as VehicleSignals;

export function VehicleServiceProvider({ children }: { children: React.ReactNode }) {
  const providerRef = useRef<VehicleDataProvider>(createProvider());
  const unsubRef = useRef<(() => void) | null>(null);
  const historyRef = useRef<Record<string, number[]>>(
    Object.fromEntries(PID_CATALOG.map((p) => [p.key, Array(HISTORY_LEN).fill(0)]))
  );

  const [signals, setSignals] = useState<VehicleSignals>(emptySignals());
  const [dtcs, setDtcs] = useState<Dtc[]>([]);
  const [identity, setIdentity] = useState<VehicleIdentity | null>(null);
  const [adapter, setAdapter] = useState<AdapterInfo | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>("idle");
  const [history, setHistory] = useState(historyRef.current);

  const startStream = useCallback(() => {
    unsubRef.current?.();
    unsubRef.current = providerRef.current.subscribe((s) => {
      setSignals(s);
      const h = historyRef.current;
      PID_CATALOG.forEach((p) => {
        const v = (s as any)[p.key];
        if (typeof v === "number") h[p.key] = [...h[p.key].slice(1), Math.round(v * 100) / 100];
      });
      setHistory({ ...h });
    });
  }, []);

  const connect = useCallback(
    async (id?: string) => {
      setConnection("connecting");
      try {
        const { adapter: a, identity: idn } = await providerRef.current.connect(id);
        setAdapter(a);
        setIdentity(idn);
        const codes = await providerRef.current.readDtcs();
        setDtcs(codes);
        startStream();
        setConnection("connected");
        return idn;
      } catch (e) {
        setConnection("failed");
        throw e;
      }
    },
    [startStream]
  );

  const scan = useCallback(async () => {
    setConnection("scanning");
    const adapters = await providerRef.current.scan();
    setConnection(adapters.length ? "found" : "failed");
    return adapters;
  }, []);

  const disconnect = useCallback(async () => {
    unsubRef.current?.();
    unsubRef.current = null;
    await providerRef.current.disconnect();
    setConnection("disconnected");
  }, []);

  const clearDtcs = useCallback(async () => {
    await providerRef.current.clearDtcs();
    setDtcs([]);
  }, []);

  const reconnect = useCallback(async () => {
    setConnection("connecting");
    try {
      await providerRef.current.reconnect?.();
      startStream();
      const codes = await providerRef.current.readDtcs();
      setDtcs(codes);
      setConnection("connected");
    } catch {
      setConnection("failed");
    }
  }, [startStream]);

  const getDiagnostics = useCallback(() => providerRef.current.getDiagnostics?.() ?? null, []);
  const getLog = useCallback(() => providerRef.current.getLog?.() ?? [], []);
  const getStatusReport = useCallback(
    (): BleStatusReport =>
      providerRef.current.getStatusReport?.() ?? {
        mode: providerRef.current.mode,
        nativeBleAvailable: false,
        permissions: "n/a",
        bluetoothPoweredOn: null,
        adapterDiscovered: false,
        adapterConnected: false,
        elm327Initialized: false,
        protocol: "Unknown",
        pollingActive: false,
      },
    []
  );
  const enrichIdentity = useCallback((partial: Partial<VehicleIdentity>) => {
    setIdentity((prev) => (prev ? { ...prev, ...partial } : (partial as VehicleIdentity)));
  }, []);
  const readFreezeFrame = useCallback(
    (code?: string) => providerRef.current.readFreezeFrame?.(code) ?? Promise.resolve(null),
    []
  );

  // Auto-connect on mount ONLY in simulation (web/preview/dev). Real BLE must
  // be started by the user from the Connection Center so the Bluetooth
  // permission prompt appears on intent — never silently on app launch.
  useEffect(() => {
    if (providerRef.current.mode === "simulation") {
      (async () => {
        try {
          await scan();
          await connect();
        } catch {
          /* remain disconnected; Connection Center handles recovery */
        }
      })();
    }
    return () => {
      unsubRef.current?.();
      providerRef.current.disconnect().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data: FlatData = {
    ...signals,
    connected: connection === "connected",
    dtcs: dtcs.map((d) => ({ code: d.code, desc: d.desc })),
  };

  return (
    <VehicleContext.Provider
      value={{
        data,
        signals,
        dtcs,
        identity,
        adapter,
        connection,
        mode: providerRef.current.mode,
        history,
        scan,
        connect,
        disconnect,
        clearDtcs,
        reconnect,
        enrichIdentity,
        getDiagnostics,
        getLog,
        getStatusReport,
        readFreezeFrame,
      }}
    >
      {children}
    </VehicleContext.Provider>
  );
}

export const useVehicle = () => useContext(VehicleContext);

// Structured accessor for screens that want the full VehicleData object.
export function useVehicleData(): VehicleData {
  const { signals, dtcs, identity, connection } = useVehicle();
  return { signals, dtcs, identity, phase: "cruise", connected: connection === "connected" };
}
