import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useTelemetry, computeHealth } from "@/src/telemetry";
import { colors, font, radius, spacing } from "@/src/theme";

const HERO =
  "https://images.unsplash.com/photo-1719467292463-9a9a3490d69e?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MTJ8MHwxfHNlYXJjaHwxfHxkYXJrJTIwbWV0YWxsaWMlMjBzcG9ydHMlMjBjYXIlMjBzaWRlJTIwcHJvZmlsZSUyMDNkJTIwcmVuZGVyfGVufDB8fHx8MTc4NTc4NzQ3M3ww&ixlib=rb-4.1.0&q=85";

const statusColor = (s: string) => (s === "good" ? colors.success : s === "warn" ? colors.warning : colors.error);

const REMINDERS = [
  { icon: "oil", label: "Oil change due", detail: "in 480 km", level: "warn" },
  { icon: "car-brake-alert", label: "Brake inspection", detail: "in 2,100 km", level: "good" },
  { icon: "air-filter", label: "Air filter", detail: "Overdue by 300 km", level: "bad" },
];

export default function Health() {
  const insets = useSafeAreaInsets();
  const { data } = useTelemetry();
  const systems = computeHealth(data);
  const [expanded, setExpanded] = useState<string | null>(null);

  const overall = Math.round(systems.reduce((a, s) => a + s.score, 0) / systems.length);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
        {/* Hero */}
        <View style={styles.hero}>
          <Image source={{ uri: HERO }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient
            colors={["rgba(6,8,13,0.2)", "rgba(6,8,13,0.85)", colors.surface]}
            style={StyleSheet.absoluteFill}
          />
          <View style={[styles.heroContent, { paddingTop: insets.top + 12 }]}>
            <Text style={styles.heroLabel}>VEHICLE HEALTH</Text>
            <View style={styles.scoreRow}>
              <Text style={styles.scoreBig}>{overall}</Text>
              <Text style={styles.scoreSlash}>/100</Text>
            </View>
            <Text style={styles.heroSub}>
              {overall >= 80 ? "All systems performing well" : "Attention required on some systems"}
            </Text>
          </View>
        </View>

        {/* Health scores */}
        <Text style={styles.sectionTitle}>SYSTEM SCORES</Text>
        <View style={styles.scoreGrid}>
          {systems.map((s) => (
            <View key={s.name} style={styles.scoreCard} testID={`health-${s.name.split(" ")[0].toLowerCase()}`}>
              <View style={styles.scoreCardTop}>
                <Text style={styles.scoreCardName}>{s.name}</Text>
                <View style={[styles.badge, { backgroundColor: statusColor(s.status) + "22" }]}>
                  <View style={[styles.badgeDot, { backgroundColor: statusColor(s.status) }]} />
                </View>
              </View>
              <Text style={[styles.scoreCardVal, { color: statusColor(s.status) }]}>{s.score}</Text>
              <View style={styles.scoreTrack}>
                <View style={[styles.scoreFill, { width: `${s.score}%`, backgroundColor: statusColor(s.status) }]} />
              </View>
            </View>
          ))}
        </View>

        {/* DTCs */}
        <Text style={styles.sectionTitle}>DIAGNOSTIC TROUBLE CODES</Text>
        {data.dtcs.length === 0 ? (
          <Text style={styles.clear}>✓ No active trouble codes</Text>
        ) : (
          data.dtcs.map((d) => (
            <Pressable
              key={d.code}
              testID={`dtc-${d.code}`}
              style={styles.dtc}
              onPress={() => setExpanded(expanded === d.code ? null : d.code)}
            >
              <View style={styles.dtcHeader}>
                <MaterialCommunityIcons name="alert-circle" size={18} color={colors.warning} />
                <Text style={styles.dtcCode}>{d.code}</Text>
                <MaterialCommunityIcons
                  name={expanded === d.code ? "chevron-up" : "chevron-down"}
                  size={20}
                  color={colors.onSurfaceSecondary}
                  style={{ marginLeft: "auto" }}
                />
              </View>
              <Text style={styles.dtcDesc}>{d.desc}</Text>
              {expanded === d.code && (
                <Text style={styles.dtcDetail}>
                  Recommended: Inspect related components, clear code, and re-scan after a drive cycle.
                  Ask JARVIS for a guided test procedure.
                </Text>
              )}
            </Pressable>
          ))
        )}

        {/* Maintenance reminders */}
        <Text style={styles.sectionTitle}>PREDICTIVE MAINTENANCE</Text>
        {REMINDERS.map((r) => (
          <View key={r.label} style={styles.reminder} testID={`reminder-${r.icon}`}>
            <View style={[styles.reminderIcon, { backgroundColor: statusColor(r.level) + "22" }]}>
              <MaterialCommunityIcons name={r.icon as any} size={20} color={statusColor(r.level)} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.reminderLabel}>{r.label}</Text>
              <Text style={[styles.reminderDetail, { color: statusColor(r.level) }]}>{r.detail}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { height: 280, justifyContent: "flex-end" },
  heroContent: { padding: spacing.lg },
  heroLabel: { color: colors.brand, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  scoreRow: { flexDirection: "row", alignItems: "flex-end" },
  scoreBig: { color: colors.onSurface, fontFamily: font.display, fontSize: 72, lineHeight: 76 },
  scoreSlash: { color: colors.onSurfaceSecondary, fontSize: 20, marginBottom: 14, marginLeft: 4 },
  heroSub: { color: colors.onSurfaceTertiary, fontSize: 14 },
  sectionTitle: {
    color: colors.onSurfaceSecondary,
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: "700",
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  scoreGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingHorizontal: spacing.lg },
  scoreCard: {
    width: "31.5%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  scoreCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  scoreCardName: { color: colors.onSurfaceSecondary, fontSize: 10, flex: 1 },
  badge: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  badgeDot: { width: 7, height: 7, borderRadius: 4 },
  scoreCardVal: { fontFamily: font.display, fontSize: 30, marginTop: 4 },
  scoreTrack: { height: 3, backgroundColor: colors.surfaceTertiary, borderRadius: 2, marginTop: 6, overflow: "hidden" },
  scoreFill: { height: "100%" },
  clear: { color: colors.success, marginHorizontal: spacing.lg, fontSize: 15 },
  dtc: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dtcHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  dtcCode: { color: colors.onSurface, fontFamily: font.display, fontSize: 18 },
  dtcDesc: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 4 },
  dtcDetail: { color: colors.onSurfaceTertiary, fontSize: 13, marginTop: spacing.sm, lineHeight: 19 },
  reminder: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  reminderIcon: { width: 40, height: 40, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  reminderLabel: { color: colors.onSurface, fontSize: 15 },
  reminderDetail: { fontSize: 12, marginTop: 2 },
});
