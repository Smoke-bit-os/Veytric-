import React, { useCallback, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, TextInput,
  ActivityIndicator, RefreshControl,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useEntitlement } from "@/src/licensing/LicenseProvider";
import PremiumGate from "@/src/components/PremiumGate";
import { colors, font, radius, spacing } from "@/src/theme";

type FleetVehicle = {
  id: string; vin: string; name: string; year?: number; make: string; model: string;
  mileage?: number | null; customerName: string; customerNotes: string;
  healthScore: number | null; healthStatus: "healthy" | "attention" | "critical" | "unknown";
  lastScan: string | null; openIssues: number; hasRecentScan: boolean;
};
type FleetSummary = {
  total: number; healthy: number; attention: number; critical: number; unknown: number;
  totalOpenIssues: number; noScanCount: number; avgHealth: number | null;
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "healthy", label: "Healthy" },
  { key: "attention", label: "Needs Attention" },
  { key: "critical", label: "Critical" },
] as const;

const statusColor = (s: string) =>
  s === "healthy" ? colors.success : s === "attention" ? colors.warning : s === "critical" ? colors.error : colors.onSurfaceSecondary;

const rel = (iso?: string | null) => {
  if (!iso) return "No scans";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "1d ago";
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
};

export default function ShopDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const gate = useEntitlement("fleet_management");
  const [summary, setSummary] = useState<FleetSummary | null>(null);
  const [vehicles, setVehicles] = useState<FleetVehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    try {
      const res = await api.getFleet();
      setSummary(res.summary);
      setVehicles(res.vehicles || []);
    } catch { /* not shop / offline */ }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useFocusEffect(useCallback(() => { if (gate.hasAccess) load(); }, [gate.hasAccess, load]));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (filter !== "all" && v.healthStatus !== filter) return false;
      if (!q) return true;
      const hay = `${v.customerName} ${v.vin} ${v.year || ""} ${v.make} ${v.model} ${v.name}`.toLowerCase();
      return hay.includes(q);
    });
  }, [vehicles, query, filter]);

  // Group by customer name (Unassigned last).
  const groups = useMemo(() => {
    const map: Record<string, FleetVehicle[]> = {};
    filtered.forEach((v) => {
      const key = (v.customerName || "").trim() || "Unassigned";
      (map[key] ||= []).push(v);
    });
    return Object.entries(map).sort(([a], [b]) => (a === "Unassigned" ? 1 : b === "Unassigned" ? -1 : a.localeCompare(b)));
  }, [filtered]);

  if (!gate.hasAccess) return <PremiumGate feature="fleet_management" />;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="shop-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>SHOP DASHBOARD</Text>
        <View style={{ width: 28 }} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.brand} />}
        >
          {/* Fleet health summary */}
          <Text style={styles.sectionTitle}>FLEET HEALTH SUMMARY</Text>
          <View style={styles.summaryGrid} testID="fleet-summary">
            <Stat label="VEHICLES" value={summary?.total ?? 0} />
            <Stat label="AVG HEALTH" value={summary?.avgHealth ?? "—"} accent={colors.brand} />
            <Stat label="OPEN ISSUES" value={summary?.totalOpenIssues ?? 0} accent={colors.warning} />
            <Stat label="HEALTHY" value={summary?.healthy ?? 0} accent={colors.success} />
            <Stat label="ATTENTION" value={summary?.attention ?? 0} accent={colors.warning} />
            <Stat label="CRITICAL" value={summary?.critical ?? 0} accent={colors.error} />
          </View>
          {(summary?.noScanCount ?? 0) > 0 && (
            <View style={styles.noScanRow}>
              <MaterialCommunityIcons name="clock-alert-outline" size={14} color={colors.warning} />
              <Text style={styles.noScanText}>{summary?.noScanCount} vehicle(s) with no recent scan</Text>
            </View>
          )}

          {/* Search */}
          <View style={styles.searchBox}>
            <MaterialCommunityIcons name="magnify" size={18} color={colors.onSurfaceSecondary} />
            <TextInput
              testID="fleet-search"
              style={styles.searchInput}
              placeholder="Search customer, VIN, make/model"
              placeholderTextColor={colors.onSurfaceSecondary}
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
            />
            {query ? (
              <Pressable onPress={() => setQuery("")} hitSlop={10}>
                <MaterialCommunityIcons name="close-circle" size={16} color={colors.onSurfaceSecondary} />
              </Pressable>
            ) : null}
          </View>

          {/* Health filter */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
            {FILTERS.map((f) => (
              <Pressable key={f.key} testID={`filter-${f.key}`} style={[styles.filterChip, filter === f.key && styles.filterChipActive]} onPress={() => setFilter(f.key)}>
                <Text style={[styles.filterText, filter === f.key && styles.filterTextActive]}>{f.label}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {/* Grouped vehicle list */}
          {filtered.length === 0 ? (
            <View style={styles.empty} testID="fleet-empty">
              <MaterialCommunityIcons name="car-multiple" size={44} color={colors.onSurfaceSecondary} />
              <Text style={styles.emptyText}>
                {vehicles.length === 0 ? "No vehicles in your fleet yet. Add vehicles in the Garage and assign customers from each Vehicle Profile." : "No vehicles match your search/filter."}
              </Text>
            </View>
          ) : (
            groups.map(([customer, list]) => (
              <View key={customer} style={{ marginTop: spacing.lg }}>
                <View style={styles.groupHead}>
                  <MaterialCommunityIcons name="account" size={15} color={colors.brand} />
                  <Text style={styles.groupName}>{customer}</Text>
                  <Text style={styles.groupCount}>{list.length}</Text>
                </View>
                {list.map((v) => (
                  <Pressable key={v.id} testID={`fleet-vehicle-${v.id}`} style={styles.card} onPress={() => router.push(`/vehicle-profile?id=${v.id}`)}>
                    <View style={styles.cardTop}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.vName}>{[v.year, v.make, v.model].filter(Boolean).join(" ") || v.name}</Text>
                        {v.vin ? <Text style={styles.vin}>{v.vin}</Text> : null}
                      </View>
                      <View style={[styles.scorePill, { borderColor: statusColor(v.healthStatus) }]}>
                        <Text style={[styles.scoreVal, { color: statusColor(v.healthStatus) }]}>{v.healthScore ?? "—"}</Text>
                      </View>
                    </View>
                    <View style={styles.metaRow}>
                      <Meta icon="calendar-search" text={`Scan ${rel(v.lastScan)}`} warn={!v.hasRecentScan} />
                      <Meta icon="alert-circle-outline" text={`${v.openIssues} issue${v.openIssues === 1 ? "" : "s"}`} warn={v.openIssues > 0} />
                      {v.mileage != null ? <Meta icon="speedometer" text={`${Number(v.mileage).toLocaleString()} mi`} /> : null}
                    </View>
                    {v.customerNotes ? (
                      <View style={styles.noteRow}>
                        <MaterialCommunityIcons name="note-text-outline" size={13} color={colors.onSurfaceSecondary} />
                        <Text style={styles.noteText} numberOfLines={2}>{v.customerNotes}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Stat({ label, value, accent }: { label: string; value: any; accent?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statVal, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
function Meta({ icon, text, warn }: { icon: string; text: string; warn?: boolean }) {
  return (
    <View style={styles.meta}>
      <MaterialCommunityIcons name={icon as any} size={13} color={warn ? colors.warning : colors.onSurfaceSecondary} />
      <Text style={[styles.metaText, warn && { color: colors.warning }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1.2 },
  sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 2, fontWeight: "700", marginBottom: spacing.sm },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  stat: { flexGrow: 1, flexBasis: "30%", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md },
  statVal: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  statLabel: { color: colors.onSurfaceSecondary, fontSize: 9, letterSpacing: 1, marginTop: 2 },
  noScanRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  noScanText: { color: colors.warning, fontSize: 12, fontWeight: "600" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, marginTop: spacing.lg },
  searchInput: { flex: 1, color: colors.onSurface, paddingVertical: 12, fontSize: 14 },
  filterRow: { gap: spacing.sm, paddingVertical: spacing.md },
  filterChip: { paddingHorizontal: 14, height: 34, justifyContent: "center", borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  filterChipActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  filterText: { color: colors.onSurfaceSecondary, fontSize: 13, fontWeight: "600" },
  filterTextActive: { color: colors.brand },
  empty: { alignItems: "center", paddingVertical: spacing["3xl"], gap: spacing.md, paddingHorizontal: spacing.lg },
  emptyText: { color: colors.onSurfaceSecondary, textAlign: "center", lineHeight: 20 },
  groupHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: spacing.sm },
  groupName: { color: colors.onSurface, fontFamily: font.display, fontSize: 16, flex: 1 },
  groupCount: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "700" },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  cardTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  vName: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  vin: { color: colors.onSurfaceSecondary, fontSize: 11, fontFamily: font.display, marginTop: 2 },
  scorePill: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  scoreVal: { fontFamily: font.display, fontSize: 18 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.sm },
  meta: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { color: colors.onSurfaceSecondary, fontSize: 12 },
  noteRow: { flexDirection: "row", alignItems: "flex-start", gap: 5, marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.divider },
  noteText: { flex: 1, color: colors.onSurfaceTertiary, fontSize: 12, lineHeight: 17 },
});
