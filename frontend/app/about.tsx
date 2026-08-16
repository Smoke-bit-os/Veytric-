import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import Constants from "expo-constants";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAuth } from "@/src/auth";
import { useLicense } from "@/src/licensing/LicenseProvider";
import { useAI } from "@/src/ai/aiContext";
import { devMode } from "@/src/dev/devMode";
import { TIER_LABELS, TIER_ACCENT } from "@/src/licensing/licenseConstants";
import { colors, font, radius, spacing } from "@/src/theme";

const APP_VERSION = Constants.expoConfig?.version || "1.0.0";

export default function AboutScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, provider } = useAuth();
  const { tier, status, trialDaysRemaining } = useLicense();
  const ai = useAI();
  const [taps, setTaps] = useState(0);
  const [unlocked, setUnlocked] = useState(false);

  useFocusEffect(useCallback(() => {
    devMode.isUnlocked().then(setUnlocked);
  }, []));

  const tapVersion = async () => {
    if (!devMode.isAvailable() || unlocked) return;
    const n = taps + 1;
    setTaps(n);
    if (n >= 7) {
      await devMode.unlock();
      setUnlocked(true);
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="about-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>SETTINGS · ABOUT</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }}>
        <View style={styles.brandWrap}>
          <View style={styles.logo}><MaterialCommunityIcons name="robot" size={40} color={colors.brand} /></View>
          <Text style={styles.brand}>JARVIS Auto AI</Text>
          <Text style={styles.tagline}>Automotive Command Center</Text>
        </View>

        {/* Account */}
        <Text style={styles.sectionTitle}>ACCOUNT</Text>
        <View style={styles.card}>
          <Row label="Name" value={user?.name || "—"} />
          <Row label="Email" value={user?.email || (provider === "guest" ? "Guest session" : "—")} />
          <Row label="Sign-in" value={(provider || "—").toString()} />
        </View>

        {/* Membership */}
        <Text style={styles.sectionTitle}>MEMBERSHIP</Text>
        <Pressable testID="about-membership" style={styles.card} onPress={() => router.push("/upgrade")}>
          <View style={styles.memRow}>
            <MaterialCommunityIcons name={tier === "free" ? "car" : "crown"} size={22} color={TIER_ACCENT[tier]} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={[styles.memPlan, { color: TIER_ACCENT[tier] }]}>{TIER_LABELS[tier]}</Text>
              <Text style={styles.memSub}>
                {status === "trial" ? `Trial · ${trialDaysRemaining} days left` : status === "grace" ? "Grace period" : status === "expired" ? "Expired" : tier === "free" ? "Tap to explore Pro" : "Active"}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceSecondary} />
          </View>
        </Pressable>

        {/* Preferences */}
        <Text style={styles.sectionTitle}>PREFERENCES</Text>
        <Pressable testID="about-ai-engine" style={styles.card} onPress={() => router.push("/ai-settings")}>
          <View style={styles.memRow}>
            <MaterialCommunityIcons name="robot-outline" size={22} color={colors.brand} />
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={styles.memPlan2}>Artificial Intelligence</Text>
              <Text style={styles.memSub}>{ai.providerName}</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceSecondary} />
          </View>
        </Pressable>

        {/* App info */}
        <Text style={styles.sectionTitle}>APP</Text>
        <View style={styles.card}>
          <Pressable testID="about-version" onPress={tapVersion}>
            <Row label="Version" value={APP_VERSION} />
          </Pressable>
          <Row label="Build" value={devMode.isAvailable() ? "development" : "production"} />
        </View>

        {taps > 0 && !unlocked && taps < 7 && (
          <Text style={styles.hint}>{7 - taps} more tap{7 - taps === 1 ? "" : "s"}…</Text>
        )}
        {unlocked && (
          <>
            <Text style={styles.devUnlocked}>● Developer Mode unlocked</Text>
            <Pressable testID="about-developer" style={styles.devBtn} onPress={() => router.push("/developer")}>
              <MaterialCommunityIcons name="dev-to" size={18} color={colors.warning} />
              <Text style={styles.devBtnText}>Developer Options</Text>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.onSurfaceSecondary} style={{ marginLeft: "auto" }} />
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1.2 },
  brandWrap: { alignItems: "center", paddingVertical: spacing.lg },
  logo: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.brand, alignItems: "center", justifyContent: "center" },
  brand: { color: colors.onSurface, fontFamily: font.display, fontSize: 28, letterSpacing: 2, marginTop: spacing.md },
  tagline: { color: colors.onSurfaceSecondary, fontSize: 12 },
  sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 2, fontWeight: "700", marginTop: spacing.xl, marginBottom: spacing.sm },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
  rowLabel: { color: colors.onSurfaceSecondary, fontSize: 14 },
  rowValue: { color: colors.onSurface, fontSize: 14, fontWeight: "600", maxWidth: "60%", textTransform: "capitalize" },
  memRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.lg },
  memPlan: { fontFamily: font.display, fontSize: 20 },
  memPlan2: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  memSub: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 1 },
  hint: { color: colors.onSurfaceSecondary, fontSize: 12, textAlign: "center", marginTop: spacing.md },
  devUnlocked: { color: colors.success, fontSize: 13, fontWeight: "700", textAlign: "center", marginTop: spacing.lg },
  devBtn: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.warning, padding: spacing.lg, marginTop: spacing.sm },
  devBtnText: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
});
