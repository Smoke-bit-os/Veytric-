import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { timelineService, TimelineGroup, TimelineEvent, TimelineResult, FILTERS } from "@/src/vehicle/timeline/timelineService";
import { colors, font, radius, spacing } from "@/src/theme";

const ICONS: Record<string, string> = {
  diagnostics: "stethoscope", performance: "chart-line", maintenance: "wrench",
  parts: "cog", repair: "car-wrench", note: "note-text", dtc: "alert-circle",
};
const sevColor = (s?: string) => (s === "bad" || s === "warn" ? colors.warning : s === "good" ? colors.success : colors.brand);

export default function TimelineScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [filter, setFilter] = useState<TimelineGroup>("all");
  const [res, setRes] = useState<TimelineResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);

  const load = useCallback((f: TimelineGroup) => {
    if (!id) return;
    setLoading(true);
    timelineService.get(id, f).then(({ data, fromCache }) => { setRes(data); setOffline(fromCache); }).finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(useCallback(() => { load(filter); }, [load, filter]));

  const events: TimelineEvent[] = res?.events || [];
  const counts = res?.counts || {};

  const openEvent = (e: TimelineEvent) => {
    if (e.type === "performance" && e.refId) router.push(`/playback?id=${e.refId}`);
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="timeline-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>MAINTENANCE TIMELINE</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.filterWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const c = f.key === "all" ? (res?.count ?? 0) : (counts[f.key] ?? 0);
            return (
              <Pressable key={f.key} testID={`tl-filter-${f.key}`} style={[styles.chip, active && styles.chipActive]} onPress={() => setFilter(f.key)}>
                <MaterialCommunityIcons name={f.icon as any} size={14} color={active ? colors.brand : colors.onSurfaceSecondary} />
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{f.label} {c ? `· ${c}` : ""}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {offline && <Text style={styles.offline}>⚠ Showing cached data (offline)</Text>}

      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
      ) : events.length === 0 ? (
        <View style={styles.empty} testID="timeline-empty">
          <MaterialCommunityIcons name="timeline-remove" size={48} color={colors.onSurfaceSecondary} />
          <Text style={styles.emptyText}>No events for this filter yet.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }} showsVerticalScrollIndicator={false}>
          {events.map((e, i) => (
            <Pressable key={`${e.refId || e.ts}-${i}`} testID={`tl-event-${i}`} style={styles.row} onPress={() => openEvent(e)}>
              <View style={styles.rail}>
                <View style={[styles.dot, { backgroundColor: sevColor(e.severity) }]} />
                {i < events.length - 1 && <View style={styles.line} />}
              </View>
              <View style={styles.card}>
                <View style={styles.cardHead}>
                  <MaterialCommunityIcons name={(ICONS[e.type] || "circle") as any} size={16} color={colors.brand} />
                  <Text style={styles.cardTitle} numberOfLines={1}>{e.title}</Text>
                  {e.hasAi ? <MaterialCommunityIcons name="robot" size={14} color={colors.brand} /> : null}
                </View>
                {e.subtitle ? <Text style={styles.cardSub} numberOfLines={2}>{e.subtitle}</Text> : null}
                <View style={styles.metaRow}>
                  <Text style={styles.date}>{e.ts ? new Date(e.ts).toLocaleDateString() : ""}</Text>
                  {e.mileage != null ? <Badge icon="counter" text={`${Number(e.mileage).toLocaleString()} km`} /> : null}
                  {e.healthScore != null ? <Badge icon="heart-pulse" text={`${e.healthScore}`} /> : null}
                  {e.cost != null ? <Badge icon="cash" text={`$${e.cost}`} /> : null}
                  {e.type === "performance" ? <Text style={styles.openHint}>View ›</Text> : null}
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function Badge({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.badge}>
      <MaterialCommunityIcons name={icon as any} size={11} color={colors.onSurfaceSecondary} />
      <Text style={styles.badgeText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1.2 },
  filterWrap: { borderBottomWidth: 1, borderBottomColor: colors.divider },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, height: 34, paddingHorizontal: 12, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  chipActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
  chipTextActive: { color: colors.brand },
  offline: { color: colors.warning, fontSize: 12, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  empty: { alignItems: "center", paddingVertical: spacing["3xl"], gap: spacing.md },
  emptyText: { color: colors.onSurfaceSecondary },
  row: { flexDirection: "row", gap: spacing.md },
  rail: { alignItems: "center", width: 16 },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 6 },
  line: { flex: 1, width: 2, backgroundColor: colors.border, marginTop: 2 },
  card: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  cardTitle: { flex: 1, color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  cardSub: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 3 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  date: { color: colors.onSurfaceSecondary, fontSize: 11 },
  badge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.surface, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { color: colors.onSurfaceSecondary, fontSize: 10, fontWeight: "600" },
  openHint: { color: colors.brand, fontSize: 11, fontWeight: "700", marginLeft: "auto" },
});
