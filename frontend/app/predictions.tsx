import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { predictionsService, PredictionResult, PredictionItem, URGENCY_META, SOURCE_META } from "@/src/vehicle/predictions/predictionsService";
import { useEntitlement } from "@/src/licensing/LicenseProvider";
import PremiumGate from "@/src/components/PremiumGate";
import { colors, font, radius, spacing } from "@/src/theme";

const ICONS: Record<string, string> = {
  oil: "oil", tires: "tire", airfilter: "air-filter", brakes: "car-brake-alert",
  plugs: "spark-plug", battery: "car-battery", trans: "car-shift-pattern",
  coolant: "coolant-temperature", belts: "cog-transfer", alternator: "engine",
};

export default function PredictionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [res, setRes] = useState<PredictionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const gate = useEntitlement("predictive_maintenance");

  const load = useCallback(() => {
    if (!id) return;
    setLoading(true);
    predictionsService.get(id).then(({ data, fromCache }) => { setRes(data); setOffline(fromCache); }).finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const items: PredictionItem[] = res?.items || [];

  if (!gate.hasAccess) return <PremiumGate feature="predictive_maintenance" />;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="pred-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>PREDICTIVE MAINTENANCE</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }} showsVerticalScrollIndicator={false}>
          {offline && <Text style={styles.offline}>⚠ Showing cached data (offline)</Text>}
          <View style={styles.mileageCard}>
            <Text style={styles.mileageLabel}>CURRENT MILEAGE</Text>
            <Text style={styles.mileageVal}>{res?.mileage ? `${res.mileage.toLocaleString()} km` : "Not set"}</Text>
            {!res?.mileage && (
              <Pressable testID="set-mileage-link" onPress={() => router.back()}>
                <Text style={styles.setLink}>Set mileage on the profile for accurate predictions ›</Text>
              </Pressable>
            )}
          </View>

          {items.map((it) => {
            const um = URGENCY_META[it.urgency];
            const measurable = it.remainingLifePct != null && it.remainingKm != null;
            const overdue = it.urgency === "overdue";
            return (
              <View key={it.key} style={[styles.card, { borderColor: overdue ? colors.error : colors.border }]} testID={`pred-${it.key}`}>
                <View style={styles.cardTop}>
                  <View style={styles.iconWrap}>
                    <MaterialCommunityIcons name={(ICONS[it.key] || "wrench") as any} size={22} color={colors.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{it.name}</Text>
                    <Text style={styles.sub}>
                      {measurable
                        ? `${it.remainingKm! > 0 ? `~${it.remainingKm!.toLocaleString()} km remaining` : `${Math.abs(it.remainingKm!).toLocaleString()} km overdue`}${it.dueMileage ? ` · due @ ${it.dueMileage.toLocaleString()} km` : ""}`
                        : it.urgency === "inspect"
                        ? "Physical inspection required"
                        : it.urgency === "test"
                        ? "Physical test recommended"
                        : "Insufficient data to determine status"}
                    </Text>
                  </View>
                  <View style={[styles.urgency, { backgroundColor: um.color + "22", borderColor: um.color }]}>
                    <Text style={[styles.urgencyText, { color: um.color }]}>{um.label}</Text>
                  </View>
                </View>

                {/* Remaining service life bar — only when we can actually measure it */}
                {measurable ? (
                  <>
                    <View style={styles.track}>
                      <View style={[styles.fill, { width: `${Math.round(it.remainingLifePct! * 100)}%`, backgroundColor: um.color }]} />
                    </View>
                    <View style={styles.footRow}>
                      <Text style={styles.lifePct}>{Math.round(it.remainingLifePct! * 100)}% life left</Text>
                      {it.confidence != null && (
                        <View style={styles.confRow}>
                          <MaterialCommunityIcons name="shield-check" size={12} color={colors.onSurfaceSecondary} />
                          <Text style={styles.conf}>{Math.round(it.confidence * 100)}% confidence</Text>
                        </View>
                      )}
                    </View>
                  </>
                ) : null}

                {/* Authoritative data-source label — never hide where a number came from */}
                <View style={styles.sourceRow} testID={`pred-source-${it.key}`}>
                  <MaterialCommunityIcons name="database-search" size={12} color={colors.onSurfaceSecondary} />
                  <Text style={styles.sourceText}>Source: {SOURCE_META[it.source].label}</Text>
                </View>

                {it.reasons.length > 0 && (
                  <View style={styles.reasons}>
                    {it.reasons.map((r, i) => (
                      <View key={i} style={styles.reasonRow}>
                        <MaterialCommunityIcons name="circle-small" size={16} color={colors.onSurfaceSecondary} />
                        <Text style={styles.reasonText}>{r}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            );
          })}
          <Text style={styles.disclaimer}>JARVIS never fabricates component condition. Interval items are manufacturer recommendations; live items use your recorded telemetry/fault codes; brake pads and battery require a physical inspection/test. Log services (with mileage) in the Repair Log to improve accuracy.</Text>
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
  mileageCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md, alignItems: "center" },
  mileageLabel: { color: colors.onSurfaceSecondary, fontSize: 10, letterSpacing: 1.5 },
  mileageVal: { color: colors.brand, fontFamily: font.display, fontSize: 30, marginTop: 2 },
  setLink: { color: colors.warning, fontSize: 12, marginTop: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, padding: spacing.lg, marginBottom: spacing.md },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  iconWrap: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  name: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  sub: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  urgency: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  urgencyText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  track: { height: 6, backgroundColor: colors.surfaceTertiary, borderRadius: radius.pill, marginTop: spacing.md, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.pill },
  footRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.sm },
  lifePct: { color: colors.onSurface, fontSize: 12, fontWeight: "600" },
  confRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  conf: { color: colors.onSurfaceSecondary, fontSize: 11 },
  reasons: { marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm },
  sourceRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.sm },
  sourceText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "600" },
  reasonRow: { flexDirection: "row", alignItems: "center" },
  reasonText: { color: colors.onSurfaceSecondary, fontSize: 12, flex: 1 },
  disclaimer: { color: colors.onSurfaceSecondary, fontSize: 11, lineHeight: 16, marginTop: spacing.sm, fontStyle: "italic" },
});
