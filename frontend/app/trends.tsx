import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, LayoutChangeEvent, Alert } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Polyline, Rect, Line } from "react-native-svg";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { trendsService, TrendResult, TrendFinding } from "@/src/vehicle/trends/trendsService";
import { useEntitlement } from "@/src/licensing/LicenseProvider";
import PremiumGate from "@/src/components/PremiumGate";
import { colors, font, radius, spacing } from "@/src/theme";

const dirIcon = (d: string) => (d === "rising" ? "trending-up" : d === "declining" ? "trending-down" : d === "recurring" ? "repeat" : "trending-neutral");
const sevColor = (s: string) => (s === "warn" || s === "bad" ? colors.warning : s === "good" ? colors.success : colors.info);

function MiniChart({ values, color }: { values: number[]; color: string }) {
  const [w, setW] = useState(0);
  const h = 70, pad = 6;
  const n = values.length;
  if (n < 2) return <Text style={styles.noData}>Not enough data points</Text>;
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const pts = values.map((v, i) => `${(i / (n - 1)) * w},${pad + (h - pad * 2) - ((v - min) / range) * (h - pad * 2)}`).join(" ");
  return (
    <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={{ height: h }}>
      {w > 0 && (
        <Svg width={w} height={h}>
          <Rect x={0} y={0} width={w} height={h} fill={colors.surface} rx={6} />
          <Line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={colors.divider} strokeWidth={1} />
          <Polyline points={pts} fill="none" stroke={color} strokeWidth={2} />
        </Svg>
      )}
    </View>
  );
}

export default function TrendsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [res, setRes] = useState<TrendResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [explain, setExplain] = useState("");
  const [explaining, setExplaining] = useState(false);
  const gate = useEntitlement("trend_analysis");

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    trendsService.get(id).then(({ data, fromCache }) => { setRes(data); setOffline(fromCache); }).finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const runExplain = async () => {
    if (!id) return;
    setExplaining(true);
    try {
      const r = await trendsService.explain(id);
      setExplain(r?.explanation || "");
    } catch { Alert.alert("AI", "Trend explanation is unavailable right now."); }
    setExplaining(false);
  };

  const findings: TrendFinding[] = res?.findings || [];
  const charts: { key: keyof TrendResult["series"]; label: string; color: string }[] = [
    { key: "battery", label: "Battery Voltage (lowest per drive)", color: colors.info },
    { key: "coolant", label: "Peak Coolant Temp", color: colors.warning },
    { key: "health", label: "Health Score", color: colors.brand },
    { key: "maxSpeed", label: "Peak Speed", color: colors.success },
  ];

  if (!gate.hasAccess) return <PremiumGate feature="trend_analysis" />;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="trends-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>TREND ANALYSIS</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }} showsVerticalScrollIndicator={false}>
          {offline && <Text style={styles.offline}>⚠ Showing cached data (offline)</Text>}

          <Text style={styles.sectionTitle}>DETECTED TRENDS ({findings.length})</Text>
          {findings.length === 0 ? (
            <Text style={styles.dim}>Not enough history yet. Record more drives and run scans to build trends.</Text>
          ) : (
            findings.map((f) => (
              <View key={f.key} style={styles.finding} testID={`trend-${f.key}`}>
                <MaterialCommunityIcons name={dirIcon(f.direction) as any} size={20} color={sevColor(f.severity)} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.findingLabel}>{f.label}</Text>
                  <Text style={styles.findingSummary}>{f.summary}</Text>
                </View>
              </View>
            ))
          )}

          <Text style={styles.sectionTitle}>TREND GRAPHS</Text>
          {charts.map((c) => (
            <View key={c.key} style={styles.chartCard} testID={`trend-chart-${c.key}`}>
              <Text style={styles.chartLabel}>{c.label.toUpperCase()}</Text>
              <MiniChart values={res?.series[c.key] || []} color={c.color} />
            </View>
          ))}

          {res?.repeatedDtcs && res.repeatedDtcs.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>REPEATED FAULT CODES</Text>
              {res.repeatedDtcs.map((d) => (
                <View key={d.code} style={styles.dtcRow}>
                  <MaterialCommunityIcons name="alert-circle" size={16} color={colors.warning} />
                  <Text style={styles.dtcCode}>{d.code}</Text>
                  <Text style={styles.dtcCount}>seen {d.count}×</Text>
                </View>
              ))}
            </>
          )}

          <Text style={styles.sectionTitle}>AI EXPLANATION</Text>
          {explain ? (
            <View style={styles.aiCard} testID="trend-explanation">
              {explain.split(/\n+/).filter(Boolean).map((line, i) => {
                const m = line.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
                if (m) return <Text key={i} style={styles.aiLine}><Text style={styles.aiLabel}>{m[1]}: </Text>{m[2]}</Text>;
                return <Text key={i} style={styles.aiLine}>{line.replace(/\*\*/g, "")}</Text>;
              })}
            </View>
          ) : (
            <Pressable testID="btn-explain" style={styles.aiBtn} onPress={runExplain} disabled={explaining}>
              {explaining ? <ActivityIndicator color={colors.brand} /> : (
                <><MaterialCommunityIcons name="robot" size={18} color={colors.brand} /><Text style={styles.aiBtnText}>Explain these trends with AI</Text></>
              )}
            </Pressable>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1.2 },
  offline: { color: colors.warning, fontSize: 12, marginBottom: spacing.sm },
  dim: { color: colors.onSurfaceSecondary, fontSize: 13 },
  noData: { color: colors.onSurfaceSecondary, fontSize: 12, paddingVertical: spacing.lg, textAlign: "center" },
  sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 2, fontWeight: "700", marginTop: spacing.xl, marginBottom: spacing.sm },
  finding: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  findingLabel: { color: colors.onSurface, fontSize: 14, fontWeight: "600" },
  findingSummary: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  chartCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  chartLabel: { color: colors.onSurfaceSecondary, fontSize: 10, letterSpacing: 1, fontWeight: "700", marginBottom: spacing.sm },
  dtcRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.xs },
  dtcCode: { color: colors.onSurface, fontFamily: font.display, fontSize: 16, flex: 1 },
  dtcCount: { color: colors.onSurfaceSecondary, fontSize: 12 },
  aiCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  aiLine: { color: colors.onSurfaceTertiary, fontSize: 13, lineHeight: 20, marginBottom: 6 },
  aiLabel: { color: colors.brand, fontWeight: "700" },
  aiBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: 14, backgroundColor: colors.brandTertiary },
  aiBtnText: { color: colors.brand, fontWeight: "700", fontSize: 14 },
});
