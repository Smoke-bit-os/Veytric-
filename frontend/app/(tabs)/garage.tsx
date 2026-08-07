import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { api } from "@/src/api";
import { useAuth } from "@/src/auth";
import { useLicense } from "@/src/licensing/LicenseProvider";
import { VEHICLE_LIMITS, TIER_LABELS, TIER_ACCENT } from "@/src/licensing/licenseConstants";
import { maintenanceService, DashboardSummary } from "@/src/vehicle/maintenance/maintenanceService";
import { colors, font, radius, spacing } from "@/src/theme";

type Vehicle = {
  id: string;
  name: string;
  make: string;
  model: string;
  year: number;
  vin?: string;
  engine?: string;
  is_active: boolean;
};

export default function Garage() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { tier, tierLabel, status, trialDaysRemaining } = useLicense();
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [dash, setDash] = useState<Record<string, DashboardSummary>>({});
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", make: "", model: "", year: "", engine: "", vin: "" });

  const load = async () => {
    try {
      const v = await api.vehicles();
      setVehicles(v);
      // Offline-first dashboard summaries per vehicle (parallel).
      const entries = await Promise.all(
        (v || []).map(async (veh: Vehicle) => {
          const { data } = await maintenanceService.dashboard(veh.id);
          return [veh.id, data] as const;
        })
      );
      const map: Record<string, DashboardSummary> = {};
      entries.forEach(([id, d]) => { if (d) map[id] = d; });
      setDash(map);
    } catch {}
    setLoading(false);
  };

  useFocusEffect(
    useCallback(() => {
      load();
    }, [])
  );

  const addVehicle = async () => {
    if (!form.name || !form.make || !form.model) return;
    setSaving(true);
    try {
      await api.addVehicle({
        name: form.name,
        make: form.make,
        model: form.model,
        year: parseInt(form.year) || new Date().getFullYear(),
        engine: form.engine,
        vin: form.vin,
      });
      setForm({ name: "", make: "", model: "", year: "", engine: "", vin: "" });
      setModal(false);
      await load();
    } catch {}
    setSaving(false);
  };

  const activate = async (id: string) => {
    setVehicles((v) => v.map((x) => ({ ...x, is_active: x.id === id })));
    await api.activateVehicle(id).catch(() => {});
  };

  const remove = async (id: string) => {
    setVehicles((v) => v.filter((x) => x.id !== id));
    await api.deleteVehicle(id).catch(() => {});
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110, paddingTop: insets.top + 8 }} showsVerticalScrollIndicator={false}>
        {/* Profile */}
        <View style={styles.profile}>
          <LinearGradient colors={[colors.brand, colors.brandSecondary]} style={styles.avatar}>
            <Text style={styles.avatarText}>{(user?.name || "U").charAt(0).toUpperCase()}</Text>
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>{user?.name}</Text>
            <Text style={styles.email}>{user?.email}</Text>
          </View>
          <Pressable testID="settings-button" style={styles.logout} onPress={() => router.push("/about")}>
            <MaterialCommunityIcons name="cog" size={20} color={colors.onSurfaceSecondary} />
          </Pressable>
          <Pressable testID="logout-button" style={styles.logout} onPress={logout}>
            <MaterialCommunityIcons name="logout" size={20} color={colors.error} />
          </Pressable>
        </View>

        {/* Membership */}
        <Pressable testID="membership-card" style={[styles.memCard, { borderColor: TIER_ACCENT[tier] }]} onPress={() => router.push("/upgrade")}>
          <MaterialCommunityIcons name={tier === "free" ? "car" : "crown"} size={22} color={TIER_ACCENT[tier]} />
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text style={[styles.memPlan, { color: TIER_ACCENT[tier] }]}>{tierLabel}</Text>
            <Text style={styles.memSub}>
              {status === "trial" ? `Trial · ${trialDaysRemaining} days left` : status === "grace" ? "Grace period — renew to keep Pro" : status === "expired" ? "Expired — upgrade to restore" : tier === "free" ? "Unlock Pro diagnostics & AI" : "Active membership"}
            </Text>
          </View>
          {tier === "free" && <View style={styles.upPill}><Text style={styles.upPillText}>UPGRADE</Text></View>}
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceSecondary} />
        </Pressable>

        <View style={styles.quickRow}>
          <Pressable testID="quick-connect" style={styles.quickCard} onPress={() => router.push("/connect")}>
            <MaterialCommunityIcons name="access-point-network" size={24} color={colors.brand} />
            <Text style={styles.quickText}>Connection Center</Text>
          </Pressable>
          <Pressable testID="quick-reports" style={styles.quickCard} onPress={() => router.push("/reports")}>
            <MaterialCommunityIcons name="file-chart" size={24} color={colors.brand} />
            <Text style={styles.quickText}>Scan Reports</Text>
          </Pressable>
        </View>

        <View style={styles.headerRow}>
          <Text style={styles.sectionTitle}>MY GARAGE</Text>
          <Pressable testID="add-vehicle-button" style={styles.addBtn} onPress={() => {
            if (vehicles.length >= VEHICLE_LIMITS[tier]) {
              Alert.alert(
                "Vehicle limit reached",
                `The ${TIER_LABELS[tier]} plan allows ${VEHICLE_LIMITS[tier]} vehicle. Upgrade to JARVIS Pro for unlimited vehicles.`,
                [{ text: "Not now", style: "cancel" }, { text: "Upgrade", onPress: () => router.push("/upgrade") }],
              );
              return;
            }
            setModal(true);
          }}>
            <MaterialCommunityIcons name="plus" size={16} color={colors.brand} />
            <Text style={styles.addBtnText}>Add</Text>
          </Pressable>
        </View>

        {loading ? (
          <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
        ) : vehicles.length === 0 ? (
          <View style={styles.empty} testID="garage-empty">
            <MaterialCommunityIcons name="car-off" size={48} color={colors.onSurfaceSecondary} />
            <Text style={styles.emptyText}>No vehicles yet. Add your first ride.</Text>
          </View>
        ) : (
          vehicles.map((v) => (
            <View key={v.id} style={[styles.card, v.is_active && styles.cardActive]} testID={`vehicle-${v.id}`}>
              <View style={styles.cardTop}>
                <Pressable
                  testID={`profile-${v.id}`}
                  style={styles.cardMain}
                  onPress={() => router.push(`/vehicle-profile?id=${v.id}`)}
                >
                  <MaterialCommunityIcons name="car-sports" size={26} color={v.is_active ? colors.brand : colors.onSurfaceSecondary} />
                  <View style={{ flex: 1, marginLeft: spacing.md }}>
                    <Text style={styles.vName}>{v.name}</Text>
                    <Text style={styles.vMeta}>
                      {v.year} {v.make} {v.model}
                      {v.engine ? ` · ${v.engine}` : ""}
                    </Text>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceSecondary} />
                </Pressable>
                <Pressable testID={`delete-${v.id}`} onPress={() => remove(v.id)} hitSlop={10} style={{ marginLeft: spacing.sm }}>
                  <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.onSurfaceSecondary} />
                </Pressable>
              </View>

              {dash[v.id] ? <VehicleDash d={dash[v.id]} /> : null}

              <Pressable
                testID={`activate-${v.id}`}
                style={[styles.activateBtn, v.is_active && styles.activeBtn]}
                onPress={() => activate(v.id)}
                disabled={v.is_active}
              >
                <Text style={[styles.activateText, v.is_active && styles.activeText]}>
                  {v.is_active ? "● CONNECTED" : "SET ACTIVE"}
                </Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>

      {/* Add vehicle modal */}
      <Modal visible={modal} transparent animationType="slide" onRequestClose={() => setModal(false)}>
        <Pressable style={styles.backdrop} onPress={() => setModal(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Add Vehicle</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              {[
                { k: "name", p: "Nickname (e.g. My Jeep)" },
                { k: "make", p: "Make (e.g. Jeep)" },
                { k: "model", p: "Model (e.g. Wrangler)" },
                { k: "year", p: "Year", num: true },
                { k: "engine", p: "Engine (e.g. 3.6L V6)" },
                { k: "vin", p: "VIN (optional)" },
              ].map((f) => (
                <TextInput
                  key={f.k}
                  testID={`vehicle-input-${f.k}`}
                  style={styles.input}
                  placeholder={f.p}
                  placeholderTextColor={colors.onSurfaceSecondary}
                  value={(form as any)[f.k]}
                  keyboardType={f.num ? "number-pad" : "default"}
                  onChangeText={(t) => setForm((s) => ({ ...s, [f.k]: t }))}
                />
              ))}
              <Pressable testID="save-vehicle-button" style={styles.saveBtn} onPress={addVehicle} disabled={saving}>
                <LinearGradient colors={[colors.brand, colors.brandSecondary]} style={styles.saveGrad}>
                  {saving ? (
                    <ActivityIndicator color={colors.onBrandPrimary} />
                  ) : (
                    <Text style={styles.saveText}>SAVE VEHICLE</Text>
                  )}
                </LinearGradient>
              </Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const rel = (iso?: string | null) => {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "1d ago";
  if (d < 30) return `${d}d ago`;
  return `${Math.floor(d / 30)}mo ago`;
};
const trendArrow = (dir: string) => (dir === "rising" ? "arrow-up" : dir === "declining" ? "arrow-down" : dir === "recurring" ? "repeat" : "arrow-right");
const trendColor = (sev: string) => (sev === "warn" || sev === "bad" ? colors.warning : sev === "good" ? colors.success : colors.info);
const urgencyColor = (u?: string) => (u === "overdue" ? colors.error : u === "soon" ? colors.warning : colors.brand);

function VehicleDash({ d }: { d: DashboardSummary }) {
  return (
    <View style={styles.dash} testID="vehicle-dash">
      <View style={styles.dashRow}>
        <View style={styles.dashStat}>
          <Text style={styles.dashLabel}>HEALTH</Text>
          <Text style={[styles.dashVal, { color: d.healthScore != null ? (d.healthScore >= 80 ? colors.success : d.healthScore >= 65 ? colors.warning : colors.error) : colors.onSurfaceSecondary }]}>
            {d.healthScore ?? "—"}
          </Text>
        </View>
        <View style={styles.dashStat}>
          <Text style={styles.dashLabel}>LAST SCAN</Text>
          <Text style={styles.dashSmall}>{rel(d.lastScan)}</Text>
        </View>
        <View style={styles.dashStat}>
          <Text style={styles.dashLabel}>LAST DRIVE</Text>
          <Text style={styles.dashSmall}>{rel(d.lastRecording)}</Text>
        </View>
        <View style={styles.dashStat}>
          <Text style={styles.dashLabel}>SERVICE</Text>
          <Text style={styles.dashSmall}>{rel(d.lastMaintenance)}</Text>
        </View>
      </View>

      {d.nextService && (
        <View style={styles.nextRow}>
          <MaterialCommunityIcons name="calendar-clock" size={14} color={urgencyColor(d.nextService.urgency)} />
          <Text style={styles.nextText} numberOfLines={1}>
            Next: <Text style={{ color: colors.onSurface }}>{d.nextService.name}</Text>
            {d.nextService.dueMileage ? ` @ ${d.nextService.dueMileage.toLocaleString()} km` : ""}
          </Text>
        </View>
      )}

      {(d.alerts?.length > 0 || d.trends?.length > 0) && (
        <View style={styles.pillRow}>
          {(d.alerts || []).slice(0, 2).map((a) => (
            <View key={a.key} style={[styles.alertPill, { borderColor: urgencyColor(a.urgency) }]}>
              <MaterialCommunityIcons name="alert" size={11} color={urgencyColor(a.urgency)} />
              <Text style={[styles.alertText, { color: urgencyColor(a.urgency) }]}>{a.name}</Text>
            </View>
          ))}
          {(d.trends || []).slice(0, 2).map((t) => (
            <View key={t.key} style={styles.trendPill}>
              <MaterialCommunityIcons name={trendArrow(t.direction) as any} size={11} color={trendColor(t.severity)} />
              <Text style={styles.trendText}>{t.key}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  dash: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.md },
  dashRow: { flexDirection: "row", justifyContent: "space-between" },
  dashStat: { flex: 1, alignItems: "center" },
  dashLabel: { color: colors.onSurfaceSecondary, fontSize: 8, letterSpacing: 0.8 },
  dashVal: { fontFamily: font.display, fontSize: 22, marginTop: 1 },
  dashSmall: { color: colors.onSurface, fontSize: 12, fontWeight: "600", marginTop: 4 },
  nextRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md },
  nextText: { color: colors.onSurfaceSecondary, fontSize: 12, flex: 1 },
  pillRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  alertPill: { flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  alertText: { fontSize: 10, fontWeight: "700" },
  trendPill: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  trendText: { color: colors.onSurfaceSecondary, fontSize: 10, fontWeight: "600", textTransform: "capitalize" },
  profile: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    margin: spacing.lg,
    padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.onBrandPrimary, fontFamily: font.display, fontSize: 24 },
  name: { color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  email: { color: colors.onSurfaceSecondary, fontSize: 13 },
  logout: { padding: spacing.sm },
  memCard: { flexDirection: "row", alignItems: "center", marginHorizontal: spacing.lg, marginBottom: spacing.lg, padding: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1 },
  memPlan: { fontFamily: font.display, fontSize: 18 },
  memSub: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 1 },
  upPill: { backgroundColor: colors.brandTertiary, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4, marginRight: spacing.sm },
  upPillText: { color: colors.brand, fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.lg },
  quickRow: { flexDirection: "row", gap: spacing.md, paddingHorizontal: spacing.lg, marginBottom: spacing.lg },
  quickCard: {
    flex: 1,
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickText: { color: colors.onSurface, fontSize: 13, fontWeight: "600" },
  sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  addBtnText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
  empty: { alignItems: "center", paddingVertical: spacing["3xl"], gap: spacing.md },
  emptyText: { color: colors.onSurfaceSecondary },
  card: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardActive: { borderColor: colors.brand },
  cardTop: { flexDirection: "row", alignItems: "center" },
  cardMain: { flexDirection: "row", alignItems: "center", flex: 1 },
  vName: { color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  vMeta: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 2 },
  activateBtn: {
    marginTop: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.sm,
    alignItems: "center",
    backgroundColor: colors.surfaceTertiary,
  },
  activeBtn: { backgroundColor: colors.brandTertiary },
  activateText: { color: colors.onSurfaceSecondary, fontWeight: "700", letterSpacing: 1, fontSize: 12 },
  activeText: { color: colors.brand },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: colors.surfaceSecondary,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderColor: colors.border,
    maxHeight: "80%",
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 24, marginBottom: spacing.md },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.onSurface,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    marginBottom: spacing.md,
    fontSize: 15,
  },
  saveBtn: { borderRadius: radius.md, overflow: "hidden", marginTop: spacing.xs },
  saveGrad: { paddingVertical: 16, alignItems: "center" },
  saveText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 1.5 },
});
