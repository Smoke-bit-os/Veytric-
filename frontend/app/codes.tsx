import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useVehicle } from "@/src/vehicle/service";
import { useAuth } from "@/src/auth";
import { api } from "@/src/api";
import { confirmDialog, alertDialog } from "@/src/utils/dialog";
import {
  runCodesRead,
  CodeStatus,
  CodesView,
  CodesSnapshot,
} from "@/src/orchestrator";
import type { Dtc } from "@/src/vehicle/types";
import Dropdown from "@/src/components/Dropdown";
import { colors, font, radius, spacing } from "@/src/theme";

// Distinct, non-conflated classifications (spec: stored/pending/permanent/…).
const STATUS_META: Record<CodeStatus, { label: string; color: string }> = {
  [CodeStatus.CURRENT]: { label: "CURRENT", color: colors.error },
  [CodeStatus.PENDING]: { label: "PENDING", color: colors.warning },
  [CodeStatus.PERMANENT]: { label: "PERMANENT", color: colors.info },
  [CodeStatus.MANUFACTURER]: { label: "MANUFACTURER", color: colors.brand },
  [CodeStatus.STORED]: { label: "STORED", color: colors.onSurfaceSecondary },
};
const STATUS_ORDER: CodeStatus[] = [
  CodeStatus.CURRENT, CodeStatus.PENDING, CodeStatus.PERMANENT,
  CodeStatus.MANUFACTURER, CodeStatus.STORED,
];

const FRESHNESS_COLOR: Record<string, string> = {
  LIVE: colors.success,
  RECENT: colors.info,
  STALE: colors.warning,
  HISTORICAL: colors.onSurfaceSecondary,
  UNKNOWN: colors.onSurfaceSecondary,
};

