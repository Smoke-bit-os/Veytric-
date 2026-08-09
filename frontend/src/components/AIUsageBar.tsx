import React, { useCallback } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAI } from "@/src/ai/aiContext";
import { AIProviderType } from "@/src/ai/types";
import { colors, radius, spacing } from "@/src/theme";

// Small "X of 20 AI uses left this month" meter for Free users on JARVIS Cloud.
// Hidden for unlimited tiers and for BYOK/Local (they don't use the cloud quota).
export default function AIUsageBar({ compact, flush }: { compact?: boolean; flush?: boolean }) {
  const router = useRouter();
  const ai = useAI();

  useFocusEffect(useCallback(() => { ai.refreshUsage(); }, [ai.refreshUsage]));

  const wrapStyle = [styles.wrap, flush && styles.flush];

  // BYOK / Local run on the user's own engine — no cloud quota.
  if (ai.providerType !== AIProviderType.JARVIS_CLOUD) {
    return (
      <View style={[wrapStyle, styles.byok]} testID="ai-usage-byok">
        <MaterialCommunityIcons name="infinity" size={14} color={colors.brand} />
        <Text style={styles.byokText}>Unlimited · {ai.providerName}</Text>
      </View>
    );
  }

  const u = ai.usage;
  if (!u || u.unlimited || u.requests_limit == null) return null; // Pro/Shop or unknown → hide

  const used = u.requests_used;
  const limit = u.requests_limit;
  const remaining = u.remaining ?? Math.max(0, limit - used);
  const pct = Math.min(1, used / limit);
  const low = remaining <= 3;

  return (
    <Pressable testID="ai-usage-bar" style={wrapStyle} onPress={() => router.push("/upgrade")}>
      <View style={styles.row}>
        <MaterialCommunityIcons name="robot" size={14} color={low ? colors.warning : colors.brand} />
        <Text style={styles.label}>
          {remaining} of {limit} AI uses left this month
        </Text>
        {!compact && <Text style={styles.upgrade}>Upgrade</Text>}
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: low ? colors.warning : colors.brand }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, marginHorizontal: spacing.lg, marginTop: spacing.sm },
  flush: { marginHorizontal: 0, marginTop: 0, marginBottom: spacing.lg },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { color: colors.onSurface, fontSize: 12, fontWeight: "600", flex: 1 },
  upgrade: { color: colors.brand, fontSize: 12, fontWeight: "800" },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.surfaceTertiary, marginTop: 6, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3 },
  byok: { flexDirection: "row", alignItems: "center", gap: 6 },
  byokText: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600" },
});
