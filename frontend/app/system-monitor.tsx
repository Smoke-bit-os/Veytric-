import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Dimensions, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LineChart } from "react-native-gifted-charts";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useVehicle } from "@/src/vehicle/service";
import { PID_CATALOG } from "@/src/vehicle/health";
import { SYSTEMS, systemStatus, interpretSystem } from "@/src/vehicle/system-monitor/systems";
import { colors, font, radius, spacing } from "@/src/theme";

const lvlColor = (l: string) => (l === "good" ? colors.success : l === "warn" ? colors.warning : colors.error);
const fmt = (v: any, d = 0) => (typeof v === "number" ? (d ? v.toFixed(d) : Math.round(v)) : v);

export default function SystemMonitorScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { system: sysParam } = useLocalSearchParams<{ system?: string }>();
  const { signals, history, dtcs, identity } = useVehicle();
  const [sel, setSel] = useState<string>(sysParam || "engine");
  const [ai, setAi] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const width = Dimensions.get("window").width;

  const sys = SYSTEMS.find((s) => s.key === sel)!;
  const meta = (k: string) => PID_CATALOG.find((p) => p.key === k)!;
  const status = useMemo(() => systemStatus(sel, signals, dtcs), [sel, signals, dtcs]);
  const chartMeta = meta(sys.chartKey);
  const chartData = (history[sys.chartKey] || []).map((v) => ({ value: v }));
  const vehName = identity ? `${identity.year} ${identity.make} ${identity.model}` : "Vehicle";

  const runAi = async () => {
    setLoading(true);
    try {
      const ctx: any = { status: status.level, note: status.note };
      sys.pids.forEach((k) => { ctx[k] = (signals as any)[k]; });
      const text = await interpretSystem(sys.name, vehName, ctx);
      setAi((p) => ({ ...p, [sel]: text }));
    } catch { Alert.alert("AI", "Interpretation unavailable right now."); }
    setLoading(false);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="sysmon-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>LIVE SYSTEM MONITOR</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.selWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.selRow}>
          {SYSTEMS.map((s) => {
            const active = sel === s.key;
            const st = systemStatus(s.key, signals, dtcs);
            return (
              <Pressable key={s.key} testID={`sys-${s.key}`} style={[styles.selChip, active && styles.selChipActive]} onPress={() => setSel(s.key)}>
                <MaterialCommunityIcons name={s.icon as any} size={16} color={active ? colors.brand : colors.onSurfaceSecondary} />
                <Text style={[styles.selText, active && styles.selTextActive]}>{s.name}</Text>
                <View style={[styles.selDot, { backgroundColor: lvlColor(st.level) }]} />
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }} showsVerticalScrollIndicator={false}>
        {/* Status banner */}
        <View style={[styles.statusCard, { borderColor: lvlColor(status.level) }]} testID="sys-status">
          <MaterialCommunityIcons name={status.level === "good" ? "check-circle" : "alert-circle"} size={22} color={lvlColor(status.level)} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.statusLabel, { color: lvlColor(status.level) }]}>{status.level.toUpperCase()}</Text>
            <Text style={styles.statusNote}>{status.note}</Text>
          </View>
        </View>

        {/* Trend chart */}
        <View style={styles.chartCard} testID="sys-chart">
          <View style={styles.chartHead}>
            <Text style={styles.chartLabel}>{chartMeta.label.toUpperCase()}</Text>
            <Text style={styles.chartVal}>{fmt((signals as any)[sys.chartKey], chartMeta.decimals)}<Text style={styles.chartUnit}> {chartMeta.unit}</Text></Text>
          </View>
          <LineChart
            data={chartData.length ? chartData : [{ value: 0 }]}
            width={width - 90} height={150} hideDataPoints curved thickness={2.5}
            color={colors.brand} startFillColor={colors.brand} endFillColor="rgba(0,229,255,0.02)"
            startOpacity={0.35} endOpacity={0} areaChart hideRules={false} rulesColor={colors.divider}
            yAxisColor="transparent" xAxisColor={colors.divider} yAxisTextStyle={{ color: colors.onSurfaceSecondary, fontSize: 9 }}
            noOfSections={4} maxValue={chartMeta.max} initialSpacing={0} adjustToWidth disableScroll
          />
        </View>

        {/* Live PIDs */}
        <Text style={styles.sectionTitle}>LIVE PARAMETERS</Text>
        {sys.pids.map((k) => {
          const pm = meta(k);
          return (
            <View key={k} style={styles.pidRow} testID={`sys-pid-${k}`}>
              <View style={[styles.liveDot]} />
              <Text style={styles.pidLabel}>{pm.label}</Text>
              <Text style={styles.pidVal}>{fmt((signals as any)[k], pm.decimals)}<Text style={styles.pidUnit}> {pm.unit}</Text></Text>
            </View>
          );
        })}

        {/* AI interpretation */}
        <Text style={styles.sectionTitle}>AI INTERPRETATION</Text>
        {ai[sel] ? (
          <View style={styles.aiCard} testID="sys-ai">
            {ai[sel].split(/\n+/).filter(Boolean).map((line, i) => {
              const m = line.match(/^\*\*(.+?)\*\*:?\s*(.*)$/);
              if (m) return <Text key={i} style={styles.aiLine}><Text style={styles.aiLabel}>{m[1]}: </Text>{m[2]}</Text>;
              return <Text key={i} style={styles.aiLine}>{line.replace(/\*\*/g, "")}</Text>;
            })}
          </View>
        ) : (
          <Pressable testID="sys-interpret" style={styles.aiBtn} onPress={runAi} disabled={loading}>
            {loading ? <ActivityIndicator color={colors.brand} /> : (
              <><MaterialCommunityIcons name="robot" size={18} color={colors.brand} /><Text style={styles.aiBtnText}>Interpret {sys.name} with AI</Text></>
            )}
          </Pressable>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1.2 },
  selWrap: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  selRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  selChip: { flexDirection: "row", alignItems: "center", gap: 6, height: 36, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  selChipActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  selText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  selTextActive: { color: colors.brand },
  selDot: { width: 7, height: 7, borderRadius: 4 },
  statusCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, padding: spacing.lg, marginBottom: spacing.md },
  statusLabel: { fontSize: 13, fontWeight: "800", letterSpacing: 1 },
  statusNote: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 2 },
  chartCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  chartHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: spacing.md },
  chartLabel: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 1.5, fontWeight: "700" },
  chartVal: { color: colors.brand, fontFamily: font.display, fontSize: 28 },
  chartUnit: { fontSize: 12, color: colors.onSurfaceSecondary },
  sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 2, fontWeight: "700", marginTop: spacing.xl, marginBottom: spacing.sm },
  pidRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.xs },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand, marginRight: spacing.md },
  pidLabel: { flex: 1, color: colors.onSurface, fontSize: 14 },
  pidVal: { color: colors.onSurface, fontFamily: font.display, fontSize: 18 },
  pidUnit: { fontSize: 11, color: colors.onSurfaceSecondary },
  aiCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg },
  aiLine: { color: colors.onSurfaceTertiary, fontSize: 13, lineHeight: 20, marginBottom: 6 },
  aiLabel: { color: colors.brand, fontWeight: "700" },
  aiBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, paddingVertical: 14, backgroundColor: colors.brandTertiary },
  aiBtnText: { color: colors.brand, fontWeight: "700", fontSize: 14 },
});
