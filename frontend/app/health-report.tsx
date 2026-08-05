import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { maintenanceService } from "@/src/vehicle/maintenance/maintenanceService";
import { exportHealthReportPDF } from "@/src/vehicle/performance/export";
import { colors, font, radius, spacing } from "@/src/theme";

export default function HealthReportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    maintenanceService.getHealthReport(id).then((r) => setReport(r?.report ? r : null)).catch(() => {}).finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const generate = async () => {
    if (!id) return;
    setGenerating(true);
    try {
      const r = await maintenanceService.createHealthReport(id);
      setReport(r);
    } catch { Alert.alert("Health Report", "Could not generate the report right now."); }
    setGenerating(false);
  };

  const exportPdf = async () => {
    if (!report?.report) return;
    setExporting(true);
    try {
      const msg = await exportHealthReportPDF({
        vehicle: report.vehicle || "Vehicle",
        mileage: report.mileage,
        healthScore: report.health_score,
        report: report.report,
        createdAt: report.created_at,
      });
      if (msg) Alert.alert("Export", msg);
    } catch { Alert.alert("Export", "Could not export the report."); }
    setExporting(false);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="hr-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>AI HEALTH REPORT</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
      ) : !report ? (
        <View style={styles.empty} testID="hr-empty">
          <MaterialCommunityIcons name="clipboard-pulse" size={54} color={colors.onSurfaceSecondary} />
          <Text style={styles.emptyTitle}>No report generated yet</Text>
          <Text style={styles.emptyText}>JARVIS will analyze this vehicle's full history — diagnostics, recordings, repairs, trends and predictions — into one professional report.</Text>
          <Pressable testID="btn-generate" style={styles.genBtn} onPress={generate} disabled={generating}>
            <LinearGradient colors={[colors.brand, colors.brandSecondary]} style={styles.genGrad}>
              {generating ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                <><MaterialCommunityIcons name="robot" size={20} color={colors.onBrandPrimary} /><Text style={styles.genText}>GENERATE REPORT</Text></>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 90 }} showsVerticalScrollIndicator={false}>
          <View style={styles.metaCard}>
            <Text style={styles.metaVehicle}>{report.vehicle}</Text>
            <Text style={styles.metaLine}>
              {report.mileage != null ? `${Number(report.mileage).toLocaleString()} km · ` : ""}
              {report.health_score != null ? `Health ${report.health_score} · ` : ""}
              {report.created_at ? new Date(report.created_at).toLocaleString() : ""}
            </Text>
          </View>

          <View style={styles.reportCard} testID="hr-content">
            {String(report.report).split(/\n+/).filter(Boolean).map((line: string, i: number) => {
              const m = line.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
              if (m) {
                return (
                  <View key={i} style={{ marginTop: i === 0 ? 0 : spacing.md }}>
                    <Text style={styles.hLabel}>{m[1]}</Text>
                    {m[2] ? <Text style={styles.body}>{m[2]}</Text> : null}
                  </View>
                );
              }
              return <Text key={i} style={styles.body}>{line.replace(/\*\*/g, "")}</Text>;
            })}
          </View>
        </ScrollView>
      )}

      {report && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Pressable testID="hr-regenerate" style={styles.regenBtn} onPress={generate} disabled={generating}>
            {generating ? <ActivityIndicator color={colors.brand} /> : (
              <><MaterialCommunityIcons name="refresh" size={18} color={colors.brand} /><Text style={styles.regenText}>Regenerate</Text></>
            )}
          </Pressable>
          <Pressable testID="hr-export" style={styles.exportBtn} onPress={exportPdf} disabled={exporting}>
            <LinearGradient colors={[colors.brand, colors.brandSecondary]} style={styles.exportGrad}>
              {exporting ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                <><MaterialCommunityIcons name="file-pdf-box" size={18} color={colors.onBrandPrimary} /><Text style={styles.exportText}>EXPORT PDF</Text></>
              )}
            </LinearGradient>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1.2 },
  empty: { alignItems: "center", paddingHorizontal: spacing.xl, paddingTop: spacing["3xl"], gap: spacing.md },
  emptyTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  emptyText: { color: colors.onSurfaceSecondary, fontSize: 14, textAlign: "center", lineHeight: 20 },
  genBtn: { borderRadius: radius.md, overflow: "hidden", marginTop: spacing.md, width: "100%" },
  genGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: 16 },
  genText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 1 },
  metaCard: { backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.lg, marginBottom: spacing.md },
  metaVehicle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  metaLine: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  reportCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  hLabel: { color: colors.brand, fontFamily: font.display, fontSize: 15, letterSpacing: 0.5, marginBottom: 4 },
  body: { color: colors.onSurfaceTertiary, fontSize: 14, lineHeight: 21, marginBottom: 4 },
  footer: { flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface, position: "absolute", left: 0, right: 0, bottom: 0 },
  regenBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, flex: 1, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: 14 },
  regenText: { color: colors.brand, fontWeight: "700" },
  exportBtn: { flex: 1.4, borderRadius: radius.md, overflow: "hidden" },
  exportGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15 },
  exportText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 1 },
});
