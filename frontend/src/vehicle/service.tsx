import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { Platform } from "react-native";
import {
  AdapterInfo,
  BleStatusReport,
  ConnectionStatus,
  DataSource,
  Dtc,
  VehicleData,
  VehicleDataProvider,
  VehicleIdentity,
  VehicleSignals,
} from "./types";
import { SimulationProvider } from "./simulationProvider";
import { PID_CATALOG } from "./health";

const HISTORY_LEN = 40;

// Transport selection (platform-aware, deterministic + PRODUCTION-SAFE):
//   • WEB / browser preview → ALWAYS SimulationProvider.
//   • NATIVE PRODUCTION (Android/iOS release APK/IPA) → ALWAYS BleProvider.
//     There is NO way to reach SimulationProvider on a production native build:
//     the simulation override is honored ONLY when __DEV__ is true (engineer's
//     dev build). A shipped APK/IPA (where __DEV__ === false) can never
//     instantiate simulation, regardless of env vars.
function createProvider(): VehicleDataProvider {
  if (Platform.OS === "web") return new SimulationProvider();
  // Native dev-only escape hatch (never in production):
  if (__DEV__) {
    const mode = (process.env.EXPO_PUBLIC_VEHICLE_MODE || "ble").toLowerCase();
    if (mode === "simulation" || mode === "sim") return new SimulationProvider();
  }
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
  dataSource: DataSource;
  hasLiveData: boolean;
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
        runtimeProvider: providerRef.current.mode === "simulation" ? "SimulationProvider" : "BLEProvider",
        nativeBleAvailable: false,
        permissions: "n/a",
        bluetoothPoweredOn: null,
        adapterDiscovered: false,
        adapterConnected: false,
        servicesDiscovered: false,
        characteristicsDiscovered: false,
        elm327Initialized: false,
        protocol: "Unknown",
        vinReceived: false,
        dtcResponseReceived: false,
        ecuCommunication: false,
        pollingActive: false,
        simulatedDataGenerated: false,
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

  // Authoritative data-source state. Native production is either REAL_BLE
  // (connected + a real ECU response received) or UNAVAILABLE — never SIMULATION.
  const provStatus = providerRef.current.getStatusReport?.();
  const dataSource: DataSource =
    providerRef.current.mode === "simulation"
      ? "SIMULATION"
      : connection === "connected" && provStatus?.ecuCommunication
      ? "REAL_BLE"
      : "UNAVAILABLE";
  const hasLiveData = dataSource === "REAL_BLE" || dataSource === "SIMULATION";

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
        dataSource,
        hasLiveData,
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
