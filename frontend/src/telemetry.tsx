import React, { createContext, useContext, useEffect, useRef, useState } from "react";

export type Telemetry = {
  rpm: number;
  speed: number;
  coolantTemp: number;
  oilTemp: number;
  batteryVoltage: number;
  boost: number; // MAP kPa relative
  throttle: number;
  shortFuelTrim: number;
  longFuelTrim: number;
  chargingVoltage: number;
  connected: boolean;
  dtcs: { code: string; desc: string }[];
};

const HISTORY_LEN = 30;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function walk(v: number, step: number, min: number, max: number) {
  return clamp(v + (Math.random() - 0.5) * step, min, max);
}

type Ctx = {
  data: Telemetry;
  history: Record<string, number[]>;
};

const TelemetryContext = createContext<Ctx>({} as Ctx);

const DEFAULT: Telemetry = {
  rpm: 820,
  speed: 0,
  coolantTemp: 88,
  oilTemp: 92,
  batteryVoltage: 12.6,
  boost: 32,
  throttle: 8,
  shortFuelTrim: 1.5,
  longFuelTrim: -2.0,
  chargingVoltage: 14.2,
  connected: true,
  dtcs: [
    { code: "P0300", desc: "Random/Multiple Cylinder Misfire Detected" },
    { code: "P0171", desc: "System Too Lean (Bank 1)" },
  ],
};

export function TelemetryProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<Telemetry>(DEFAULT);
  const historyRef = useRef<Record<string, number[]>>({
    rpm: Array(HISTORY_LEN).fill(820),
    speed: Array(HISTORY_LEN).fill(0),
    boost: Array(HISTORY_LEN).fill(32),
    coolantTemp: Array(HISTORY_LEN).fill(88),
    batteryVoltage: Array(HISTORY_LEN).fill(12.6),
    throttle: Array(HISTORY_LEN).fill(8),
  });
  const [history, setHistory] = useState(historyRef.current);

  useEffect(() => {
    const id = setInterval(() => {
      setData((prev) => {
        const throttle = walk(prev.throttle, 18, 0, 100);
        const rpm = clamp(820 + throttle * 58 + (Math.random() - 0.5) * 120, 700, 6800);
        const speed = clamp(prev.speed + (throttle - 12) * 0.6, 0, 180);
        const boost = clamp(28 + throttle * 0.9 + (Math.random() - 0.5) * 6, 20, 180);
        const next: Telemetry = {
          ...prev,
          throttle,
          rpm,
          speed,
          boost,
          coolantTemp: walk(prev.coolantTemp, 1.2, 82, 104),
          oilTemp: walk(prev.oilTemp, 1.4, 85, 112),
          batteryVoltage: walk(prev.batteryVoltage, 0.06, 12.2, 12.8),
          chargingVoltage: walk(prev.chargingVoltage, 0.05, 13.8, 14.6),
          shortFuelTrim: walk(prev.shortFuelTrim, 1.5, -12, 12),
          longFuelTrim: walk(prev.longFuelTrim, 0.8, -12, 8),
        };

        const h = historyRef.current;
        (["rpm", "speed", "boost", "coolantTemp", "batteryVoltage", "throttle"] as const).forEach(
          (k) => {
            h[k] = [...h[k].slice(1), Math.round((next as any)[k] * 10) / 10];
          }
        );
        setHistory({ ...h });
        return next;
      });
    }, 900);
    return () => clearInterval(id);
  }, []);

  return (
    <TelemetryContext.Provider value={{ data, history }}>{children}</TelemetryContext.Provider>
  );
}

export const useTelemetry = () => useContext(TelemetryContext);

export type HealthSystem = { name: string; score: number; status: "good" | "warn" | "bad" };

export function computeHealth(t: Telemetry): HealthSystem[] {
  const engine = t.dtcs.some((d) => d.code.startsWith("P03")) ? 62 : 88;
  const fuel = Math.abs(t.longFuelTrim) > 8 || t.dtcs.some((d) => d.code === "P0171") ? 58 : 90;
  const cooling = t.coolantTemp > 100 ? 55 : t.coolantTemp > 96 ? 74 : 93;
  const electrical = t.batteryVoltage < 12.3 ? 60 : t.chargingVoltage < 13.7 ? 70 : 95;
  const transmission = 91;
  const toStatus = (s: number): "good" | "warn" | "bad" =>
    s >= 80 ? "good" : s >= 65 ? "warn" : "bad";
  return [
    { name: "Engine", score: engine, status: toStatus(engine) },
    { name: "Fuel System", score: fuel, status: toStatus(fuel) },
    { name: "Cooling", score: cooling, status: toStatus(cooling) },
    { name: "Electrical", score: electrical, status: toStatus(electrical) },
    { name: "Transmission", score: transmission, status: toStatus(transmission) },
  ];
}
