import React, { useState } from "react";
import { View, Text, StyleSheet, LayoutChangeEvent } from "react-native";
import Svg, { Polyline, Line, Circle, Rect } from "react-native-svg";
import { colors, font, spacing, radius } from "@/src/theme";

interface Props {
  label: string;
  unit?: string;
  values: number[];
  color?: string;
  height?: number;
  cursorIndex: number; // index into values
  onSeek?: (index: number) => void;
  decimals?: number;
}

// Reusable synchronized signal chart with a scrub cursor + playback crosshair.
// Multiple instances share cursorIndex via the parent for synced playback.
export default function SignalChart({
  label, unit, values, color = colors.brand, height = 88, cursorIndex, onSeek, decimals = 0,
}: Props) {
  const [w, setW] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width);
  const n = values.length;
  const min = n ? Math.min(...values) : 0;
  const max = n ? Math.max(...values) : 1;
  const range = max - min || 1;
  const pad = 6;
  const gh = height - pad * 2;

  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * w);
  const y = (v: number) => pad + gh - ((v - min) / range) * gh;

  const points = n ? values.map((v, i) => `${x(i)},${y(v)}`).join(" ") : "";
  const cx = x(Math.min(cursorIndex, n - 1));
  const cVal = n ? values[Math.min(cursorIndex, n - 1)] : 0;

  const seek = (locX: number) => {
    if (!onSeek || w <= 0 || n <= 1) return;
    onSeek(Math.max(0, Math.min(n - 1, Math.round((locX / w) * (n - 1)))));
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.label}>{label.toUpperCase()}</Text>
        <Text style={[styles.value, { color }]}>
          {cVal.toFixed(decimals)}
          <Text style={styles.unit}> {unit || ""}</Text>
        </Text>
      </View>
      <View
        style={{ height }}
        onLayout={onLayout}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => seek(e.nativeEvent.locationX)}
        onResponderMove={(e) => seek(e.nativeEvent.locationX)}
      >
        {w > 0 && (
          <Svg width={w} height={height}>
            <Rect x={0} y={0} width={w} height={height} fill={colors.surface} rx={6} />
            <Line x1={0} y1={pad + gh / 2} x2={w} y2={pad + gh / 2} stroke={colors.divider} strokeWidth={1} />
            {points ? <Polyline points={points} fill="none" stroke={color} strokeWidth={2} /> : null}
            <Line x1={cx} y1={0} x2={cx} y2={height} stroke={colors.onSurface} strokeWidth={1} opacity={0.6} />
            <Circle cx={cx} cy={y(cVal)} r={4} fill={color} stroke={colors.onSurface} strokeWidth={1} />
          </Svg>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4, paddingHorizontal: 4 },
  label: { color: colors.onSurfaceSecondary, fontSize: 10, letterSpacing: 1, fontWeight: "700" },
  value: { fontFamily: font.display, fontSize: 18 },
  unit: { color: colors.onSurfaceSecondary, fontSize: 10 },
});
