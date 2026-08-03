import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import { colors, radius } from "@/src/theme";

export default function GlassCard({
  children,
  style,
  intensity = 30,
  testID,
}: {
  children: React.ReactNode;
  style?: ViewStyle | ViewStyle[];
  intensity?: number;
  testID?: string;
}) {
  return (
    <View style={[styles.wrap, style]} testID={testID}>
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={styles.tint} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  tint: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(17,21,32,0.82)" },
  content: { padding: 14 },
});
