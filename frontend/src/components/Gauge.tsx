import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { colors, font, radius, spacing } from "@/src/theme";

type Props = {
  label: string;
  value: number | string;
  unit?: string;
  min?: number;
  max?: number;
  numeric?: number;
  accent?: string;
  testID?: string;
};

export default function Gauge({
  label,
  value,
  unit,
  min = 0,
  max = 100,
  numeric,
  accent = colors.brand,
  testID,
}: Props) {
  const n = numeric ?? (typeof value === "number" ? value : 0);
  const pct = Math.max(0, Math.min(1, (n - min) / (max - min)));
  return (
    <View style={styles.cell} testID={testID}>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
      <View style={styles.row}>
        <Text style={[styles.value, { color: accent }]}>{value}</Text>
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: accent }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    flex: 1,
    minHeight: 84,
    justifyContent: "space-between",
  },
  label: {
    color: colors.onSurfaceSecondary,
    fontSize: 10,
    letterSpacing: 1.2,
    fontWeight: "600",
  },
  row: { flexDirection: "row", alignItems: "flex-end", marginTop: 2 },
  value: { fontFamily: font.display, fontSize: 30, lineHeight: 34 },
  unit: { color: colors.onSurfaceSecondary, fontSize: 11, marginLeft: 4, marginBottom: 5 },
  track: {
    height: 4,
    backgroundColor: colors.surfaceTertiary,
    borderRadius: radius.pill,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  fill: { height: "100%", borderRadius: radius.pill },
});
