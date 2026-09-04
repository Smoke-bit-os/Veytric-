import { FeatureDef, Tier } from "./licenseTypes";
import { TIER_RANK } from "./licenseConstants";

// ============================================================================
//  Feature Registry — the ONE data-driven source mapping features to tiers.
//  Screens NEVER hard-code tier checks; they call useEntitlement(key) which
//  reads this registry. Move a feature between tiers by editing one line here.
// ============================================================================

export const FEATURES: FeatureDef[] = [
  // ---- Free ----
  { key: "vehicle_connection", label: "Vehicle Connection", description: "Connect to your OBD-II adapter (simulation or Bluetooth).", tier: "free", category: "Connection" },
  { key: "live_data", label: "Live Data", description: "Real-time OBD-II sensor dashboard and gauges.", tier: "free", category: "Diagnostics" },
  { key: "read_dtc", label: "Read Trouble Codes", description: "Read generic OBD-II diagnostic trouble codes.", tier: "free", category: "Diagnostics" },
  { key: "clear_dtc", label: "Clear Trouble Codes", description: "Clear generic OBD-II codes and reset the MIL.", tier: "free", category: "Diagnostics" },
  { key: "vin_decode", label: "VIN Decode", description: "Decode your VIN into make, model, year and specs.", tier: "free", category: "Garage" },
  { key: "basic_garage", label: "Garage", description: "Save and manage a vehicle in your garage.", tier: "free", category: "Garage" },
  { key: "basic_vehicle_profile", label: "Vehicle Profile", description: "View basic vehicle specs and details.", tier: "free", category: "Garage" },
  { key: "connection_diagnostics", label: "Connection Diagnostics", description: "Inspect adapter link quality and protocol.", tier: "free", category: "Connection" },
  { key: "basic_scan_history", label: "Scan History", description: "Keep a history of your basic scans.", tier: "free", category: "Diagnostics" },
  { key: "basic_health_score", label: "Health Score", description: "See an overall vehicle health score.", tier: "free", category: "Diagnostics" },
  { key: "basic_scan_report", label: "Basic Scan Report", description: "Generate a basic diagnostic report.", tier: "free", category: "Reports" },
  { key: "settings", label: "Settings", description: "App settings and preferences.", tier: "free", category: "System" },

  // ---- Pro ----
  { key: "unlimited_vehicles", label: "Unlimited Vehicles", description: "Save an unlimited number of vehicles.", tier: "pro", category: "Garage" },
  { key: "ai_diagnostics", label: "AI Diagnostics", description: "VEYTRIC AI assistant for live diagnostic reasoning.", tier: "pro", category: "AI" },
  { key: "guided_repairs", label: "Guided Repairs", description: "Step-by-step AI-guided repair walkthroughs.", tier: "pro", category: "AI" },
  { key: "advanced_scan", label: "Advanced Scan", description: "Full multi-workflow ECU scans with AI reports.", tier: "pro", category: "Diagnostics" },
  { key: "ecu_modules", label: "ECU Intelligence", description: "Discover ECU modules with health and comm metrics.", tier: "pro", category: "Diagnostics" },
  { key: "live_system_monitor", label: "Live System Monitor", description: "Per-system live monitoring with AI interpretation.", tier: "pro", category: "Diagnostics" },
  { key: "ai_health_report", label: "AI Health Report", description: "Comprehensive AI-generated vehicle health report.", tier: "pro", category: "AI" },
  { key: "predictive_maintenance", label: "Predictive Maintenance", description: "Predicted service intervals with remaining life.", tier: "pro", category: "Maintenance" },
  { key: "trend_analysis", label: "Trend Analysis", description: "Long-term telemetry trend detection with AI insight.", tier: "pro", category: "Maintenance" },
  { key: "performance_recorder", label: "Performance Recorder", description: "Record live driving sessions with telemetry.", tier: "pro", category: "Performance" },
  { key: "playback", label: "Session Playback", description: "Scrubbable playback of recorded sessions.", tier: "pro", category: "Performance" },
  { key: "compare_sessions", label: "Compare Sessions", description: "Overlay and compare recorded sessions.", tier: "pro", category: "Performance" },
  { key: "timeline", label: "Vehicle Timeline", description: "Unified chronological history of your vehicle.", tier: "pro", category: "Maintenance" },
  { key: "repair_history", label: "Repair History", description: "Log repairs with parts, labor and cost.", tier: "pro", category: "Maintenance" },
  { key: "unlimited_exports", label: "Unlimited Exports", description: "Export unlimited PDF / CSV / JSON reports.", tier: "pro", category: "Reports" },
  { key: "advanced_dashboards", label: "Advanced Dashboards", description: "Customizable advanced dashboards.", tier: "pro", category: "System" },
  { key: "cloud_backup", label: "Cloud Backup", description: "Back up your garage to the cloud (coming soon).", tier: "pro", category: "System" },

  // ---- Shop ----
  { key: "unlimited_customer_vehicles", label: "Unlimited Customer Vehicles", description: "Manage unlimited customer vehicles.", tier: "shop", category: "Shop" },
  { key: "multi_technician", label: "Multi-Technician", description: "Multiple technician accounts.", tier: "shop", category: "Shop" },
  { key: "fleet_management", label: "Fleet Management", description: "Manage and monitor entire fleets.", tier: "shop", category: "Shop" },
  { key: "customer_database", label: "Customer Database", description: "Store and manage customer records.", tier: "shop", category: "Shop" },
  { key: "shop_branding", label: "Shop Branding", description: "Add your shop branding to reports.", tier: "shop", category: "Shop" },
  { key: "professional_inspection_reports", label: "Inspection Reports", description: "Professional multi-point inspection reports.", tier: "shop", category: "Reports" },
  { key: "team_cloud_sync", label: "Team Cloud Sync", description: "Sync data across your whole team (coming soon).", tier: "shop", category: "Shop" },
  { key: "higher_limits", label: "Higher Usage Limits", description: "Elevated usage limits for shops.", tier: "shop", category: "Shop" },
];

export const FEATURE_MAP: Record<string, FeatureDef> = Object.fromEntries(
  FEATURES.map((f) => [f.key, f]),
);

export function requiredTier(key: string): Tier {
  return FEATURE_MAP[key]?.tier ?? "free";
}

export function tierHasFeature(tier: Tier, key: string): boolean {
  return TIER_RANK[tier] >= TIER_RANK[requiredTier(key)];
}

// Categories ordered for the comparison table.
export const COMPARISON_CATEGORIES = [
  "Connection",
  "Diagnostics",
  "AI",
  "Garage",
  "Maintenance",
  "Performance",
  "Reports",
  "System",
  "Shop",
];
