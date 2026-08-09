import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAI } from "@/src/ai/aiContext";
import { AIProviderType } from "@/src/ai/types";
import { colors, radius, spacing } from "@/src/theme";

// Small pill showing which AI engine will run diagnostic AI:
//   ☁️ JARVIS Cloud · 🔑 BYOK (OpenAI key) · 🖥️ Local AI
export default function AIEngineBadge({ style }: { style?: any }) {
  const ai = useAI();
  const t = ai.providerType;
  const icon =
    t === AIProviderType.OPENAI_USER_KEY ? "key-variant" : t === AIProviderType.LOCAL_AI ? "laptop" : "cloud-outline";
  return (
    <View style={[styles.badge, style]} testID="ai-engine-badge">
      <MaterialCommunityIcons name={icon as any} size={13} color={colors.brand} />
      <Text style={styles.text} numberOfLines={1}>{ai.providerName}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    backgroundColor: colors.brandTertiary,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.brand,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  text: { color: colors.brand, fontSize: 11, fontWeight: "700" },
});
