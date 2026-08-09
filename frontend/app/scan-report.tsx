import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { scanService } from "@/src/vehicle/diagnostics/scanWorkflow";
import { exportScanPDF } from "@/src/vehicle/performance/export";
import AIEngineBadge from "@/src/components/AIEngineBadge";
import { colors, font, radius, spacing } from "@/src/theme";

const scoreColor = (s: number) => (s >= 80 ? colors.success : s >= 60 ? colors.warning : colors.error);
const lvlColor = (l: string) => (l === "good" ? colors.success : l === "warn" ? colors.warning : colors.error);
const monColor = (s: string) => (s === "ready" ? colors.success : s === "not_ready" ? colors.warning : colors.onSurfaceSecondary);

export default function ScanReportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [scan, setScan] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [aiError, setAiError] = useState("");

  const analyze = useCallback(async (sid: string) => {
    setAnalyzing(true);
    setAiError("");
    try {
      const res: any = await scanService.analyze(sid);
      setScan((prev: any) => (prev ? { ...prev, ai_report: res.ai_report } : prev));
    } catch (e: any) {
      setAiError(e?.message || "AI analysis failed");
    }
    setAnalyzing(false);
  }, []);

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    scanService.get(id).then((s: any) => {
      setScan(s);
      if (s && !s.ai_report) analyze(id);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [id, analyze]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const exportPdf = async () => {
    if (!scan) return;
    setExporting(true);
    try { const msg = await exportScanPDF(scan); if (msg) Alert.alert("Export", msg); }
    catch { Alert.alert("Export", "Could not export the report."); }
    setExporting(false);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>;
  if (!scan) return <View style={styles.center}><Text style={styles.dim}>Scan not found</Text></View>;

  const score = scan.overall_score ?? 0;
  const dtcs = scan.dtcs || [];
  const modules = scan.modules || [];
  const readiness = scan.readiness || [];
  const systems = scan.systems || [];
  const metrics = scan.metrics || {};

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="report-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{scan.title}</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 90 }} showsVerticalScrollIndicator={false}>
        {/* Score hero */}
        <View style={styles.hero} testID="scan-score">
          <View style={[styles.ring, { borderColor: scoreColor(score) }]}>
            <Text style={[styles.ringScore, { color: scoreColor(score) }]}>{score}</Text>
            <Text style={styles.ringLabel}>SCORE</Text>
          </View>
          <Text style={styles.heroVeh}>{scan.vehicle}</Text>
          <Text style={styles.heroMeta}>{scan.created_at ? new Date(scan.created_at).toLocaleString() : ""}</Text>
        </View>

        {modules.length > 0 && (
          <Section title={`MODULES (${modules.length})`}>
            <View style={styles.chipWrap}>
              {modules.map((m: any) => (
                <View key={m.key} style={[styles.modChip, { borderColor: m.status === "online" ? colors.success : colors.onSurfaceSecondary }]}>
                  <View style={[styles.dot, { backgroundColor: m.status === "online" ? colors.success : colors.onSurfaceSecondary }]} />
                  <Text style={styles.modChipText}>{m.short}{m.dtcCount ? ` · ${m.dtcCount}` : ""}</Text>
                </View>
              ))}
            </View>
          </Section>
        )}

        {dtcs.length > 0 && (
          <Section title={`FAULT CODES (${dtcs.length})`}>
            {dtcs.map((d: any) => (
              <View key={d.code} style={styles.dtcRow}>
                <Text style={styles.dtcCode}>{d.code}</Text>
                <Text style={styles.dtcDesc}>{d.desc}</Text>
                <Text style={styles.dtcType}>{d.type}</Text>
              </View>
            ))}
          </Section>
        )}

        {readiness.length > 0 && (
          <Section title="READINESS MONITORS">
            {readiness.map((mo: any) => (
              <View key={mo.key} style={styles.monRow}>
                <Text style={styles.monName}>{mo.name}</Text>
                <Text style={[styles.monText, { color: monColor(mo.status) }]}>{mo.status === "ready" ? "READY" : mo.status === "not_ready" ? "NOT READY" : "N/A"}</Text>
              </View>
            ))}
          </Section>
        )}

        {systems.length > 0 && (
          <Section title="SYSTEM HEALTH">
            {systems.map((s: any) => (
              <View key={s.key} style={styles.sysRow}>
                <View style={[styles.dot, { backgroundColor: lvlColor(s.level) }]} />
                <Text style={styles.sysName}>{s.name}</Text>
                <Text style={styles.sysNote} numberOfLines={1}>{s.note}</Text>
              </View>
            ))}
          </Section>
        )}

        {typeof metrics.dataQuality === "number" && (
          <Section title="DATA QUALITY">
            <View style={styles.qRow}>
              <Text style={styles.qLabel}>Overall data quality</Text>
              <Text style={[styles.qVal, { color: scoreColor(metrics.dataQuality) }]}>{metrics.dataQuality}%</Text>
            </View>
            <Text style={styles.qSub}>Comm {String(metrics.commQuality || "").toUpperCase()} · {metrics.supportedPidCount} PIDs · retry {Math.round((metrics.retryRate || 0) * 100)}%</Text>
          </Section>
        )}

        <Section title="AI ANALYSIS" badge>
          {scan.ai_report ? (
            <View testID="scan-ai">
              {String(scan.ai_report).split(/\n+/).filter(Boolean).map((line: string, i: number) => {
                const m = line.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
                if (m) return (
                  <View key={i} style={{ marginTop: i === 0 ? 0 : spacing.sm }}>
                    <Text style={styles.aiLabel}>{m[1]}</Text>
                    {m[2] ? <Text style={styles.aiBody}>{m[2]}</Text> : null}
                  </View>
                );
                return <Text key={i} style={styles.aiBody}>{line.replace(/\*\*/g, "")}</Text>;
              })}
            </View>
          ) : analyzing ? (
            <View style={styles.aiPending} testID="scan-ai-loading">
              <ActivityIndicator color={colors.brand} />
              <Text style={styles.aiPendingText}>Generating AI analysis…</Text>
            </View>
          ) : (
            <Pressable style={styles.aiRetry} testID="scan-ai-retry" onPress={() => id && analyze(id)}>
              <MaterialCommunityIcons name="refresh" size={18} color={colors.brand} />
              <Text style={styles.aiRetryText}>{aiError ? `${aiError} — tap to retry` : "Generate AI analysis"}</Text>
            </Pressable>
          )}
        </Section>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Pressable testID="report-export" style={styles.exportBtn} onPress={exportPdf} disabled={exporting}>
          <LinearGradient colors={[colors.brand, colors.brandSecondary]} style={styles.exportGrad}>
            {exporting ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
              <><MaterialCommunityIcons name="file-pdf-box" size={18} color={colors.onBrandPrimary} /><Text style={styles.exportText}>EXPORT PDF REPORT</Text></>
            )}
          </LinearGradient>
        </Pressable>
      </View>
    </View>
  );
}

