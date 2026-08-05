import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LineChart } from "react-native-gifted-charts";
import { useVehicle } from "@/src/vehicle/service";
import { PID_CATALOG } from "@/src/vehicle/health";
import { colors, font, radius, spacing } from "@/src/theme";

const CHART_KEYS = ["rpm", "speed", "boost", "maf", "coolantTemp", "engineLoad", "throttle", "batteryVoltage"];
const CHART_SENSORS = CHART_KEYS.map((k) => PID_CATALOG.find((p) => p.key === k)!).filter(Boolean);

const fmt = (v: any, decimals = 0) =>
  typeof v === "number" ? (decimals ? v.toFixed(decimals) : Math.round(v)) : v;

export default function Diagnostics() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { data, history } = useVehicle();
  const [selected, setSelected] = useState<string>("rpm");
  const width = Dimensions.get("window").width;

  const meta = PID_CATALOG.find((p) => p.key === selected)!;
  const chartData = (history[selected] || []).map((v) => ({ value: v }));

  const groups = Array.from(new Set(PID_CATALOG.map((p) => p.group)));

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>LIVE DIAGNOSTICS</Text>
          <Text style={styles.pidCount}>{PID_CATALOG.length} PIDs</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {CHART_SENSORS.map((s) => {
            const active = selected === s.key;
            return (
              <Pressable
                key={s.key}
                testID={`sensor-chip-${s.key}`}
                onPress={() => setSelected(s.key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{s.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 110, paddingTop: 8 }} showsVerticalScrollIndicator={false}>
        <View style={styles.chartCard} testID="live-chart">
          <View style={styles.chartHeader}>
            <Text style={styles.chartLabel}>{meta.label.toUpperCase()}</Text>
            <Text style={styles.chartValue}>
              {fmt((data as any)[selected], meta.decimals)}
              <Text style={styles.chartUnit}> {meta.unit}</Text>
            </Text>
          </View>
          <LineChart
            data={chartData}
            width={width - 90}
            height={170}
            hideDataPoints
            curved
            thickness={2.5}
            color={colors.brand}
            startFillColor={colors.brand}
            endFillColor="rgba(0,229,255,0.02)"
            startOpacity={0.35}
            endOpacity={0}
            areaChart
            hideRules={false}
            rulesColor={colors.divider}
            rulesType="solid"
            yAxisColor="transparent"
            xAxisColor={colors.divider}
            yAxisTextStyle={{ color: colors.onSurfaceSecondary, fontSize: 9 }}
            noOfSections={4}
            maxValue={meta.max}
            initialSpacing={0}
            adjustToWidth
            disableScroll
          />
        </View>

        {groups.map((g) => (
          <View key={g}>
            <Text style={styles.sectionTitle}>{g.toUpperCase()}</Text>
            {PID_CATALOG.filter((p) => p.group === g).map((s) => (
              <Pressable
                key={s.key}
                testID={`sensor-row-${s.key}`}
                onPress={() => setSelected(s.key)}
                style={styles.row}
              >
                <View style={[styles.liveDot, { opacity: selected === s.key ? 1 : 0.3 }]} />
                <Text style={styles.rowLabel}>{s.label}</Text>
                <Text style={styles.rowValue}>
                  {fmt((data as any)[s.key], s.decimals)}
                  <Text style={styles.rowUnit}> {s.unit}</Text>
                </Text>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>

      {data.connected && (
        <Pressable
          testID="diag-record"
          style={[styles.recFab, { bottom: insets.bottom + 84 }]}
          onPress={() => router.push("/record")}
        >
          <LinearGradient colors={[colors.error, "#B71C1C"]} style={styles.recFabGrad}>
            <MaterialCommunityIcons name="record-circle" size={20} color="#fff" />
            <Text style={styles.recFabText}>RECORD LIVE SESSION</Text>
          </LinearGradient>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  titleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 24, letterSpacing: 2 },
  pidCount: { color: colors.brand, fontSize: 11, letterSpacing: 1, fontWeight: "700" },
  chipRow: { gap: spacing.sm, paddingTop: spacing.md, paddingRight: spacing.lg },
  chip: {
    height: 36,
    flexShrink: 0,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
    justifyContent: "center",
  },
  chipActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: colors.brand },
  chartCard: {
    margin: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chartHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: spacing.lg },
  chartLabel: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 1.5, fontWeight: "700" },
  chartValue: { color: colors.brand, fontFamily: font.display, fontSize: 32 },
  chartUnit: { fontSize: 13, color: colors.onSurfaceSecondary },
  sectionTitle: {
    color: colors.brand,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand, marginRight: spacing.md },
  rowLabel: { flex: 1, color: colors.onSurface, fontSize: 15 },
  rowValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  rowUnit: { fontSize: 11, color: colors.onSurfaceSecondary },
  recFab: { position: "absolute", alignSelf: "center", borderRadius: radius.pill, overflow: "hidden", shadowColor: colors.error, shadowOpacity: 0.6, shadowRadius: 12, elevation: 8 },
  recFabGrad: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 22, paddingVertical: 13 },
  recFabText: { color: "#fff", fontWeight: "800", letterSpacing: 1, fontSize: 13 },
});
