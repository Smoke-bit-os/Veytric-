import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useLicense } from "@/src/licensing/LicenseProvider";
import { usePurchases } from "@/src/subscriptions/PurchasesProvider";
import { FEATURES, COMPARISON_CATEGORIES } from "@/src/licensing/featureRegistry";
import { PRICING, TIER_LABELS, TIER_ACCENT, TIER_RANK } from "@/src/licensing/licenseConstants";
import { Tier } from "@/src/licensing/licenseTypes";
import { colors, font, radius, spacing } from "@/src/theme";

const PLANS: { tier: Tier; tagline: string; icon: string }[] = [
  { tier: "free", tagline: "The essentials to get connected", icon: "car" },
  { tier: "pro", tagline: "Full diagnostics, AI & performance", icon: "crown" },
  { tier: "shop", tagline: "Multi-vehicle tools for professionals", icon: "store" },
];

const FAQ = [
  { q: "What happens when my trial ends?", a: "You keep all your data and automatically move to the Free tier. Upgrade any time to unlock Pro features again." },
  { q: "Can I cancel anytime?", a: "Yes. Your plan stays active until the end of the billing period, then downgrades to Free." },
  { q: "Do I lose my vehicles if I downgrade?", a: "Never. All vehicles, recordings and history are preserved — some premium views simply become read-only." },
];

