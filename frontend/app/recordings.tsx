import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { analysisService } from "@/src/vehicle/performance/analysisService";
import { colors, font, radius, spacing } from "@/src/theme";

const fmtDur = (s: number) => {
  const m = Math.floor((s || 0) / 60);
  const sec = Math.round((s || 0) % 60);
  return `${m}m ${sec}s`;
};

export default function RecordingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { vehicle_id } = useLocalSearchParams<{ vehicle_id?: string }>();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [compareMode, setCompareMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  const load = useCallback(() => {
    setLoading(true);
    analysisService.list(vehicle_id).then((r) => setItems(r || [])).catch(() => {}).finally(() => setLoading(false));
  }, [vehicle_id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const onCardPress = (id: string) => {
    if (compareMode) toggleSelect(id);
    else router.push(`/playback?id=${id}`);
  };

  const runCompare = () => {
    if (selected.length !== 2) return;
    router.push(`/compare?a=${selected[0]}&b=${selected[1]}`);
  };

  const remove = async (id: string) => {
    setItems((v) => v.filter((x) => x.id !== id));
    await analysisService.remove(id).catch(() => {});
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="recordings-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>DRIVE SESSIONS</Text>
        <Pressable
          testID="toggle-compare"
          onPress={() => { setCompareMode((m) => !m); setSelected([]); }}
          hitSlop={12}
        >
          <MaterialCommunityIcons name="compare-horizontal" size={22} color={compareMode ? colors.brand : colors.onSurfaceSecondary} />
        </Pressable>
      </View>

      {compareMode && (
        <View style={styles.compareBar}>
          <Text style={styles.compareHint}>Select 2 sessions to compare · {selected.length}/2</Text>
          <Pressable testID="run-compare" style={[styles.compareBtn, selected.length !== 2 && { opacity: 0.4 }]} onPress={runCompare} disabled={selected.length !== 2}>
            <Text style={styles.compareBtnText}>COMPARE</Text>
          </Pressable>
        </View>
      )}

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 100 }} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
        ) : items.length === 0 ? (
          <View style={styles.empty} testID="recordings-empty">
            <MaterialCommunityIcons name="chart-line" size={48} color={colors.onSurfaceSecondary} />
            <Text style={styles.emptyText}>No recorded sessions yet.</Text>
            <Pressable testID="empty-record" style={styles.recordCta} onPress={() => router.push("/record")}>
              <MaterialCommunityIcons name="record-circle" size={18} color={colors.error} />
              <Text style={styles.recordCtaText}>Record a Session</Text>
            </Pressable>
          </View>
        ) : (
          items.map((r) => {
            const sel = selected.includes(r.id);
            const sum = r.summary || {};
            return (
              <Pressable
                key={r.id}
                testID={`session-${r.id}`}
                style={[styles.card, sel && styles.cardSelected]}
                onPress={() => onCardPress(r.id)}
              >
                <View style={styles.cardTop}>
                  <View style={styles.photo}>
                    <MaterialCommunityIcons name="car-sports" size={28} color={colors.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName} numberOfLines={1}>{r.name}</Text>
                    <Text style={styles.cardDate}>{r.created_at ? new Date(r.created_at).toLocaleString() : ""}</Text>
                  </View>
                  {compareMode ? (
                    <MaterialCommunityIcons name={sel ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"} size={22} color={sel ? colors.brand : colors.onSurfaceSecondary} />
                  ) : (
                    <Pressable testID={`del-session-${r.id}`} onPress={() => remove(r.id)} hitSlop={10}>
                      <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.onSurfaceSecondary} />
                    </Pressable>
                  )}
                </View>

                <View style={styles.statsRow}>
                  <Stat label="DURATION" value={fmtDur(r.duration)} />
                  <Stat label="DISTANCE" value={`${r.distance ?? 0} km`} />
                  <Stat label="PEAK RPM" value={`${sum.peakRpm ?? 0}`} />
                </View>
                <View style={styles.statsRow}>
                  <Stat label="MAX SPEED" value={`${sum.maxSpeed ?? 0}`} unit="km/h" />
                  <Stat label="LOW VOLT" value={`${(sum.lowestVoltage ?? 0).toFixed ? (sum.lowestVoltage ?? 0).toFixed(1) : sum.lowestVoltage}`} unit="V" />
                  <Stat label="HEALTH" value={`${r.health_score ?? "—"}`} accent />
                </View>

                {r.ai_analysis ? (
                  <View style={styles.aiBadge} testID={`ai-badge-${r.id}`}>
                    <MaterialCommunityIcons name="robot" size={12} color={colors.brand} />
                    <Text style={styles.aiBadgeText}>AI ANALYZED</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {!compareMode && (
        <Pressable testID="fab-record" style={[styles.fab, { bottom: insets.bottom + spacing.lg }]} onPress={() => router.push("/record")}>
          <LinearGradient colors={[colors.error, "#B71C1C"]} style={styles.fabGrad}>
            <MaterialCommunityIcons name="record-circle" size={24} color="#fff" />
            <Text style={styles.fabText}>RECORD</Text>
          </LinearGradient>
        </Pressable>
      )}
    </View>
  );
}

function Stat({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statVal, accent && { color: colors.brand }]}>
        {value}{unit ? <Text style={styles.statUnit}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 18, letterSpacing: 1.5 },
  compareBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.brandTertiary },
  compareHint: { color: colors.onSurface, fontSize: 13 },
  compareBtn: { backgroundColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 7 },
  compareBtnText: { color: colors.onBrandPrimary, fontWeight: "800", fontSize: 12, letterSpacing: 1 },
  empty: { alignItems: "center", paddingVertical: spacing["3xl"], gap: spacing.md },
  emptyText: { color: colors.onSurfaceSecondary },
  recordCta: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderColor: colors.error, borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 10 },
  recordCtaText: { color: colors.error, fontWeight: "700" },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md },
  cardSelected: { borderColor: colors.brand },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginBottom: spacing.md },
  photo: { width: 48, height: 48, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  cardName: { color: colors.onSurface, fontFamily: font.display, fontSize: 18 },
  cardDate: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 1 },
  statsRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingVertical: 8, paddingHorizontal: 10 },
  statLabel: { color: colors.onSurfaceSecondary, fontSize: 9, letterSpacing: 0.8 },
  statVal: { color: colors.onSurface, fontFamily: font.display, fontSize: 18, marginTop: 2 },
  statUnit: { color: colors.onSurfaceSecondary, fontSize: 10 },
  aiBadge: { flexDirection: "row", alignItems: "center", gap: 4, alignSelf: "flex-start", borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3, marginTop: 4 },
  aiBadgeText: { color: colors.brand, fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  fab: { position: "absolute", right: spacing.lg, borderRadius: radius.pill, overflow: "hidden", shadowColor: colors.error, shadowOpacity: 0.6, shadowRadius: 12, elevation: 8 },
  fabGrad: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 14 },
  fabText: { color: "#fff", fontWeight: "800", letterSpacing: 1 },
});
