import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Dimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LineChart } from "react-native-gifted-charts";
import { useTelemetry } from "@/src/telemetry";
import { colors, font, radius, spacing } from "@/src/theme";

const SENSORS = [
  { key: "rpm", label: "RPM", unit: "", max: 7000 },
  { key: "speed", label: "Speed", unit: "km/h", max: 180 },
  { key: "boost", label: "Boost", unit: "kPa", max: 200 },
  { key: "coolantTemp", label: "Coolant", unit: "°C", max: 120 },
  { key: "throttle", label: "Throttle", unit: "%", max: 100 },
  { key: "batteryVoltage", label: "Battery", unit: "V", max: 15 },
] as const;

export default function Diagnostics() {
  const insets = useSafeAreaInsets();
  const { data, history } = useTelemetry();
  const [selected, setSelected] = useState<string>("rpm");
  const width = Dimensions.get("window").width;

  const sensorMeta = SENSORS.find((s) => s.key === selected)!;
  const chartData = (history[selected] || []).map((v) => ({ value: v }));

  return (
    <View style={styles.root}>
      {/* Sticky header */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Text style={styles.title}>LIVE DIAGNOSTICS</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {SENSORS.map((s) => {
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
            <Text style={styles.chartLabel}>{sensorMeta.label.toUpperCase()}</Text>
            <Text style={styles.chartValue}>
              {typeof (data as any)[selected] === "number"
                ? Math.round((data as any)[selected] * 10) / 10
                : (data as any)[selected]}
              <Text style={styles.chartUnit}> {sensorMeta.unit}</Text>
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
            hideYAxisText={false}
            noOfSections={4}
            maxValue={sensorMeta.max}
            initialSpacing={0}
            adjustToWidth
            disableScroll
          />
        </View>

        <Text style={styles.sectionTitle}>ACTIVE SENSOR STREAMS</Text>
        {SENSORS.map((s) => {
          const raw = (data as any)[s.key];
          const val = typeof raw === "number" ? Math.round(raw * 10) / 10 : raw;
          return (
            <Pressable
              key={s.key}
              testID={`sensor-row-${s.key}`}
              onPress={() => setSelected(s.key)}
              style={styles.row}
            >
              <View style={[styles.liveDot, { opacity: selected === s.key ? 1 : 0.35 }]} />
              <Text style={styles.rowLabel}>{s.label}</Text>
              <Text style={styles.rowValue}>
                {val}
                <Text style={styles.rowUnit}> {s.unit}</Text>
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
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
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 24, letterSpacing: 2 },
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
    color: colors.onSurfaceSecondary,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand, marginRight: spacing.md },
  rowLabel: { flex: 1, color: colors.onSurface, fontSize: 15 },
  rowValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  rowUnit: { fontSize: 11, color: colors.onSurfaceSecondary },
});