export default function CodesPage() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const {
    dtcs, clearDtcs, refreshDtcs, hasLiveData, identity,
    mode, getStatusReport, adapter,
  } = useVehicle();

  const [view, setView] = useState<CodesView | null>(null);
  const [busy, setBusy] = useState<"read" | "clear" | null>(null);
  const [lastScan, setLastScan] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const buildSnapshot = useCallback(
    (codes: Dtc[]): CodesSnapshot => {
      const status = getStatusReport?.();
      return {
        userId: user?.id || "anon",
        vehicleId: null, // server derives ownership; no client-supplied vehicle link here
        sessionId: null,
        mode: mode === "ble" ? "ble" : "simulation",
        ecuCommunication: !!status?.ecuCommunication,
        protocol: status?.protocol || adapter?.protocol || "Unknown",
        vin: identity?.vin ?? null,
        dtcs: codes.map((d) => ({ code: d.code, desc: d.desc, type: d.type })),
        platform: Platform.OS === "web" ? "web" : Platform.OS === "ios" ? "ios" : "android",
        isDev: __DEV__,
      };
    },
    [user?.id, mode, getStatusReport, adapter?.protocol, identity?.vin]
  );

  // Best-effort persistence of a MEASURED read to the backend (Prompt 2 2B).
  // Never blocks or breaks the UI; simulated data is never persisted.
  const persist = useCallback(async (v: CodesView) => {
    if (v.mode !== "MEASURED") return;
    try {
      const session = await api.createDiagnosticSession({ label: "Codes read" });
      const task = await api.createDiagnosticTask(session.id, {
        task_type: "READ_VEHICLE_EVIDENCE", required_capability: "vehicle.read_dtcs",
      });
      for (const to of ["VALIDATING", "ACQUIRING_EVIDENCE", "NORMALIZING", "COMPLETED"]) {
        await api.transitionDiagnosticTask(session.id, task.id, { to_state: to });
      }
      await api.putTaskEnvelope(session.id, task.id, {
        schema_version: 1,
        generated_at: Date.now(),
        task: { requested: "READ_VEHICLE_EVIDENCE" },
        records: v.items.map((i) => ({
          evidenceId: `dtc_${i.code}`, provenanceLabel: "MEASURED",
          decodedName: `DTC ${i.code}`, displayValue: i.code,
          decodedUnit: i.status, freshness: i.freshness,
        })),
        unavailable_items: [],
      });
    } catch {
      /* best-effort — persistence failure never affects on-screen results */
    }
  }, []);

  const derive = useCallback(
    async (codes: Dtc[]) => {
      const v = await runCodesRead(buildSnapshot(codes));
      setView(v);
      return v;
    },
    [buildSnapshot]
  );

  // Initial derivation from whatever the engine already read on connect.
  useEffect(() => {
    if (hasLiveData) derive(dtcs);
    else setView(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLiveData]);

  const read = async () => {
    setBusy("read");
    try {
      const codes = await refreshDtcs(); // real Mode 03/07 through the engine
      const v = await derive(codes);
      setLastScan(new Date().toLocaleString());
      persist(v);
    } catch (e: any) {
      alertDialog("Read Codes", e?.message || "Unable to read trouble codes — connect to the vehicle.");
    }
    setBusy(null);
  };

  const confirmClear = () => {
    confirmDialog({
      title: "Clear Codes?",
      message:
        "Clearing codes ERASES stored trouble codes and turns off the check-engine light — it does NOT repair the underlying problem. VEYTRIC will run a post-clear rescan to verify which codes actually remain. Continue?",
      confirmText: "Clear Codes",
      destructive: true,
      onConfirm: doClear,
    });
  };

  const doClear = async () => {
    setBusy("clear");
    try {
      // Real Mode 04, then the engine re-reads. We treat the clear as PENDING
      // until this post-clear rescan tells us which codes truly remain.
      const remaining = await clearDtcs();
      const v = await derive(remaining);
      setLastScan(new Date().toLocaleString());
      persist(v);
      if (remaining.length === 0) {
        alertDialog("Codes Cleared", "The clear command succeeded and no trouble codes remain after re-scanning.");
      } else {
        alertDialog(
          "Codes Still Present",
          `The clear command was sent, but ${remaining.length} code(s) returned immediately after re-scanning — this usually means the fault is still active.`
        );
      }
    } catch (e: any) {
      alertDialog("Clear Failed", e?.message || "The vehicle did not confirm the clear command. No codes were reported as cleared.");
    }
    setBusy(null);
  };

  const items = view?.items ?? [];
  const groups = STATUS_ORDER.reduce((acc, s) => {
    acc[s] = items.filter((i) => i.status === s);
    return acc;
  }, {} as Record<CodeStatus, typeof items>);

  const isRealDisconnected = !hasLiveData || view?.mode === "DISCONNECTED" || view?.mode === "UNAVAILABLE";

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="codes-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>CODES</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }}>
        {isRealDisconnected ? (
          <View style={styles.noData} testID="codes-no-live">
            <MaterialCommunityIcons name="engine-off-outline" size={40} color={colors.onSurfaceSecondary} />
            <Text style={styles.noDataTitle}>
              {view?.mode === "DISCONNECTED" ? "No live vehicle connection" : "Trouble codes unavailable"}
            </Text>
            <Text style={styles.noDataSub}>
              {view?.reason
                ? String(view.reason)
                : "Connect an OBD-II adapter to read real trouble codes from your vehicle. VEYTRIC never shows cached or simulated codes as live results."}
            </Text>
            <Pressable testID="codes-connect" style={styles.btnOutline} onPress={() => router.push("/connect")}>
              <Text style={styles.btnOutlineText}>OPEN CONNECTION CENTER</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Provenance banner — how the codes below were sourced. */}
            {view ? (
              <View
                testID="codes-provenance-banner"
                style={[
                  styles.banner,
                  {
                    backgroundColor: view.isLiveEvidence ? colors.brandTertiary : colors.surfaceTertiary,
                    borderColor: view.isLiveEvidence ? colors.success : colors.warning,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={view.isLiveEvidence ? "shield-check" : "flask-outline"}
                  size={18}
                  color={view.isLiveEvidence ? colors.success : colors.warning}
                />
                <Text style={[styles.bannerText, { color: view.isLiveEvidence ? colors.success : colors.warning }]}>
                  {view.bannerLabel}
                </Text>
              </View>
            ) : null}

            <View style={styles.actionRow}>
              <Pressable testID="codes-read" style={styles.readBtn} onPress={read} disabled={busy != null}>
                {busy === "read" ? <ActivityIndicator color={colors.brand} /> : <MaterialCommunityIcons name="magnify-scan" size={18} color={colors.brand} />}
                <Text style={styles.readText}>Read Codes</Text>
              </Pressable>
              <Pressable testID="codes-clear" style={styles.clearBtn} onPress={confirmClear} disabled={busy != null || items.length === 0}>
                {busy === "clear" ? <ActivityIndicator color={colors.onBrandPrimary} /> : <MaterialCommunityIcons name="delete-sweep" size={18} color={colors.onBrandPrimary} />}
                <Text style={styles.clearText}>Clear Codes</Text>
              </Pressable>
            </View>

            {busy === "clear" ? (
              <Text testID="codes-pending" style={styles.pendingText}>Clear sent — awaiting post-clear rescan to verify remaining codes…</Text>
            ) : lastScan ? (
              <Text style={styles.scanCtx}>Last scan: {lastScan}{identity?.vin ? ` · VIN ${identity.vin}` : ""}</Text>
            ) : null}

            {items.length > 0 ? (
              <View style={styles.filterWrap}>
                <Dropdown
                  testID="codes-status-filter"
                  label="Filter by status"
                  searchable={false}
                  options={[
                    { label: `All codes (${items.length})`, value: "all" },
                    ...STATUS_ORDER.filter((s) => groups[s].length).map((s) => ({
                      label: `${STATUS_META[s].label} (${groups[s].length})`,
                      value: s,
                    })),
                  ]}
                  value={statusFilter}
                  onChange={setStatusFilter}
                />
              </View>
            ) : null}

            {items.length === 0 ? (
              <View style={styles.clean} testID="codes-none">
                <MaterialCommunityIcons name="check-circle" size={40} color={colors.success} />
                <Text style={styles.cleanText}>No trouble codes detected</Text>
              </View>
            ) : (
              STATUS_ORDER.filter((g) => statusFilter === "all" || statusFilter === g).map((g) =>
                groups[g].length ? (
                  <View key={g} style={{ marginTop: spacing.lg }}>
                    <Text style={[styles.groupTitle, { color: STATUS_META[g].color }]}>
                      {STATUS_META[g].label} ({groups[g].length})
                    </Text>
                    {groups[g].map((d, i) => (
                      <Pressable
                        key={`${d.code}-${i}`}
                        testID={`code-${d.code}`}
                        style={styles.codeCard}
                        onPress={() => router.push(`/guided-repair?code=${encodeURIComponent(d.code)}&desc=${encodeURIComponent(d.desc || "")}`)}
                      >
                        <View style={[styles.codeDot, { backgroundColor: STATUS_META[g].color }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.codeNum}>{d.code}</Text>
                          <Text style={styles.codeDesc}>{d.desc}</Text>
                          <View style={styles.chipRow}>
                            <View style={[styles.chip, { borderColor: colors.borderStrong }]}>
                              <Text style={styles.chipText}>{d.provenance}</Text>
                            </View>
                            <View style={[styles.chip, { borderColor: FRESHNESS_COLOR[d.freshness] || colors.border }]}>
                              <MaterialCommunityIcons
                                name={d.presentedAsLive ? "circle" : "circle-outline"}
                                size={8}
                                color={FRESHNESS_COLOR[d.freshness] || colors.onSurfaceSecondary}
                              />
                              <Text style={[styles.chipText, { color: FRESHNESS_COLOR[d.freshness] || colors.onSurfaceSecondary }]}>
                                {d.freshness}
                              </Text>
                            </View>
                          </View>
                        </View>
                        <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceSecondary} />
                      </Pressable>
                    ))}
                  </View>
                ) : null
              )
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1.2 },
  banner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 10, marginBottom: spacing.md },
  bannerText: { fontSize: 12, fontWeight: "700", letterSpacing: 0.4, flex: 1 },
  actionRow: { flexDirection: "row", gap: spacing.sm },
  readBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  readText: { color: colors.brand, fontWeight: "700" },
  clearBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 48, borderRadius: radius.md, backgroundColor: colors.error },
  clearText: { color: colors.onBrandPrimary, fontWeight: "700" },
  scanCtx: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: spacing.sm },
  pendingText: { color: colors.warning, fontSize: 12, marginTop: spacing.sm, fontWeight: "600" },
  filterWrap: { marginTop: spacing.lg },
  groupTitle: { fontSize: 12, letterSpacing: 1.5, fontWeight: "700", marginBottom: spacing.sm },
  codeCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  codeDot: { width: 10, height: 10, borderRadius: 5 },
  codeNum: { color: colors.onSurface, fontFamily: font.display, fontSize: 16 },
  codeDesc: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  chipRow: { flexDirection: "row", gap: 6, marginTop: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
  chipText: { color: colors.onSurfaceSecondary, fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  clean: { alignItems: "center", paddingVertical: spacing["2xl"], gap: spacing.sm },
  cleanText: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  noData: { alignItems: "center", padding: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  noDataTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 16, marginTop: spacing.sm },
  noDataSub: { color: colors.onSurfaceSecondary, fontSize: 13, textAlign: "center" },
  btnOutline: { marginTop: spacing.md, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  btnOutlineText: { color: colors.brand, fontWeight: "700", letterSpacing: 1, fontSize: 12 },
});
