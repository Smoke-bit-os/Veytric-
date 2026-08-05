import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { useVehicle } from "../service";
import { computeSubsystems, overallHealth } from "../health";
import { api } from "@/src/api";
import { Recorder } from "./recorder";

interface Ctx {
  state: "idle" | "recording" | "paused";
  durationMs: number;
  sampleCount: number;
  start: () => void;
  pause: () => void;
  resume: () => void;
  stopAndSave: (opts: { name: string; notes?: string; driverNotes?: string; tags?: string[] }) => Promise<string | null>;
  cancel: () => void;
}

const RecordingContext = createContext<Ctx>({} as Ctx);

export function RecordingProvider({ children }: { children: React.ReactNode }) {
  const { signals, dtcs, identity } = useVehicle();
  const recorder = useRef(new Recorder());
  const [state, setState] = useState<Ctx["state"]>("idle");
  const [durationMs, setDurationMs] = useState(0);
  const [sampleCount, setSampleCount] = useState(0);

  // Feed the live signal stream into the recorder (synchronized to frames).
  useEffect(() => {
    if (recorder.current.state === "recording") {
      recorder.current.addSample(signals);
      setSampleCount(recorder.current.count());
    }
  }, [signals]);

  // Tick for the duration display.
  useEffect(() => {
    if (state !== "recording") return;
    const id = setInterval(() => setDurationMs(recorder.current.elapsedMs()), 400);
    return () => clearInterval(id);
  }, [state]);

  const start = useCallback(() => {
    recorder.current.start();
    setState("recording");
    setDurationMs(0);
    setSampleCount(0);
  }, []);
  const pause = useCallback(() => {
    recorder.current.pause();
    setState("paused");
  }, []);
  const resume = useCallback(() => {
    recorder.current.resume();
    setState("recording");
  }, []);
  const cancel = useCallback(() => {
    recorder.current = new Recorder();
    setState("idle");
    setDurationMs(0);
    setSampleCount(0);
  }, []);

  const stopAndSave = useCallback(
    async (opts: { name: string; notes?: string; driverNotes?: string; tags?: string[] }) => {
      const hasMisfire = dtcs.some((d) => d.code.startsWith("P03"));
      const rec = recorder.current.finalize(opts.name, hasMisfire);
      setState("idle");
      const health = overallHealth(computeSubsystems({ signals, dtcs, identity, phase: "cruise", connected: true }));
      let vehicleId: string | undefined;
      try {
        if (identity?.vin) {
          const v = await api.upsertVehicleByVin({ vin: identity.vin, spec: identity });
          vehicleId = v?.id;
        }
      } catch {}
      try {
        const res = await api.createRecording({
          vehicle_id: vehicleId,
          vin: identity?.vin || "",
          name: rec.name,
          notes: opts.notes || "",
          driver_notes: opts.driverNotes || "",
          tags: opts.tags || [],
          duration: rec.duration,
          distance: rec.distance,
          health_score: health,
          summary: rec.summary,
          events: rec.events,
          samples: rec.samples,
        });
        cancel();
        return res?.id ?? null;
      } catch {
        return null;
      }
    },
    [signals, dtcs, identity, cancel]
  );

  return (
    <RecordingContext.Provider value={{ state, durationMs, sampleCount, start, pause, resume, stopAndSave, cancel }}>
      {children}
    </RecordingContext.Provider>
  );
}

export const useRecording = () => useContext(RecordingContext);
