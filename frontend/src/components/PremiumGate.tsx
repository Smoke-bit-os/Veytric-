import React from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { FEATURE_MAP } from "@/src/licensing/featureRegistry";
import { useEntitlement } from "@/src/licensing/LicenseProvider";
import { TIER_LABELS, TIER_ACCENT } from "@/src/licensing/licenseConstants";
import { colors, font, radius, spacing } from "@/src/theme";

// Full-screen contextual gate. Rendered by a premium screen when the current
// tier lacks access. Explains the feature, the required plan, and offers a
// non-nagging upgrade path while letting the user go back to the free app.

export default function PremiumGate({ feature }: { feature: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { requiredTier } = useEntitlement(feature);
  const def = FEATURE_MAP[feature];
  const accent = TIER_ACCENT[requiredTier];

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="gate-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>{def?.label?.toUpperCase() || "PREMIUM"}</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={[styles.lockCircle, { borderColor: accent }]}>
          <MaterialCommunityIcons name="lock" size={44} color={accent} />
        </View>

        <Text style={styles.feature}>{def?.label || "Premium Feature"}</Text>
        <Text style={styles.desc}>{def?.description || "This feature requires an upgrade."}</Text>

        <View style={[styles.badge, { borderColor: accent }]} testID="gate-required-tier">
          <MaterialCommunityIcons name="crown" size={14} color={accent} />
          <Text style={[styles.badgeText, { color: accent }]}>
            Included in {TIER_LABELS[requiredTier]}
          </Text>
        </View>

        <Pressable testID="gate-upgrade" style={styles.cta} onPress={() => router.push("/upgrade")}>
          <LinearGradient colors={[colors.brand, colors.brandSecondary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.ctaGrad}>
            <Text style={styles.ctaText}>UPGRADE NOW</Text>
          </LinearGradient>
        </Pressable>

        <Pressable testID="gate-continue" style={styles.secondary} onPress={() => router.back()}>
          <Text style={styles.secondaryText}>Continue with Free</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1.2 },
  body: { alignItems: "center", padding: spacing.xl, paddingTop: spacing["2xl"] },
  lockCircle: { width: 100, height: 100, borderRadius: 50, borderWidth: 2, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary, marginBottom: spacing.xl },
  feature: { color: colors.onSurface, fontFamily: font.display, fontSize: 26, textAlign: "center" },
  desc: { color: colors.onSurfaceSecondary, fontSize: 14, textAlign: "center", marginTop: spacing.sm, lineHeight: 20, paddingHorizontal: spacing.md },
  badge: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7, marginTop: spacing.xl },
  badgeText: { fontWeight: "800", fontSize: 13, letterSpacing: 0.5 },
  cta: { width: "100%", borderRadius: radius.md, overflow: "hidden", marginTop: spacing["2xl"] },
  ctaGrad: { paddingVertical: 16, alignItems: "center" },
  ctaText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 1.5, fontSize: 14 },
  secondary: { marginTop: spacing.lg, padding: spacing.md },
  secondaryText: { color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: "600" },
});
