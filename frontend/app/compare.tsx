import React, { useEffect, useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, LayoutChangeEvent, Alert } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Polyline, Rect, Line } from "react-native-svg";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { analysisService, compareSessions, CompareRow } from "@/src/vehicle/performance/analysisService";
import { colors, font, radius, spacing } from "@/src/theme";

const OVERLAY_SIGNALS = [
  { key: "speed", label: "Speed" },
  { key: "rpm", label: "RPM" },
  { key: "throttle", label: "Throttle" },
  { key: "coolantTemp", label: "Coolant" },
];
const A_COLOR = colors.brand;
const B_COLOR = colors.warning;

function resample(samples: any[], key: string, points = 120): number[] {
  const vals = (samples || []).map((s) => Number(s[key] ?? 0));
  if (vals.length <= points) return vals;
  const step = vals.length / points;
  const out: number[] = [];
  for (let i = 0; i < points; i++) out.push(vals[Math.floor(i * step)]);
  return out;
}

export default function CompareScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { a, b } = useLocalSearchParams<{ a: string; b: string }>();
  const [ra, setRa] = useState<any>(null);
  const [rb, setRb] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sig, setSig] = useState("speed");
  const [w, setW] = useState(0);
  const [aiSummary, setAiSummary] = useState("");
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (!a || !b) return;
    Promise.all([analysisService.get(a), analysisService.get(b)])
      .then(([x, y]) => { setRa(x); setRb(y); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [a, b]);

  const rows: CompareRow[] = useMemo(() => (ra && rb ? compareSessions(ra, rb) : []), [ra, rb]);
  const highlights = rows.filter((r) => r.significant);

  const seriesA = useMemo(() => resample(ra?.samples || [], sig), [ra, sig]);
  const seriesB = useMemo(() => resample(rb?.samples || [], sig), [rb, sig]);

  const runAI = async () => {
    if (!b) return;
    setAnalyzing(true);
    try {
      const res = await analysisService.analyze(b);
      setAiSummary(res?.analysis || "");
    } catch { Alert.alert("AI", "Comparison analysis is unavailable right now."); }
    setAnalyzing(false);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>;
  if (!ra || !rb) return <View style={styles.center}><Text style={styles.dim}>Sessions not found</Text></View>;

  const h = 150, pad = 8;
  const all = [...seriesA, ...seriesB];
  const min = all.length ? Math.min(...all) : 0;
  const max = all.length ? Math.max(...all) : 1;
  const range = max - min || 1;
  const poly = (arr: number[]) => {
    const nn = arr.length;
    return arr.map((v, i) => `${nn <= 1 ? 0 : (i / (nn - 1)) * w},${pad + (h - pad * 2) - ((v - min) / range) * (h - pad * 2)}`).join(" ");
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="compare-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>COMPARE SESSIONS</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }} showsVerticalScrollIndicator={false}>
        {/* Legend */}
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.legDot, { backgroundColor: A_COLOR }]} />
            <Text style={styles.legName} numberOfLines={1}>A · {ra.name}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legDot, { backgroundColor: B_COLOR }]} />
            <Text style={styles.legName} numberOfLines={1}>B · {rb.name}</Text>
          </View>
        </View>

        {/* Graph overlay */}
        <Text style={styles.sectionTitle}>GRAPH OVERLAY</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {OVERLAY_SIGNALS.map((s) => (
            <Pressable key={s.key} testID={`overlay-${s.key}`} style={[styles.chip, sig === s.key && styles.chipActive]} onPress={() => setSig(s.key)}>
              <Text style={[styles.chipText, sig === s.key && styles.chipTextActive]}>{s.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <View style={styles.chartCard} onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width - spacing.lg * 2)} testID="overlay-chart">
          {w > 0 && (
            <Svg width={w} height={h}>
              <Rect x={0} y={0} width={w} height={h} fill={colors.surface} rx={6} />
              <Line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={colors.divider} strokeWidth={1} />
              <Polyline points={poly(seriesA)} fill="none" stroke={A_COLOR} strokeWidth={2} />
              <Polyline points={poly(seriesB)} fill="none" stroke={B_COLOR} strokeWidth={2} />
            </Svg>
          )}
        </View>

        {/* Side-by-side metrics */}
        <Text style={styles.sectionTitle}>METRICS</Text>
        <View style={styles.tableHead}>
          <Text style={[styles.th, { flex: 1.4, textAlign: "left" }]}>METRIC</Text>
          <Text style={styles.th}>A</Text>
          <Text style={styles.th}>B</Text>
          <Text style={styles.th}>Δ</Text>
        </View>
        {rows.map((r) => (
          <View key={r.metric} style={[styles.tr, r.significant && styles.trHi]} testID={`row-${r.metric.replace(/\s/g, "")}`}>
            <Text style={[styles.td, { flex: 1.4, textAlign: "left", color: colors.onSurface }]}>{r.metric}</Text>
            <Text style={styles.td}>{typeof r.a === "number" ? Math.round(r.a * 10) / 10 : r.a}</Text>
            <Text style={styles.td}>{typeof r.b === "number" ? Math.round(r.b * 10) / 10 : r.b}</Text>
            <Text style={[styles.td, { color: r.delta > 0 ? colors.success : r.delta < 0 ? colors.error : colors.onSurfaceSecondary, fontWeight: "700" }]}>
              {r.delta > 0 ? "+" : ""}{Math.round(r.delta * 10) / 10}
            </Text>
          </View>
        ))}

        {/* Automatic highlights */}
        <Text style={styles.sectionTitle}>AUTOMATIC HIGHLIGHTS</Text>
        {highlights.length === 0 ? (
          <Text style={styles.dim}>No significant differences between these sessions.</Text>
        ) : (
          highlights.map((r) => (
            <View key={r.metric} style={styles.hiRow} testID={`hi-${r.metric.replace(/\s/g, "")}`}>
              <MaterialCommunityIcons name={r.delta >= 0 ? "trending-up" : "trending-down"} size={18} color={r.delta >= 0 ? colors.success : colors.error} />
              <Text style={styles.hiText}>
                <Text style={{ fontWeight: "700", color: colors.onSurface }}>{r.metric}</Text> {r.delta >= 0 ? "increased" : "decreased"} by {Math.abs(Math.round(r.delta * 10) / 10)}{r.unit} in session B
              </Text>
            </View>
          ))
        )}

        {/* AI comparison summary */}
        <Text style={styles.sectionTitle}>AI COMPARISON SUMMARY</Text>
        {aiSummary ? (
          <View style={styles.aiCard} testID="ai-compare">
            {aiSummary.split(/\n+/).filter(Boolean).map((line, i) => {
              const m = line.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
              if (m) return <Text key={i} style={styles.aiLine}><Text style={styles.aiLabel}>{m[1]}: </Text>{m[2]}</Text>;
              return <Text key={i} style={styles.aiLine}>{line.replace(/\*\*/g, "")}</Text>;
            })}
          </View>
        ) : (
          <Pressable testID="btn-ai-compare" style={styles.analyzeBtn} onPress={runAI} disabled={analyzing}>
            {analyzing ? <ActivityIndicator color={colors.brand} /> : (
              <><MaterialCommunityIcons name="robot" size={18} color={colors.brand} /><Text style={styles.analyzeText}>Generate AI Comparison</Text></>
            )}
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  dim: { color: colors.onSurfaceSecondary, fontSize: 13 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 18, letterSpacing: 1.5 },
  legend: { gap: spacing.xs },
  legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  legDot: { width: 12, height: 4, borderRadius: 2 },
  legName: { color: colors.onSurfaceSecondary, fontSize: 13, flex: 1 },
  sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 2, fontWeight: "700", marginTop: spacing.xl, marginBottom: spacing.sm },
  chipRow: { gap: spacing.sm, paddingBottom: spacing.sm },
  chip: { paddingHorizontal: 14, height: 34, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  chipActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: colors.brand },
  chartCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  tableHead: { flexDirection: "row", paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  th: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 10, letterSpacing: 1, textAlign: "center", fontWeight: "700" },
  tr: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingVertical: 12, paddingHorizontal: spacing.md, marginBottom: spacing.xs },
  trHi: { borderColor: colors.brand },
  td: { flex: 1, color: colors.onSurfaceTertiary, fontFamily: font.display, fontSize: 15, textAlign: "center" },
  hiRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.xs },
  hiText: { flex: 1, color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19 },
  aiCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  aiLine: { color: colors.onSurfaceTertiary, fontSize: 13, lineHeight: 20, marginBottom: 6 },
  aiLabel: { color: colors.brand, fontWeight: "700" },
  analyzeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: 14, backgroundColor: colors.brandTertiary },
  analyzeText: { color: colors.brand, fontWeight: "700", fontSize: 14 },
});
