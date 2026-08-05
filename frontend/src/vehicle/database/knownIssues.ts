// Vehicle knowledge base — common failure patterns per platform. Surfaced in
// the Vehicle Profile UI and injected into JARVIS's diagnostic context so AI
// recommendations are tuned to the exact vehicle. Additive intelligence only —
// does NOT touch the BLE transport or diagnostics engine.

export interface KnownIssue {
  title: string;
  symptoms: string;
  relatedCodes: string[];
  likelihood: "high" | "medium" | "low";
}

type Table = Record<string, KnownIssue[]>;

// Keyed by make; model-specific entries refine via getKnownIssues().
const BY_MAKE: Table = {
  JEEP: [
    { title: "Death wobble (front-end)", symptoms: "Violent steering shake after hitting a bump ~45-60 mph", relatedCodes: [], likelihood: "high" },
    { title: "Oil cooler / filter housing leak", symptoms: "Oil around the valley, coolant mixing, drips", relatedCodes: ["P0128"], likelihood: "high" },
    { title: "TIPM / electrical gremlins", symptoms: "Random no-start, fuel pump relay, stalling", relatedCodes: [], likelihood: "medium" },
    { title: "Rough idle / misfire", symptoms: "Shaking at idle, MIL flashing", relatedCodes: ["P0300", "P0301"], likelihood: "medium" },
  ],
  FORD: [
    { title: "Cam phaser rattle (5.4/3.5 EB)", symptoms: "Cold-start rattle from front of engine", relatedCodes: ["P0016", "P000A"], likelihood: "high" },
    { title: "Spark plug / coil failure", symptoms: "Misfire under load, rough idle", relatedCodes: ["P0300", "P0302"], likelihood: "medium" },
    { title: "Lean condition / PCV", symptoms: "Elevated fuel trims, lean codes", relatedCodes: ["P0171", "P0174"], likelihood: "medium" },
  ],
  CHEVROLET: [
    { title: "AFM lifter failure", symptoms: "Tick/knock, misfire on one cylinder", relatedCodes: ["P0300", "P0301"], likelihood: "high" },
    { title: "Intake gasket / vacuum leak", symptoms: "Lean trims, rough idle", relatedCodes: ["P0171", "P0174"], likelihood: "medium" },
  ],
  HONDA: [
    { title: "VTC actuator rattle", symptoms: "Cold-start grinding for 1-2s", relatedCodes: [], likelihood: "medium" },
    { title: "Misfire / ignition", symptoms: "Rough idle, MIL", relatedCodes: ["P0300", "P0301"], likelihood: "medium" },
  ],
  TOYOTA: [
    { title: "Oil consumption (2AZ-FE)", symptoms: "Burning oil, low level between changes", relatedCodes: [], likelihood: "medium" },
    { title: "EVAP leak", symptoms: "MIL, failed emissions", relatedCodes: ["P0456", "P0442"], likelihood: "medium" },
  ],
  BMW: [
    { title: "Valve cover / oil filter housing leak", symptoms: "Burning smell, oil on exhaust", relatedCodes: [], likelihood: "high" },
    { title: "VANOS / timing", symptoms: "Rough running, reduced power", relatedCodes: ["P0011", "P0014"], likelihood: "medium" },
    { title: "Charging / IBS sensor", symptoms: "Battery warnings, undercharge", relatedCodes: [], likelihood: "medium" },
  ],
};

const GENERIC: KnownIssue[] = [
  { title: "Misfire", symptoms: "Rough idle, hesitation, MIL", relatedCodes: ["P0300"], likelihood: "medium" },
  { title: "Vacuum leak / lean", symptoms: "High fuel trims, unstable idle", relatedCodes: ["P0171"], likelihood: "medium" },
  { title: "EVAP leak", symptoms: "MIL, fuel smell", relatedCodes: ["P0456", "P0442"], likelihood: "low" },
];

export function getKnownIssues(make?: string, _model?: string): KnownIssue[] {
  const key = (make || "").toUpperCase();
  return BY_MAKE[key] || GENERIC;
}
