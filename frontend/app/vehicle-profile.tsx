import React, { useCallback, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { profileService } from "@/src/vehicle/profile/profileService";
import { api } from "@/src/api";
import { getKnownIssues } from "@/src/vehicle/database/knownIssues";
import { useEntitlement } from "@/src/licensing/LicenseProvider";
import { colors, font, radius, spacing } from "@/src/theme";

const likeColor = (l: string) => (l === "high" ? colors.error : l === "medium" ? colors.warning : colors.success);

export default function VehicleProfile() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [profile, setProfile] = useState<any>(null);
  const [perf, setPerf] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<null | "mileage" | "maintenance" | "parts" | "customer">(null);
  const [f1, setF1] = useState("");
  const [f2, setF2] = useState("");
  const [saving, setSaving] = useState(false);
  const shopGate = useEntitlement("fleet_management");

  const load = useCallback(() => {
    if (!id) return;
    profileService.getProfile(id).then(setProfile).catch(() => {}).finally(() => setLoading(false));
    api.vehiclePerformance(id).then(setPerf).catch(() => {});
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    if (!id || !modal) return;
    setSaving(true);
    try {
      if (modal === "mileage") {
        await profileService.patch(id, { mileage: parseInt(f1) || 0 });
      } else if (modal === "customer") {
        await profileService.patch(id, { customerName: f1, customerNotes: f2 });
      } else {
        await profileService.addHistory(id, modal, { title: f1, detail: f2 });
      }
      setModal(null); setF1(""); setF2("");
      load();
    } catch {}
    setSaving(false);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.brand} size="large" /></View>;
  if (!profile) return <View style={styles.center}><Text style={styles.dim}>Vehicle not found</Text></View>;

  const issues = getKnownIssues(profile.make, profile.model);
  const health: { ts: string; score: number }[] = profile.health_history || [];
  const maint = profile.history?.maintenance || [];
  const parts = profile.history?.parts || [];
  const dtcHist = profile.history?.dtc || [];
  const reports = profile.reports || [];

  const Spec = ({ l, v }: { l: string; v: any }) =>
    v ? (
      <View style={styles.specCell}>
        <Text style={styles.specLabel}>{l}</Text>
        <Text style={styles.specVal} numberOfLines={2}>{String(v)}</Text>
      </View>
    ) : null;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="profile-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{profile.name}</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <LinearGradient colors={[colors.brandTertiary, colors.surfaceSecondary]} style={styles.hero}>
          <MaterialCommunityIcons name="car-sports" size={44} color={colors.brand} />
          <Text style={styles.heroName}>{profile.year} {profile.make} {profile.model}</Text>
          <Text style={styles.heroTrim}>{[profile.trim, profile.engine, profile.drivetrain].filter(Boolean).join(" · ")}</Text>
          {profile.decode_source ? (
            <View style={styles.confRow}>
              <MaterialCommunityIcons name="shield-check" size={12} color={colors.success} />
              <Text style={styles.confText}>
                {Math.round((profile.decode_confidence || 0) * 100)}% · {String(profile.decode_source).toUpperCase()}
              </Text>
            </View>
          ) : null}
        </LinearGradient>

        {/* Shop-only customer association */}
        {shopGate.hasAccess && (
          <View style={styles.customerCard} testID="customer-card">
            <View style={styles.customerHead}>
              <View style={styles.customerHeadLeft}>
                <MaterialCommunityIcons name="account-wrench" size={16} color={colors.brand} />
                <Text style={styles.customerTitle}>CUSTOMER</Text>
              </View>
              <Pressable testID="edit-customer" style={styles.editChip} onPress={() => { setModal("customer"); setF1(profile.customerName || ""); setF2(profile.customerNotes || ""); }}>
                <MaterialCommunityIcons name="pencil" size={13} color={colors.brand} />
                <Text style={styles.editChipText}>{profile.customerName ? "Edit" : "Assign"}</Text>
              </Pressable>
            </View>
            <Text style={styles.customerName}>{profile.customerName || "Unassigned"}</Text>
            {profile.customerNotes ? <Text style={styles.customerNotes}>{profile.customerNotes}</Text> : null}
          </View>
        )}

        {/* Intelligence action cards */}
        <View style={styles.actionGrid}>
          <ActionCard testID="act-timeline" icon="timeline-text" label="Timeline" onPress={() => router.push(`/timeline?id=${id}`)} />
          <ActionCard testID="act-predictions" icon="calendar-clock" label="Predictions" onPress={() => router.push(`/predictions?id=${id}`)} />
          <ActionCard testID="act-trends" icon="chart-timeline-variant" label="Trends" onPress={() => router.push(`/trends?id=${id}`)} />
          <ActionCard testID="act-repairs" icon="car-wrench" label="Repair Log" onPress={() => router.push(`/repair-log?id=${id}`)} />
          <ActionCard testID="act-report" icon="clipboard-pulse" label="Health Report" onPress={() => router.push(`/health-report?id=${id}`)} />
          <ActionCard testID="act-sessions" icon="chart-line" label="Sessions" onPress={() => router.push(`/recordings?vehicle_id=${id}`)} />
          <ActionCard testID="act-ecu" icon="chip" label="ECU Modules" onPress={() => router.push(`/ecu-modules?id=${id}`)} />
          <ActionCard testID="act-sysmon" icon="monitor-dashboard" label="System Monitor" onPress={() => router.push(`/system-monitor?id=${id}`)} />
          <ActionCard testID="act-scan" icon="radar" label="Advanced Scan" onPress={() => router.push(`/advanced-scan?id=${id}`)} />
        </View>

        {/* Specs */}
        <Text style={styles.sectionTitle}>SPECIFICATIONS</Text>
        <View style={styles.specGrid}>
          <Spec l="VIN" v={profile.vin} />
          <Spec l="BODY STYLE" v={profile.bodyStyle} />
          <Spec l="TRANSMISSION" v={profile.transmission} />
          <Spec l="DRIVETRAIN" v={profile.drivetrain} />
          <Spec l="MANUFACTURER" v={profile.manufacturer} />
          <Spec l="ASSEMBLY PLANT" v={profile.plant} />
        </View>

        {/* Mileage + last scan */}
        <View style={styles.row2}>
          <Pressable testID="edit-mileage" style={styles.statBox} onPress={() => { setModal("mileage"); setF1(String(profile.mileage || "")); }}>
            <Text style={styles.statLabel}>MILEAGE</Text>
            <Text style={styles.statVal}>{profile.mileage ? `${profile.mileage.toLocaleString()} mi` : "Tap to set"}</Text>
          </Pressable>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>LAST SCAN</Text>
            <Text style={styles.statVal}>{profile.last_scan_at ? new Date(profile.last_scan_at).toLocaleDateString() : "—"}</Text>
          </View>
        </View>

        {/* Health history */}
        {health.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>HEALTH SCORE HISTORY</Text>
            <View style={styles.sparkRow} testID="health-history">
              {health.slice(-20).map((h, i) => (
                <View key={i} style={styles.sparkCol}>
                  <View style={[styles.sparkBar, { height: 6 + (h.score / 100) * 56, backgroundColor: h.score >= 80 ? colors.success : h.score >= 65 ? colors.warning : colors.error }]} />
                </View>
              ))}
              <Text style={styles.sparkLast}>{health[health.length - 1].score}</Text>
            </View>
          </>
        )}

        {/* Performance Recorder */}
        <View style={styles.perfHead}>
          <Text style={styles.sectionTitle}>PERFORMANCE</Text>
          <Pressable testID="record-new-session" style={styles.recNewBtn} onPress={() => router.push("/record")}>
            <MaterialCommunityIcons name="record-circle" size={14} color={colors.error} />
            <Text style={styles.recNewText}>Record New</Text>
          </Pressable>
        </View>
        {!perf || perf.count === 0 ? (
          <Text style={styles.dim}>No recorded sessions yet for this vehicle.</Text>
        ) : (
          <>
            <View style={styles.perfStatsRow}>
              {perf.fastest ? <PerfBadge icon="speedometer" label="TOP SPEED" value={`${perf.fastest.maxSpeed} km/h`} /> : null}
              {perf.highestRpm ? <PerfBadge icon="engine" label="PEAK RPM" value={`${perf.highestRpm.peakRpm}`} /> : null}
              <PerfBadge icon="chart-line" label="SESSIONS" value={`${perf.count}`} />
            </View>
            {(perf.recent || []).slice(0, 4).map((r: any) => (
              <Pressable key={r.id} testID={`perf-session-${r.id}`} style={styles.perfRow} onPress={() => router.push(`/playback?id=${r.id}`)}>
                <MaterialCommunityIcons name="chart-bell-curve" size={18} color={colors.brand} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.perfName} numberOfLines={1}>{r.name}</Text>
                  <Text style={styles.perfMeta}>{Math.round(r.duration || 0)}s · {r.distance ?? 0} km · Health {r.health_score ?? "—"}</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={18} color={colors.onSurfaceSecondary} />
              </Pressable>
            ))}
            <Pressable testID="view-all-sessions" style={styles.viewAll} onPress={() => router.push(`/recordings?vehicle_id=${id}`)}>
              <Text style={styles.viewAllText}>View all sessions</Text>
            </Pressable>
          </>
        )}

        {/* Common failure patterns — only curated, vehicle-specific data */}
        <Text style={styles.sectionTitle}>COMMON FAILURE PATTERNS</Text>
        {issues.length === 0 ? (
          <Text style={styles.dim} testID="issues-none">No vehicle-specific failure patterns on record for this platform. Patterns appear here only when we have verified data for your make.</Text>
        ) : (
          <>
            <Text style={styles.issuesProv} testID="issues-prov">Known vehicle-specific patterns for {profile.make}</Text>
            {issues.map((it) => (
              <View key={it.title} style={styles.issue} testID={`issue-${it.title.slice(0, 8)}`}>
                <View style={[styles.likeDot, { backgroundColor: likeColor(it.likelihood) }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.issueTitle}>{it.title}</Text>
                  <Text style={styles.issueSym}>{it.symptoms}</Text>
                  {it.relatedCodes.length > 0 && <Text style={styles.issueCodes}>{it.relatedCodes.join(" · ")}</Text>}
                </View>
              </View>
            ))}
          </>
        )}

        {/* Scan reports */}
        <Text style={styles.sectionTitle}>SCAN HISTORY ({reports.length})</Text>
        {reports.length === 0 ? <Text style={styles.dim}>No linked scan reports yet.</Text> :
          reports.map((r: any) => (
            <View key={r.id} style={styles.histRow}>
              <MaterialCommunityIcons name="file-chart" size={18} color={colors.brand} />
              <Text style={styles.histTitle}>Health {r.health_score ?? "—"} · {r.dtcs?.length || 0} codes</Text>
              <Text style={styles.histDate}>{new Date(r.created_at).toLocaleDateString()}</Text>
            </View>
          ))}

        {/* Maintenance */}
        <SectionAdd title={`MAINTENANCE (${maint.length})`} onAdd={() => setModal("maintenance")} testID="add-maintenance" />
        {maint.map((m: any) => <HistRow key={m.id} icon="wrench" e={m} />)}

        {/* Parts */}
        <SectionAdd title={`PARTS (${parts.length})`} onAdd={() => setModal("parts")} testID="add-parts" />
        {parts.map((p: any) => <HistRow key={p.id} icon="cog" e={p} />)}

        {/* DTC history */}
        {dtcHist.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>DTC HISTORY ({dtcHist.length})</Text>
            {dtcHist.map((d: any) => <HistRow key={d.id} icon="alert-circle" e={d} />)}
          </>
        )}
      </ScrollView>

      {/* Entry modal */}
      <Modal visible={!!modal} transparent animationType="slide" onRequestClose={() => setModal(null)}>
        <Pressable style={styles.backdrop} onPress={() => setModal(null)} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>
              {modal === "mileage" ? "Update Mileage" : modal === "customer" ? "Customer Details" : modal === "maintenance" ? "Add Maintenance" : "Add Part"}
            </Text>
            <TextInput
              testID="entry-f1"
              style={styles.input}
              placeholder={modal === "mileage" ? "Current mileage" : modal === "customer" ? "Customer name" : "Title (e.g. Oil change)"}
              placeholderTextColor={colors.onSurfaceSecondary}
              value={f1}
              onChangeText={setF1}
              keyboardType={modal === "mileage" ? "number-pad" : "default"}
            />
            {modal !== "mileage" && (
              <TextInput
                testID="entry-f2"
                style={[styles.input, { height: 80 }]}
                placeholder={modal === "customer" ? "Customer notes (optional)" : "Details (optional)"}
                placeholderTextColor={colors.onSurfaceSecondary}
                value={f2}
                onChangeText={setF2}
                multiline
              />
            )}
            <Pressable testID="entry-save" style={styles.saveBtn} onPress={submit} disabled={saving || (modal !== "customer" && !f1)}>
              {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>SAVE</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function SectionAdd({ title, onAdd, testID }: { title: string; onAdd: () => void; testID: string }) {
  return (
    <View style={styles.sectionAdd}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Pressable testID={testID} onPress={onAdd} style={styles.addChip}>
        <MaterialCommunityIcons name="plus" size={14} color={colors.brand} />
        <Text style={styles.addChipText}>Add</Text>
      </Pressable>
    </View>
  );
}

function HistRow({ icon, e }: { icon: string; e: any }) {
  return (
    <View style={styles.histRow}>
      <MaterialCommunityIcons name={icon as any} size={18} color={colors.onSurfaceSecondary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.histTitle}>{e.title}</Text>
        {e.detail ? <Text style={styles.histDetail}>{e.detail}</Text> : null}
      </View>
      <Text style={styles.histDate}>{new Date(e.ts).toLocaleDateString()}</Text>
    </View>
  );
}

function PerfBadge({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <View style={styles.perfBadge}>
      <MaterialCommunityIcons name={icon as any} size={18} color={colors.brand} />
      <Text style={styles.perfBadgeVal}>{value}</Text>
      <Text style={styles.perfBadgeLabel}>{label}</Text>
    </View>
  );
}

function ActionCard({ testID, icon, label, onPress }: { testID: string; icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable testID={testID} style={styles.actionCard} onPress={onPress}>
      <MaterialCommunityIcons name={icon as any} size={24} color={colors.brand} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface },
  dim: { color: colors.onSurfaceSecondary, marginHorizontal: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 18, letterSpacing: 1, flex: 1, textAlign: "center" },
  hero: { alignItems: "center", padding: spacing.xl, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, gap: 4 },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  customerCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brand, padding: spacing.md, marginTop: spacing.md },
  customerHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  customerHeadLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  customerTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 1.5, fontWeight: "700" },
  editChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  editChipText: { color: colors.brand, fontWeight: "700", fontSize: 12 },
  customerName: { color: colors.onSurface, fontFamily: font.display, fontSize: 18, marginTop: spacing.sm },
  customerNotes: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 4, lineHeight: 18 },
  actionCard: { flexGrow: 1, flexBasis: "30%", alignItems: "center", gap: 6, paddingVertical: spacing.lg, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  actionLabel: { color: colors.onSurface, fontSize: 12, fontWeight: "600" },
  heroName: { color: colors.onSurface, fontFamily: font.display, fontSize: 24, marginTop: spacing.sm },
  heroTrim: { color: colors.onSurfaceSecondary, fontSize: 13 },
  confRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: spacing.xs },
  confText: { color: colors.success, fontSize: 11, fontWeight: "700" },
  sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 2, fontWeight: "700", marginTop: spacing.xl, marginBottom: spacing.sm },
  specGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  specCell: { flexGrow: 1, flexBasis: "45%", backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  specLabel: { color: colors.onSurfaceSecondary, fontSize: 9, letterSpacing: 1 },
  specVal: { color: colors.onSurface, fontSize: 14, fontWeight: "600", marginTop: 2 },
  row2: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  statBox: { flex: 1, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  statLabel: { color: colors.onSurfaceSecondary, fontSize: 9, letterSpacing: 1 },
  statVal: { color: colors.brand, fontFamily: font.display, fontSize: 20, marginTop: 2 },
  sparkRow: { flexDirection: "row", alignItems: "flex-end", gap: 3, height: 70, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  sparkCol: { flex: 1, justifyContent: "flex-end", alignItems: "center" },
  sparkBar: { width: "80%", borderRadius: 2 },
  sparkLast: { color: colors.onSurface, fontFamily: font.display, fontSize: 18, marginLeft: spacing.sm },
  issue: { flexDirection: "row", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  likeDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  issueTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  issuesProv: { color: colors.onSurfaceSecondary, fontSize: 11, marginHorizontal: spacing.lg, marginBottom: spacing.sm, fontStyle: "italic" },
  issueSym: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 2 },
  issueCodes: { color: colors.brand, fontSize: 12, marginTop: 4, fontFamily: font.display },
  sectionAdd: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  addChip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5, marginBottom: spacing.sm },
  addChipText: { color: colors.brand, fontWeight: "700", fontSize: 12 },
  histRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  histTitle: { color: colors.onSurface, fontSize: 14, flex: 1 },
  histDetail: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 1 },
  histDate: { color: colors.onSurfaceSecondary, fontSize: 11 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, borderTopWidth: 1, borderColor: colors.border },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, marginBottom: spacing.md },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.lg, paddingVertical: 14, marginBottom: spacing.md, fontSize: 15 },
  saveBtn: { backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 16, alignItems: "center" },
  saveText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 1.5 },
  perfHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
  recNewBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.error, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5, marginBottom: spacing.sm },
  recNewText: { color: colors.error, fontWeight: "700", fontSize: 12 },
  perfStatsRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  perfBadge: { flex: 1, alignItems: "center", gap: 2, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: spacing.md },
  perfBadgeVal: { color: colors.brand, fontFamily: font.display, fontSize: 18 },
  perfBadgeLabel: { color: colors.onSurfaceSecondary, fontSize: 9, letterSpacing: 0.8 },
  perfRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.xs },
  perfName: { color: colors.onSurface, fontSize: 14 },
  perfMeta: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 1 },
  viewAll: { alignItems: "center", paddingVertical: spacing.sm },
  viewAllText: { color: colors.brand, fontSize: 13, fontWeight: "600" },
});
