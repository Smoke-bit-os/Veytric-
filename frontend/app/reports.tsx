import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Share } from "react-native";
import { useRouter } from "expo-router";
import { useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useVehicle } from "@/src/vehicle/service";
import { computeSubsystems, overallHealth } from "@/src/vehicle/health";
import { api } from "@/src/api";
import { isCloudActive, runPreparedOnActive } from "@/src/ai/diagnosticAI";
import Dropdown from "@/src/components/Dropdown";
import { colors, font, radius, spacing } from "@/src/theme";

export default function Reports() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { identity, dtcs, signals } = useVehicle();
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const visibleReports = React.useMemo(() => {
    if (filter === "with") return reports.filter((r) => (r.dtcs?.length ?? 0) > 0);
    if (filter === "clean") return reports.filter((r) => (r.dtcs?.length ?? 0) === 0);
    return reports;
  }, [reports, filter]);

  const load = useCallback(() => {
    api
      .listReports()
      .then((r) => setReports(r))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const generate = async () => {
    setGenerating(true);
    try {
      const subs = computeSubsystems({ signals, dtcs, identity, phase: "cruise", connected: true });
      const payload = {
        vehicle: identity
          ? `${identity.year} ${identity.make} ${identity.model} (${identity.vin})`
          : "Unknown vehicle",
        dtcs: dtcs.map((d) => ({ code: d.code, desc: d.desc, type: d.type })),
        signals_summary: {
          rpm: Math.round(signals.rpm),
          coolantTemp: Math.round(signals.coolantTemp),
          batteryVoltage: signals.batteryVoltage.toFixed(1),
          chargingVoltage: signals.chargingVoltage.toFixed(1),
          shortFuelTrim: signals.shortFuelTrim.toFixed(1),
          longFuelTrim: signals.longFuelTrim.toFixed(1),
          engineLoad: Math.round(signals.engineLoad),
        },
        health_score: overallHealth(subs),
        mileage: identity?.odometer || null,
      };
      let report: any;
      if (await isCloudActive()) {
        report = await api.createReport(payload);
      } else {
        // BYOK / Local: fetch the prepared prompt, run on the user's engine,
        // then persist the findings back without consuming the cloud quota.
        const prep = await api.createReport(payload, true);
        const res = await runPreparedOnActive(prep);
        report = await api.createReport({
          ...payload,
          ai_findings: res.text,
          ai_provider: res.provider,
          ai_model: res.model,
        });
      }
      setReports((r) => [report, ...r]);
      setExpanded(report.id);
    } catch {}
    setGenerating(false);
  };

  const share = async (r: any) => {
    const body =
      `JARVIS Auto AI — Scan Report\n${r.vehicle}\n${new Date(r.created_at).toLocaleString()}\n` +
      `Health Score: ${r.health_score}/100\n\nTrouble Codes:\n` +
      (r.dtcs.length ? r.dtcs.map((d: any) => `• ${d.code} — ${d.desc}`).join("\n") : "None") +
      `\n\n${r.ai_findings}`;
    await Share.share({ message: body }).catch(() => {});
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="reports-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>SCAN REPORTS</Text>
        <View style={{ width: 28 }} />
      </View>

      <Pressable testID="generate-report" style={[styles.generateBtn, !identity && styles.generateBtnDisabled]} onPress={generate} disabled={generating || !identity}>
        {generating ? (
          <ActivityIndicator color={colors.onBrandPrimary} />
        ) : (
          <>
            <MaterialCommunityIcons name="file-chart" size={20} color={colors.onBrandPrimary} />
            <Text style={styles.generateText}>{identity ? "GENERATE NEW SCAN REPORT" : "CONNECT A VEHICLE FIRST"}</Text>
          </>
        )}
      </Pressable>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }}>
        {loading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
        ) : reports.length === 0 ? (
          <View style={styles.empty} testID="reports-empty">
            <MaterialCommunityIcons name="file-document-outline" size={44} color={colors.onSurfaceSecondary} />
            <Text style={styles.emptyText}>No reports yet. Generate your first scan report.</Text>
          </View>
        ) : (
          <>
            <View style={styles.filterWrap}>
              <Dropdown
                testID="reports-filter"
                label="Filter reports"
                searchable={false}
                options={[
                  { label: `All reports (${reports.length})`, value: "all" },
                  { label: "With trouble codes", value: "with" },
                  { label: "Clean (no codes)", value: "clean" },
                ]}
                value={filter}
                onChange={setFilter}
              />
            </View>
            {visibleReports.length === 0 ? (
              <View style={styles.empty} testID="reports-filter-empty">
                <MaterialCommunityIcons name="filter-remove-outline" size={40} color={colors.onSurfaceSecondary} />
                <Text style={styles.emptyText}>No reports match this filter.</Text>
              </View>
            ) : (
              visibleReports.map((r) => (
            <View key={r.id} style={styles.card} testID={`report-${r.id}`}>
              <Pressable style={styles.cardTop} onPress={() => setExpanded(expanded === r.id ? null : r.id)}>
                <View style={styles.scoreBadge}>
                  <Text style={styles.scoreNum}>{r.health_score ?? "—"}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.vehicle} numberOfLines={1}>
                  {typeof r.vehicle === "string"
                    ? r.vehicle
                    : `${r.vehicle?.year ?? ""} ${r.vehicle?.make ?? ""} ${r.vehicle?.model ?? ""}`.trim() || "Vehicle"}
                </Text>
                  <Text style={styles.date}>{new Date(r.created_at).toLocaleString()}</Text>
                  <Text style={styles.codes}>{r.dtcs.length} code{r.dtcs.length === 1 ? "" : "s"}</Text>
                </View>
                <MaterialCommunityIcons
                  name={expanded === r.id ? "chevron-up" : "chevron-down"}
                  size={22}
                  color={colors.onSurfaceSecondary}
                />
              </Pressable>

              {expanded === r.id && (
                <View style={styles.detail}>
                  {r.dtcs.map((d: any) => (
                    <Text key={d.code} style={styles.dtcLine}>
                      • {d.code} — {d.desc}
                    </Text>
                  ))}
                  <Text style={styles.findings}>{r.ai_findings}</Text>
                  <Pressable testID={`share-${r.id}`} style={styles.shareBtn} onPress={() => share(r)}>
                    <MaterialCommunityIcons name="share-variant" size={16} color={colors.brand} />
                    <Text style={styles.shareText}>Share Report</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ))
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 20, letterSpacing: 1.5 },
  generateBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: 15,
    marginHorizontal: spacing.lg,
  },
  generateText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 1 },
  generateBtnDisabled: { opacity: 0.5 },
  empty: { alignItems: "center", paddingVertical: spacing["3xl"], gap: spacing.md },
  emptyText: { color: colors.onSurfaceSecondary, textAlign: "center" },
  filterWrap: { marginBottom: spacing.lg },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    overflow: "hidden",
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  scoreBadge: {
    width: 48,
    height: 48,
    borderRadius: radius.sm,
    backgroundColor: colors.brandTertiary,
    alignItems: "center",
    justifyContent: "center",
  },
  scoreNum: { color: colors.brand, fontFamily: font.display, fontSize: 22 },
  vehicle: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  date: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 1 },
  codes: { color: colors.warning, fontSize: 12, marginTop: 1 },
  detail: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
  dtcLine: { color: colors.onSurfaceTertiary, fontSize: 13, marginBottom: 2 },
  findings: { color: colors.onSurfaceTertiary, fontSize: 14, lineHeight: 21, marginTop: spacing.sm },
  shareBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  shareText: { color: colors.brand, fontWeight: "700" },
});