function Section({ title, children, badge }: { title: string; children: React.ReactNode; badge?: boolean }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {badge ? <AIEngineBadge /> : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  dim: { color: colors.onSurfaceSecondary },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { flex: 1, color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1, textAlign: "center", marginHorizontal: spacing.sm },
  hero: { alignItems: "center", gap: 4, marginBottom: spacing.md },
  ring: { width: 108, height: 108, borderRadius: 54, borderWidth: 4, alignItems: "center", justifyContent: "center" },
  ringScore: { fontFamily: font.display, fontSize: 40 },
  ringLabel: { color: colors.onSurfaceSecondary, fontSize: 9, letterSpacing: 2 },
  heroVeh: { color: colors.onSurface, fontFamily: font.display, fontSize: 18, marginTop: spacing.sm },
  heroMeta: { color: colors.onSurfaceSecondary, fontSize: 12 },
  section: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.sm },
  sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 1.5, fontWeight: "700" },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  modChip: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  modChipText: { color: colors.onSurface, fontSize: 11, fontWeight: "600" },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dtcRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.divider },
  dtcCode: { color: colors.error, fontFamily: font.display, fontSize: 14, width: 64 },
  dtcDesc: { flex: 1, color: colors.onSurfaceTertiary, fontSize: 13 },
  dtcType: { color: colors.onSurfaceSecondary, fontSize: 10, textTransform: "uppercase" },
  monRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: colors.divider },
  monName: { color: colors.onSurface, fontSize: 13 },
  monText: { fontSize: 11, fontWeight: "700" },
  sysRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 7 },
  sysName: { color: colors.onSurface, fontSize: 14, width: 110 },
  sysNote: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 12 },
  qRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  qLabel: { color: colors.onSurface, fontSize: 14 },
  qVal: { fontFamily: font.display, fontSize: 22 },
  qSub: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 4 },
  aiLabel: { color: colors.brand, fontFamily: font.display, fontSize: 15, marginBottom: 3 },
  aiBody: { color: colors.onSurfaceTertiary, fontSize: 14, lineHeight: 21, marginBottom: 4 },
  aiPending: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  aiPendingText: { color: colors.onSurfaceSecondary, fontSize: 14 },
  aiRetry: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.sm, paddingVertical: 12, backgroundColor: colors.brandTertiary },
  aiRetryText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, backgroundColor: colors.surface },
  exportBtn: { borderRadius: radius.md, overflow: "hidden" },
  exportGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15 },
  exportText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 1 },
});
