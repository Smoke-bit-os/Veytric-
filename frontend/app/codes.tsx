import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useVehicle } from "@/src/vehicle/service";
import { colors, font, radius, spacing } from "@/src/theme";

const STATUS_META: Record<string, { label: string; color: string }> = {
  current: { label: "CURRENT", color: colors.error },
  pending: { label: "PENDING", color: colors.warning },
  history: { label: "HISTORY", color: colors.onSurfaceSecondary },
};

export default function CodesPage() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { dtcs, clearDtcs, refreshDtcs, hasLiveData, connection, identity } = useVehicle();
  const [busy, setBusy] = useState<"read" | "clear" | null>(null);
  const [lastScan, setLastScan] = useState<string>("");

  const groups = {
    current: dtcs.filter((d) => d.type === "current" || d.type === "confirmed" || !d.type),
    pending: dtcs.filter((d) => d.type === "pending"),
    history: dtcs.filter((d) => d.type === "history" || d.type === "stored"),
  };

  const read = async () => {
    setBusy("read");
    try {
      await refreshDtcs();
      setLastScan(new Date().toLocaleString());
    } catch (e: any) {
      Alert.alert("Read Codes", e?.message || "Unable to read trouble codes — connect to the vehicle.");
    }
    setBusy(null);
  };

  const confirmClear = () => {
    Alert.alert(
      "Clear Codes?",
      "Clearing codes ERASES stored trouble codes and turns off the check-engine light — it does NOT repair the underlying problem. If the fault is still present, codes will return. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear Codes", style: "destructive", onPress: doClear },
      ]
    );
  };

  const doClear = async () => {
    setBusy("clear");
    try {
      const remaining = await clearDtcs(); // real Mode 04 + automatic re-scan
      setLastScan(new Date().toLocaleString());
      if (remaining.length === 0) {
        Alert.alert("Codes Cleared", "The clear command succeeded and no trouble codes remain after re-scanning.");
      } else {
        Alert.alert(
          "Codes Still Present",
          `The clear command was sent, but ${remaining.length} code(s) returned immediately — this usually means the fault is still active.`
        );
      }
    } catch (e: any) {
      Alert.alert("Clear Failed", e?.message || "The vehicle did not confirm the clear command. No codes were reported as cleared.");
    }
    setBusy(null);
  };

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
        {!hasLiveData ? (
          <View style={styles.noData} testID="codes-no-live">
            <MaterialCommunityIcons name="engine-off-outline" size={40} color={colors.onSurfaceSecondary} />
            <Text style={styles.noDataTitle}>Unable to read trouble codes</Text>
            <Text style={styles.noDataSub}>Connect an OBD-II adapter to read real trouble codes from your vehicle.</Text>
            <Pressable testID="codes-connect" style={styles.btnOutline} onPress={() => router.push("/connect")}>
              <Text style={styles.btnOutlineText}>OPEN CONNECTION CENTER</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.actionRow}>
              <Pressable testID="codes-read" style={styles.readBtn} onPress={read} disabled={busy != null}>
                {busy === "read" ? <ActivityIndicator color={colors.brand} /> : <MaterialCommunityIcons name="magnify-scan" size={18} color={colors.brand} />}
                <Text style={styles.readText}>Read Codes</Text>
              </Pressable>
              <Pressable testID="codes-clear" style={styles.clearBtn} onPress={confirmClear} disabled={busy != null || dtcs.length === 0}>
                {busy === "clear" ? <ActivityIndicator color={colors.onBrandPrimary} /> : <MaterialCommunityIcons name="delete-sweep" size={18} color={colors.onBrandPrimary} />}
                <Text style={styles.clearText}>Clear Codes</Text>
              </Pressable>
            </View>
            {lastScan ? <Text style={styles.scanCtx}>Last scan: {lastScan}{identity?.vin ? ` · VIN ${identity.vin}` : ""}</Text> : null}

            {dtcs.length === 0 ? (
              <View style={styles.clean} testID="codes-none">
                <MaterialCommunityIcons name="check-circle" size={40} color={colors.success} />
                <Text style={styles.cleanText}>No trouble codes detected</Text>
              </View>
            ) : (
              (["current", "pending", "history"] as const).map((g) =>
                groups[g].length ? (
                  <View key={g} style={{ marginTop: spacing.lg }}>
                    <Text style={[styles.groupTitle, { color: STATUS_META[g].color }]}>{STATUS_META[g].label} ({groups[g].length})</Text>
                    {groups[g].map((d, i) => (
                      <Pressable
                        key={`${d.code}-${i}`}
                        testID={`code-${d.code}`}
                        style={styles.codeCard}
                        onPress={() => Alert.alert(d.code, d.desc || "Manufacturer-specific code. Guided Repairs (step-by-step help) is coming next.")}
                      >
                        <View style={[styles.codeDot, { backgroundColor: STATUS_META[g].color }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.codeNum}>{d.code}</Text>
                          <Text style={styles.codeDesc}>{d.desc || "Manufacturer-specific code"}</Text>
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
  actionRow: { flexDirection: "row", gap: spacing.sm },
  readBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  readText: { color: colors.brand, fontWeight: "700" },
  clearBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, height: 48, borderRadius: radius.md, backgroundColor: colors.error },
  clearText: { color: colors.onBrandPrimary, fontWeight: "700" },
  scanCtx: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: spacing.sm },
  groupTitle: { fontSize: 12, letterSpacing: 1.5, fontWeight: "700", marginBottom: spacing.sm },
  codeCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  codeDot: { width: 10, height: 10, borderRadius: 5 },
  codeNum: { color: colors.onSurface, fontFamily: font.display, fontSize: 16 },
  codeDesc: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  clean: { alignItems: "center", paddingVertical: spacing["2xl"], gap: spacing.sm },
  cleanText: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  noData: { alignItems: "center", padding: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  noDataTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 16, marginTop: spacing.sm },
  noDataSub: { color: colors.onSurfaceSecondary, fontSize: 13, textAlign: "center" },
  btnOutline: { marginTop: spacing.md, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  btnOutlineText: { color: colors.brand, fontWeight: "700", letterSpacing: 1, fontSize: 12 },
});
