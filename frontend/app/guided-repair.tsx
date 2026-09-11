import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAI } from "@/src/ai/aiContext";
import { useVehicle } from "@/src/vehicle/service";
import AIEngineBadge from "@/src/components/AIEngineBadge";
import Dropdown from "@/src/components/Dropdown";
import { colors, font, radius, spacing } from "@/src/theme";

export default function GuidedRepair() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const ai = useAI();
  const { identity, dtcs, dataSource } = useVehicle();
  const params = useLocalSearchParams<{ code?: string; desc?: string }>();
  const code = (params.code as string) || (dtcs[0]?.code ?? "");
  const desc = (params.desc as string) || (dtcs.find((d) => d.code === code)?.desc ?? "");

  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [category, setCategory] = useState("");
  const [system, setSystem] = useState("");
  const [difficulty, setDifficulty] = useState("");

  const vehicleLabel = identity ? `${identity.year || ""} ${identity.make || ""} ${identity.model || ""}`.trim() : "";

  const run = async () => {
    setLoading(true);
    setErr("");
    const focus = code
      ? `Trouble code: ${code} (${desc || "no description"}).`
      : `No trouble code selected. Repair category: ${category || "general"}. ` +
        `System/subsystem: ${system || "unspecified"}. Target difficulty: ${difficulty || "any"}.`;
    const prompt =
      `You are VEYTRIC — AI Vehicle Intelligence providing GENERAL repair guidance for a home mechanic with little experience. ` +
      `${focus} Vehicle: ${vehicleLabel || "unknown vehicle"}. ` +
      `Return clearly labeled plain-language sections with bold headers: Problem Summary; Why It Matters; Possible Causes (bulleted); ` +
      `Diagnostic Checks (numbered); Required Tools; Possible Parts; Safety Warnings; Difficulty (1-5) and Estimated Time; ` +
      `Step-by-Step Repair (numbered); Verification Steps; Post-Repair Scan & Clear-Codes note; When To See A Professional. ` +
      `CRITICAL: Do NOT invent vehicle-specific torque values, part numbers, fluid capacities, or measurements. ` +
      `If a vehicle-specific spec is required, say "Look up the exact spec for your ${vehicleLabel || "vehicle"} in the service manual — I won't guess." ` +
      `Never claim a repair is guaranteed to fix the problem. Be concise.`;
    try {
      const res = await ai.analyze(prompt);
      if (!res.ok || !res.text) throw new Error(res.error || "AI guidance unavailable");
      setText(res.text);
    } catch (e: any) {
      setErr(e?.message || "AI guidance unavailable");
    }
    setLoading(false);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="gr-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>GUIDED REPAIR</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }}>
        {/* Source-labeled context */}
        <View style={styles.ctx}>
          <Row tag="ECU DATA" tagColor={colors.error} label="Trouble code" value={code ? `${code}${desc ? ` — ${desc}` : ""}` : "Not specified"} />
          <Row
            tag={dataSource === "REAL_BLE" ? "REAL VEHICLE DATA" : dataSource === "SIMULATION" ? "SIMULATED" : "UNAVAILABLE"}
            tagColor={dataSource === "REAL_BLE" ? colors.success : dataSource === "SIMULATION" ? colors.warning : colors.onSurfaceSecondary}
            label="Vehicle"
            value={vehicleLabel || "Unknown — connect & decode VIN"}
          />
        </View>

        {!code ? (
          <View style={styles.filters}>
            <Text style={styles.filtersTitle}>NO CODE SELECTED — CHOOSE A FOCUS</Text>
            <Dropdown
              testID="gr-category"
              label="Repair category"
              options={[
                "Engine & Performance", "Cooling System", "Fuel System", "Ignition",
                "Emissions", "Transmission", "Brakes", "Electrical & Battery",
                "Suspension & Steering", "HVAC / Climate", "Maintenance & Fluids",
              ]}
              value={category || null}
              clearable
              onChange={setCategory}
              onClear={() => setCategory("")}
            />
            <View style={{ height: spacing.md }} />
            <Dropdown
              testID="gr-system"
              label="System / subsystem (optional)"
              options={[
                "Spark plugs & coils", "Sensors (O2 / MAF / MAP)", "Thermostat & radiator",
                "Fuel pump & injectors", "Serpentine belt", "Battery & alternator",
                "Brake pads & rotors", "Exhaust & catalytic converter", "Filters (air/cabin/oil)",
              ]}
              value={system || null}
              clearable
              onChange={setSystem}
              onClear={() => setSystem("")}
            />
            <View style={{ height: spacing.md }} />
            <Dropdown
              testID="gr-difficulty"
              label="Difficulty"
              searchable={false}
              options={[
                { label: "Beginner (1-2)", value: "beginner" },
                { label: "Intermediate (3)", value: "intermediate" },
                { label: "Advanced (4-5)", value: "advanced" },
              ]}
              value={difficulty || null}
              clearable
              onChange={setDifficulty}
              onClear={() => setDifficulty("")}
            />
          </View>
        ) : null}

        {!text && !loading ? (
          <Pressable testID="gr-start" style={styles.startBtn} onPress={run}>
            <MaterialCommunityIcons name="tools" size={18} color={colors.onBrandPrimary} />
            <Text style={styles.startText}>Start Guided Repair</Text>
          </Pressable>
        ) : null}

        {loading ? (
          <View style={styles.loading}><ActivityIndicator color={colors.brand} /><Text style={styles.loadingText}>Preparing guidance…</Text></View>
        ) : null}

        {err ? (
          <Pressable style={styles.errCard} onPress={run} testID="gr-retry">
            <MaterialCommunityIcons name="refresh" size={18} color={colors.error} />
            <Text style={styles.errText}>{err} — tap to retry</Text>
          </Pressable>
        ) : null}

        {text ? (
          <>
            <View style={styles.aiHead}>
              <View style={styles.aiTag}><Text style={styles.aiTagText}>AI ANALYSIS · GENERAL GUIDANCE</Text></View>
              <AIEngineBadge />
            </View>
            <Text style={styles.body}>{text}</Text>
            <View style={styles.disclaimer}>
              <MaterialCommunityIcons name="shield-alert" size={16} color={colors.warning} />
              <Text style={styles.disclaimerText}>
                This is AI-generated general guidance — not vehicle-specific instructions. Always verify exact procedures,
                torque values and part numbers against the manufacturer service manual for your{vehicleLabel ? ` ${vehicleLabel}` : " vehicle"}.
                VEYTRIC never guarantees a repair will resolve the fault. If unsure, consult a qualified technician.
              </Text>
            </View>
            <Pressable testID="gr-recheck" style={styles.recheck} onPress={() => router.push("/codes")}>
              <Text style={styles.recheckText}>POST-REPAIR: OPEN CODES TO RE-SCAN</Text>
            </Pressable>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row({ tag, tagColor, label, value }: { tag: string; tagColor: string; label: string; value: string }) {
  return (
    <View style={styles.row}>
      <View style={[styles.rowTag, { borderColor: tagColor }]}><Text style={[styles.rowTagText, { color: tagColor }]}>{tag}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1.2 },
  ctx: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  filters: { marginTop: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  filtersTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 1, fontWeight: "700", marginBottom: spacing.md },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  rowTag: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  rowTagText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  rowLabel: { color: colors.onSurfaceSecondary, fontSize: 11 },
  rowValue: { color: colors.onSurface, fontSize: 14, fontWeight: "600" },
  startBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 14, marginTop: spacing.lg },
  startText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 1 },
  loading: { alignItems: "center", gap: spacing.sm, marginTop: spacing.xl },
  loadingText: { color: colors.onSurfaceSecondary },
  errCard: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.error + "18" },
  errText: { color: colors.error, flex: 1, fontWeight: "600" },
  aiHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.lg, marginBottom: spacing.sm },
  aiTag: { backgroundColor: colors.brandTertiary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3 },
  aiTagText: { color: colors.brand, fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  body: { color: colors.onSurface, fontSize: 14, lineHeight: 22 },
  disclaimer: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.warning + "18", borderRadius: radius.md, padding: spacing.md, marginTop: spacing.lg },
  disclaimerText: { flex: 1, color: colors.onSurface, fontSize: 12, lineHeight: 18 },
  recheck: { marginTop: spacing.lg, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: 12, alignItems: "center" },
  recheckText: { color: colors.brand, fontWeight: "700", letterSpacing: 1, fontSize: 12 },
});
