import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { useLicense } from "@/src/licensing/LicenseProvider";
import { usePurchases } from "@/src/subscriptions/PurchasesProvider";
import { devMode, DEV_LICENSE_ACTIONS } from "@/src/dev/devMode";
import { licenseCache } from "@/src/licensing/licenseCache";
import { storage } from "@/src/utils/storage";
import { TOKEN_KEY } from "@/src/api";
import { LICENSE_CACHE_KEY } from "@/src/licensing/licenseConstants";
import { colors, font, radius, spacing } from "@/src/theme";

export default function DeveloperScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, provider, isGuest } = useAuth();
  const { entitlement, offline, developerSet, clearCache } = useLicense();
  const purchases = usePurchases();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<any>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) Alert.alert("Done", done);
    } catch (e: any) {
      Alert.alert("Error", e?.message || "Action failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="dev-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>DEVELOPER OPTIONS</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }}>
        <View style={styles.warnBanner}>
          <MaterialCommunityIcons name="alert" size={16} color={colors.warning} />
          <Text style={styles.warnText}>Development-only tools. Hidden in production builds.</Text>
        </View>

        {/* Licensing simulations */}
        <Text style={styles.sectionTitle}>LICENSING</Text>
        <View style={styles.grid}>
          {DEV_LICENSE_ACTIONS.map((a) => (
            <Pressable
              key={a.action}
              testID={`dev-license-${a.action}`}
              style={styles.gridBtn}
              onPress={() => run(a.action, () => developerSet(a.action))}
            >
              <Text style={styles.gridBtnText}>{a.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Subscriptions */}
        <Text style={styles.sectionTitle}>SUBSCRIPTIONS</Text>
        <Action testID="dev-restore" icon="restore" label="Restore Purchases" busy={busy === "restore"} onPress={() => run("restore", async () => {
          const r = await purchases.restorePurchases(); Alert.alert("Restore", r?.message || "Done");
        })} />
        <Action testID="dev-clear-license" icon="delete-sweep" label="Clear License Cache" busy={busy === "lic"} onPress={() => run("lic", () => clearCache(), "License cache cleared")} />

        {/* Storage */}
        <Text style={styles.sectionTitle}>STORAGE</Text>
        <Action testID="dev-clear-async" icon="database-remove" label="Clear AsyncStorage" busy={busy === "async"} onPress={() => run("async", () => AsyncStorage.clear(), "AsyncStorage cleared")} />
        <Action testID="dev-clear-secure" icon="shield-remove" label="Clear SecureStore (tokens + license)" busy={busy === "secure"} onPress={() => run("secure", async () => {
          await storage.secureRemove(TOKEN_KEY);
          await storage.secureRemove(LICENSE_CACHE_KEY);
          await licenseCache.clear();
        }, "SecureStore cleared")} />

        {/* Diagnostics */}
        <Text style={styles.sectionTitle}>DIAGNOSTICS</Text>
        <View style={styles.card}>
          <KV k="Environment" v={devMode.isAvailable() ? "development" : "production"} />
          <KV k="Auth provider" v={(provider || "none").toString()} />
          <KV k="Is guest" v={isGuest ? "yes" : "no"} />
          <KV k="User id" v={(user as any)?.id || "—"} />
          <KV k="Billing provider" v={purchases.name} />
          <KV k="Offline" v={offline ? "yes" : "no"} />
          <KV k="Effective tier" v={entitlement.tier} />
          <KV k="Status" v={entitlement.status} />
          <KV k="Trial used" v={entitlement.trialUsed ? "yes" : "no"} />
          <KV k="Trial days left" v={String(entitlement.trialDaysRemaining)} />
          <KV k="In grace" v={entitlement.inGrace ? "yes" : "no"} />
          <KV k="Cached at" v={entitlement._cachedAt ? new Date(entitlement._cachedAt).toLocaleString() : "—"} last />
        </View>

        {/* Lock */}
        <Text style={styles.sectionTitle}>SESSION</Text>
        <Action testID="dev-relock" icon="lock" label="Re-lock Developer Mode" busy={false} onPress={() => run("relock", async () => { await devMode.relock(); router.back(); })} />
      </ScrollView>
    </View>
  );
}

function Action({ testID, icon, label, busy, onPress }: any) {
  return (
    <Pressable testID={testID} style={styles.action} onPress={onPress} disabled={busy}>
      <MaterialCommunityIcons name={icon} size={20} color={busy ? colors.onSurfaceSecondary : colors.brand} />
      <Text style={styles.actionText}>{label}</Text>
    </Pressable>
  );
}

function KV({ k, v, last }: { k: string; v: string; last?: boolean }) {
  return (
    <View style={[styles.kv, last && { borderBottomWidth: 0 }]}>
      <Text style={styles.kvK}>{k}</Text>
      <Text style={styles.kvV}>{v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1.2 },
  warnBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(255,179,0,0.1)", borderRadius: radius.sm, borderWidth: 1, borderColor: colors.warning, padding: spacing.md },
  warnText: { color: colors.warning, fontSize: 12, flex: 1 },
  sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 2, fontWeight: "700", marginTop: spacing.xl, marginBottom: spacing.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  gridBtn: { width: "48%", backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingVertical: 14, alignItems: "center" },
  gridBtnText: { color: colors.onSurface, fontSize: 13, fontWeight: "600" },
  action: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.sm },
  actionText: { color: colors.onSurface, fontSize: 14, fontWeight: "600" },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg },
  kv: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  kvK: { color: colors.onSurfaceSecondary, fontSize: 13 },
  kvV: { color: colors.onSurface, fontSize: 13, fontWeight: "600", textTransform: "capitalize" },
});
