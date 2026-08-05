// Enrichment layer — combines the decoded VIN identity with the knowledge base
// to produce "Vehicle Intelligence": specs + common failure patterns + a
// compact platform summary that is injected into JARVIS's AI context.

import { VehicleIdentity } from "../types";
import { getKnownIssues, KnownIssue } from "../database/knownIssues";

export interface VehicleIntelligence {
  specs: Partial<VehicleIdentity>;
  commonIssues: KnownIssue[];
  platformSummary: string; // for AI context
}

export function buildVehicleIntelligence(identity: VehicleIdentity | null): VehicleIntelligence | null {
  if (!identity) return null;
  const commonIssues = getKnownIssues(identity.make, identity.model);
  const base = `${identity.year || ""} ${identity.make || ""} ${identity.model || ""} ${identity.trim || ""}`.trim();
  const spec = [identity.engine, identity.transmission, identity.driveType].filter(Boolean).join(" · ");
  const issues = commonIssues.map((i) => i.title).slice(0, 5).join(", ");
  const platformSummary =
    `${base}${spec ? " · " + spec : ""}${identity.vin ? " · VIN " + identity.vin : ""}. ` +
    `Known common issues for this platform: ${issues}.`;
  return { specs: identity, commonIssues, platformSummary };
}