export default function UpgradeScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tier, status, trialDaysRemaining, trialUsed, inGrace, offline, startTrial, restore, refresh } = useLicense();
  const purchases = usePurchases();
  const [busy, setBusy] = useState<string | null>(null);
  const [period, setPeriod] = useState<"monthly" | "annual">("monthly");

  const doUpgrade = async (target: Tier) => {
    setBusy(target);
    try {
      const res = await purchases.purchasePlan(target, period);
      if (res.success) {
        await refresh();
        Alert.alert("Upgraded", `You're now on ${TIER_LABELS[target]}.`);
      } else if (!res.cancelled) {
        Alert.alert("Purchase unavailable", res.error || "Please try again later.");
      }
    } finally {
      setBusy(null);
    }
  };

  const doTrial = async () => {
    setBusy("trial");
    const res = await startTrial();
    setBusy(null);
    if (!res.ok) Alert.alert("Trial unavailable", res.error || "Could not start trial.");
    else Alert.alert("Trial started", "Your 30-day JARVIS Pro trial is active.");
  };

  const doRestore = async () => {
    setBusy("restore");
    const res = await restore();
    setBusy(null);
    Alert.alert(res.configured ? "Restored" : "Not configured", res.message || "");
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="upgrade-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="close" size={26} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>JARVIS MEMBERSHIP</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }} showsVerticalScrollIndicator={false}>
        {/* Current plan / trial banner */}
        <View style={[styles.statusCard, { borderColor: TIER_ACCENT[tier] }]} testID="upgrade-current-plan">
          <View style={{ flex: 1 }}>
            <Text style={styles.statusLabel}>CURRENT PLAN</Text>
            <Text style={[styles.statusPlan, { color: TIER_ACCENT[tier] }]}>{TIER_LABELS[tier]}</Text>
            {status === "trial" && <Text style={styles.statusSub}>Trial · {trialDaysRemaining} day{trialDaysRemaining === 1 ? "" : "s"} left</Text>}
            {inGrace && <Text style={[styles.statusSub, { color: colors.warning }]}>Grace period — renew to keep Pro</Text>}
            {status === "expired" && <Text style={[styles.statusSub, { color: colors.warning }]}>Subscription expired</Text>}
            {offline && <Text style={styles.statusSub}>Offline — showing cached status</Text>}
          </View>
          <MaterialCommunityIcons name={tier === "free" ? "car" : "crown"} size={30} color={TIER_ACCENT[tier]} />
        </View>

        {/* Trial CTA */}
        {tier === "free" && !trialUsed && (
          <Pressable testID="upgrade-start-trial" style={styles.trialBtn} onPress={doTrial} disabled={busy === "trial"}>
            <LinearGradient colors={[colors.brand, colors.brandSecondary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.trialGrad}>
              {busy === "trial" ? <ActivityIndicator color={colors.onBrandPrimary} /> : (
                <>
                  <MaterialCommunityIcons name="gift" size={18} color={colors.onBrandPrimary} />
                  <Text style={styles.trialText}>START 30-DAY FREE PRO TRIAL</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>
        )}

        {/* Billing period toggle */}
        <View style={styles.periodRow}>
          {(["monthly", "annual"] as const).map((p) => (
            <Pressable key={p} testID={`period-${p}`} style={[styles.periodTab, period === p && styles.periodActive]} onPress={() => setPeriod(p)}>
              <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                {p === "monthly" ? "Monthly" : "Annual · save 33%"}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Plan cards */}
        {PLANS.map((p) => {
          const isCurrent = p.tier === tier;
          const accent = TIER_ACCENT[p.tier];
          const price = p.tier === "free" ? "Free" : PRICING[p.tier as "pro" | "shop"][period];
          const canBuy = p.tier !== "free" && TIER_RANK[p.tier] > TIER_RANK[tier];
          return (
            <View key={p.tier} style={[styles.planCard, isCurrent && { borderColor: accent }]} testID={`plan-${p.tier}`}>
              <View style={styles.planTop}>
                <View style={[styles.planIcon, { backgroundColor: colors.brandTertiary }]}>
                  <MaterialCommunityIcons name={p.icon as any} size={22} color={accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.planName}>{TIER_LABELS[p.tier]}</Text>
                  <Text style={styles.planTagline}>{p.tagline}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={[styles.planPrice, { color: accent }]}>{price}</Text>
                  {p.tier !== "free" && <Text style={styles.planPer}>/{period === "monthly" ? "mo" : "yr"}</Text>}
                </View>
              </View>
              {isCurrent ? (
                <View style={styles.currentPill}><Text style={styles.currentPillText}>CURRENT PLAN</Text></View>
              ) : canBuy ? (
                <Pressable testID={`upgrade-to-${p.tier}`} style={styles.planBtn} onPress={() => doUpgrade(p.tier)} disabled={busy === p.tier}>
                  <LinearGradient colors={[accent, colors.brandSecondary]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.planBtnGrad}>
                    {busy === p.tier ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.planBtnText}>UPGRADE TO {TIER_LABELS[p.tier].toUpperCase()}</Text>}
                  </LinearGradient>
                </Pressable>
              ) : null}
            </View>
          );
        })}

        {/* Feature comparison */}
        <Text style={styles.sectionTitle}>FEATURE COMPARISON</Text>
        <View style={styles.table}>
          <View style={styles.tRow}>
            <Text style={[styles.tFeature, styles.tHead]}>Feature</Text>
            {(["free", "pro", "shop"] as Tier[]).map((t) => (
              <Text key={t} style={[styles.tCol, styles.tHead, { color: TIER_ACCENT[t] }]}>{t === "free" ? "Free" : t === "pro" ? "Pro" : "Shop"}</Text>
            ))}
          </View>
          {COMPARISON_CATEGORIES.map((cat) => {
            const rows = FEATURES.filter((f) => f.category === cat);
            if (!rows.length) return null;
            return (
              <View key={cat}>
                <Text style={styles.catLabel}>{cat}</Text>
                {rows.map((f) => (
                  <View key={f.key} style={styles.tRow}>
                    <Text style={styles.tFeature} numberOfLines={1}>{f.label}</Text>
                    {(["free", "pro", "shop"] as Tier[]).map((t) => (
                      <View key={t} style={styles.tCol}>
                        {TIER_RANK[t] >= TIER_RANK[f.tier] ? (
                          <MaterialCommunityIcons name="check-circle" size={16} color={TIER_ACCENT[t]} />
                        ) : (
                          <MaterialCommunityIcons name="minus" size={14} color={colors.borderStrong} />
                        )}
                      </View>
                    ))}
                  </View>
                ))}
              </View>
            );
          })}
        </View>

        {/* Restore / manage */}
        <Pressable testID="upgrade-restore" style={styles.linkBtn} onPress={doRestore} disabled={busy === "restore"}>
          <MaterialCommunityIcons name="restore" size={16} color={colors.brand} />
          <Text style={styles.linkText}>Restore Purchases</Text>
        </Pressable>

        {/* FAQ */}
        <Text style={styles.sectionTitle}>FREQUENTLY ASKED</Text>
        {FAQ.map((f, i) => (
          <View key={i} style={styles.faqCard}>
            <Text style={styles.faqQ}>{f.q}</Text>
            <Text style={styles.faqA}>{f.a}</Text>
          </View>
        ))}

        <Text style={styles.legal}>
          Subscriptions auto-renew unless cancelled. Prices shown for reference; real billing activates once App Store / Google Play is connected.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1.2 },
  statusCard: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, padding: spacing.lg, marginBottom: spacing.lg },
  statusLabel: { color: colors.onSurfaceSecondary, fontSize: 10, letterSpacing: 1.5, fontWeight: "700" },
  statusPlan: { fontFamily: font.display, fontSize: 26, marginTop: 2 },
  statusSub: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  trialBtn: { borderRadius: radius.md, overflow: "hidden", marginBottom: spacing.lg },
  trialGrad: { flexDirection: "row", gap: 8, paddingVertical: 15, alignItems: "center", justifyContent: "center" },
  trialText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 1, fontSize: 13 },
  periodRow: { flexDirection: "row", backgroundColor: colors.surfaceSecondary, borderRadius: radius.pill, padding: 4, marginBottom: spacing.lg },
  periodTab: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: radius.pill },
  periodActive: { backgroundColor: colors.surfaceTertiary },
  periodText: { color: colors.onSurfaceSecondary, fontWeight: "600", fontSize: 13 },
  periodTextActive: { color: colors.brand },
  planCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md },
  planTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  planIcon: { width: 44, height: 44, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  planName: { color: colors.onSurface, fontFamily: font.display, fontSize: 20 },
  planTagline: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 1 },
  planPrice: { fontFamily: font.display, fontSize: 22 },
  planPer: { color: colors.onSurfaceSecondary, fontSize: 11 },
  planBtn: { borderRadius: radius.sm, overflow: "hidden", marginTop: spacing.md },
  planBtnGrad: { paddingVertical: 13, alignItems: "center" },
  planBtnText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 0.8, fontSize: 12 },
  currentPill: { marginTop: spacing.md, alignSelf: "flex-start", backgroundColor: colors.brandTertiary, borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 },
  currentPillText: { color: colors.brand, fontSize: 11, fontWeight: "800", letterSpacing: 1 },
  sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 2, fontWeight: "700", marginTop: spacing.xl, marginBottom: spacing.md },
  table: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  tRow: { flexDirection: "row", alignItems: "center", paddingVertical: 7 },
  tFeature: { flex: 1, color: colors.onSurface, fontSize: 13 },
  tCol: { width: 46, alignItems: "center" },
  tHead: { fontWeight: "800", fontSize: 12 },
  catLabel: { color: colors.brand, fontSize: 10, letterSpacing: 1, fontWeight: "700", marginTop: spacing.md, marginBottom: 2, textTransform: "uppercase" },
  linkBtn: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: spacing.lg },
  linkText: { color: colors.brand, fontWeight: "700", fontSize: 14 },
  faqCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.sm },
  faqQ: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  faqA: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 6, lineHeight: 19 },
  legal: { color: colors.onSurfaceSecondary, fontSize: 11, lineHeight: 16, marginTop: spacing.lg, textAlign: "center" },
});
