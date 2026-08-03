import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, RefreshControl } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AIOrb from "@/src/components/AIOrb";
import Gauge from "@/src/components/Gauge";
import { useAuth } from "@/src/auth";
import { useTelemetry } from "@/src/telemetry";
import { colors, font, radius, spacing } from "@/src/theme";

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { data } = useTelemetry();
  const [refreshing, setRefreshing] = useState(false);

  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 120, paddingTop: insets.top + 8 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.brand}
            onRefresh={() => {
              setRefreshing(true);
              setTimeout(() => setRefreshing(false), 900);
            }}
          />
        }
      >
        {/* Hero */}
        <LinearGradient colors={["#0A1428", "rgba(6,8,13,0)"]} style={styles.hero}>
          <View style={styles.topRow}>
            <View>
              <Text style={styles.hello}>{greeting.toUpperCase()}</Text>
              <Text style={styles.name}>{user?.name || "Operator"}</Text>
            </View>
            <View
              style={[styles.obd, { borderColor: data.connected ? colors.success : colors.error }]}
              testID="obd-indicator"
            >
              <View style={[styles.dot, { backgroundColor: data.connected ? colors.success : colors.error }]} />
              <Text style={[styles.obdText, { color: data.connected ? colors.success : colors.error }]}>
                OBD-II {data.connected ? "LINKED" : "OFFLINE"}
              </Text>
            </View>
          </View>

          <View style={styles.orbSection}>
            <AIOrb size={150} active={false} />
            <Text style={styles.status}>SYSTEM NOMINAL</Text>
            <Text style={styles.subStatus}>
              {data.dtcs.length} active trouble code{data.dtcs.length === 1 ? "" : "s"} detected
            </Text>
          </View>
        </LinearGradient>

        {/* Gauges */}
        <Text style={styles.sectionTitle}>LIVE TELEMETRY</Text>
        <View style={styles.grid}>
          <Gauge label="Engine RPM" value={Math.round(data.rpm)} max={7000} numeric={data.rpm} testID="gauge-rpm" />
          <Gauge label="Speed" value={Math.round(data.speed)} unit="km/h" max={180} numeric={data.speed} testID="gauge-speed" />
        </View>
        <View style={styles.grid}>
          <Gauge label="Coolant" value={Math.round(data.coolantTemp)} unit="°C" min={60} max={120} numeric={data.coolantTemp} accent={data.coolantTemp > 100 ? colors.warning : colors.brand} testID="gauge-coolant" />
          <Gauge label="Oil Temp" value={Math.round(data.oilTemp)} unit="°C" min={60} max={130} numeric={data.oilTemp} testID="gauge-oil" />
        </View>
        <View style={styles.grid}>
          <Gauge label="Battery" value={data.batteryVoltage.toFixed(1)} unit="V" min={11} max={15} numeric={data.batteryVoltage} accent={data.batteryVoltage < 12.3 ? colors.warning : colors.success} testID="gauge-battery" />
          <Gauge label="Boost / MAP" value={Math.round(data.boost)} unit="kPa" max={200} numeric={data.boost} testID="gauge-boost" />
        </View>
        <View style={styles.grid}>
          <Gauge label="Throttle" value={Math.round(data.throttle)} unit="%" max={100} numeric={data.throttle} testID="gauge-throttle" />
          <Gauge label="Charging" value={data.chargingVoltage.toFixed(1)} unit="V" min={12} max={15} numeric={data.chargingVoltage} accent={colors.success} testID="gauge-charging" />
        </View>

        <View style={styles.trims}>
          <View style={styles.trimItem}>
            <Text style={styles.trimLabel}>SHORT FUEL TRIM</Text>
            <Text style={styles.trimValue}>{data.shortFuelTrim > 0 ? "+" : ""}{data.shortFuelTrim.toFixed(1)}%</Text>
          </View>
          <View style={styles.trimDivider} />
          <View style={styles.trimItem}>
            <Text style={styles.trimLabel}>LONG FUEL TRIM</Text>
            <Text style={styles.trimValue}>{data.longFuelTrim > 0 ? "+" : ""}{data.longFuelTrim.toFixed(1)}%</Text>
          </View>
        </View>
      </ScrollView>

      {/* Voice FAB */}
      <Pressable
        testID="voice-fab"
        style={[styles.fab, { bottom: 84 }]}
        onPress={() => router.push("/(tabs)/assistant?voice=1")}
      >
        <LinearGradient colors={[colors.brand, colors.brandSecondary]} style={styles.fabGrad}>
          <MaterialCommunityIcons name="microphone" size={28} color={colors.onBrandPrimary} />
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  hello: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 1.5 },
  name: { color: colors.onSurface, fontFamily: font.display, fontSize: 26 },
  obd: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: colors.surfaceSecondary,
  },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  obdText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  orbSection: { alignItems: "center", marginTop: spacing.lg },
  status: { color: colors.brand, fontFamily: font.display, fontSize: 22, letterSpacing: 3, marginTop: spacing.md },
  subStatus: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  sectionTitle: {
    color: colors.onSurfaceSecondary,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    marginTop: spacing.sm,
  },
  grid: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  trims: {
    flexDirection: "row",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  trimItem: { flex: 1, alignItems: "center" },
  trimDivider: { width: 1, backgroundColor: colors.divider },
  trimLabel: { color: colors.onSurfaceSecondary, fontSize: 9, letterSpacing: 1 },
  trimValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, marginTop: 2 },
  fab: {
    position: "absolute",
    alignSelf: "center",
    borderRadius: 32,
    shadowColor: colors.brand,
    shadowOpacity: 0.8,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  fabGrad: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
});
