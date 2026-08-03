import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useVehicle } from "@/src/vehicle/service";
import { computeSubsystems, overallHealth, analyzeFaults } from "@/src/vehicle/health";
import { api } from "@/src/api";
import { colors, font, radius, spacing } from "@/src/theme";

const HERO =
  "https://images.unsplash.com/photo-1719467292463-9a9a3490d69e?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MTJ8MHwxfHNlYXJjaHwxfHxkYXJrJTIwbWV0YWxsaWMlMjBzcG9ydHMlMjBjYXIlMjBzaWRlJTIwcHJvZmlsZSUyMDNkJTIwcmVuZGVyfGVufDB8fHx8MTc4NTc4NzQ3M3ww&ixlib=rb-4.1.0&q=85";

const sc = (s: string) => (s === "good" ? colors.success : s === "warn" ? colors.warning : colors.error);

const REMINDERS = [
  { icon: "oil", label: "Oil change", detail: "Due in 480 km", level: "warn", life: 18 },
  { icon: "car-battery", label: "Battery", detail: "Est. 62% life remaining", level: "good", life: 62 },
  { icon: "air-filter", label: "Air filter", detail: "Overdue by 300 km", level: "bad", life: 4 },
  { icon: "spark-plug", label: "Spark plugs", detail: "Est. 40% life remaining", level: "warn", life: 40 },
  { icon: "car-brake-alert", label: "Brake pads", detail: "Est. 71% life remaining", level: "good", life: 71 },
];

export default function Health() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signals, dtcs, identity } = useVehicle();
  const vd = { signals, dtcs, identity, phase: "cruise" as const, connected: true };
  const systems = computeSubsystems(vd);
  const overall = overallHealth(systems);
  const findings = analyzeFaults(vd);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, string>>({});
  const [loadingCode, setLoadingCode] = useState<string | null>(null);

  const analyze = async (code: string, desc: string) => {
    setLoadingCode(code);
    try {
      const res = await api.analyzeDtc({
        code,
        desc,
        vehicle: identity ? `${identity.year} ${identity.make} ${identity.model}` : "vehicle",
        telemetry: {
          rpm: Math.round(signals.rpm),
          coolantTemp: Math.round(signals.coolantTemp),
          shortFuelTrim: signals.shortFuelTrim.toFixed(1),
          longFuelTrim: signals.longFuelTrim.toFixed(1),
          batteryVoltage: signals.batteryVoltage.toFixed(1),
        },
      });
      setAnalysis((a) => ({ ...a, [code]: res.analysis }));
    } catch {
      setAnalysis((a) => ({ ...a, [code]: "Analysis unavailable. Check connection." }));
    }
    setLoadingCode(null);
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={{ paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Image source={{ uri: HERO }} style={StyleSheet.absoluteFill} contentFit="cover" />
          <LinearGradient colors={["rgba(6,8,13,0.2)", "rgba(6,8,13,0.85)", colors.surface]} style={StyleSheet.absoluteFill} />
          <View style={[styles.heroContent, { paddingTop: insets.top + 12 }]}>
            <View style={styles.heroTop}>
              <Text style={styles.heroLabel}>VEHICLE HEALTH</Text>
              <Pressable testID="open-reports" style={styles.reportsBtn} onPress={() => router.push("/reports")}>
                <MaterialCommunityIcons name="file-chart" size={16} color={colors.brand} />
                <Text style={styles.reportsText}>Reports</Text>
              </Pressable>
            </View>
            <View style={styles.scoreRow}>
              <Text style={styles.scoreBig}>{overall}</Text>
              <Text style={styles.scoreSlash}>/100</Text>
            </View>
            <Text style={styles.heroSub}>
              {identity ? `${identity.year} ${identity.make} ${identity.model}` : "No vehicle connected"}
            </Text>
          </View>
        </View>

        {/* AI findings */}
        <Text style={styles.sectionTitle}>AI DIAGNOSTIC FINDINGS</Text>
        {findings.map((f) => (
          <View key={f.title} style={styles.finding} testID={`finding-${f.title.slice(0, 6)}`}>
            <View style={[styles.findingBar, { backgroundColor: sc(f.level) }]} />
            <View style={{ flex: 1 }}>
              <View style={styles.findingHead}>
                <Text style={styles.findingTitle}>{f.title}</Text>
                <Text style={[styles.confidence, { color: sc(f.level) }]}>{f.confidence}%</Text>
              </View>
              <Text style={styles.findingDetail}>{f.detail}</Text>
            </View>
          </View>
        ))}

        {/* System scores */}
        <Text style={styles.sectionTitle}>SYSTEM SCORES</Text>
        <View style={styles.scoreGrid}>
          {systems.map((s) => (
            <View key={s.name} style={styles.scoreCard} testID={`health-${s.name.toLowerCase()}`}>
              <View style={styles.scoreCardTop}>
                <Text style={styles.scoreCardName} numberOfLines={1}>{s.name}</Text>
                <View style={[styles.badgeDot, { backgroundColor: sc(s.status) }]} />
              </View>
              <Text style={[styles.scoreCardVal, { color: sc(s.status) }]}>{s.score}</Text>
              <View style={styles.scoreTrack}>
                <View style={[styles.scoreFill, { width: `${s.score}%`, backgroundColor: sc(s.status) }]} />
              </View>
            </View>
          ))}
        </View>

        {/* DTCs with AI analyze */}
        <Text style={styles.sectionTitle}>DIAGNOSTIC TROUBLE CODES</Text>
        {dtcs.length === 0 ? (
          <Text style={styles.clear}>✓ No active trouble codes</Text>
        ) : (
          dtcs.map((d) => (
            <View key={d.code} style={styles.dtc} testID={`dtc-${d.code}`}>
              <Pressable style={styles.dtcHeader} onPress={() => setExpanded(expanded === d.code ? null : d.code)}>
                <MaterialCommunityIcons name="alert-circle" size={18} color={colors.warning} />
                <Text style={styles.dtcCode}>{d.code}</Text>
                <View style={[styles.typeTag]}>
                  <Text style={styles.typeTagText}>{d.type.toUpperCase()}</Text>
                </View>
                <MaterialCommunityIcons
                  name={expanded === d.code ? "chevron-up" : "chevron-down"}
                  size={20}
                  color={colors.onSurfaceSecondary}
                  style={{ marginLeft: "auto" }}
                />
              </Pressable>
              <Text style={styles.dtcDesc}>{d.desc}</Text>
              {expanded === d.code && (
                <View style={styles.dtcBody}>
                  {analysis[d.code] ? (
                    <Text style={styles.dtcAnalysis}>{analysis[d.code]}</Text>
                  ) : (
                    <Pressable
                      testID={`analyze-${d.code}`}
                      style={styles.analyzeBtn}
                      onPress={() => analyze(d.code, d.desc)}
                      disabled={loadingCode === d.code}
                    >
                      {loadingCode === d.code ? (
                        <ActivityIndicator color={colors.brand} size="small" />
                      ) : (
                        <>
                          <MaterialCommunityIcons name="robot" size={16} color={colors.brand} />
                          <Text style={styles.analyzeText}>Ask JARVIS to analyze this code</Text>
                        </>
                      )}
                    </Pressable>
                  )}
                </View>
              )}
            </View>
          ))
        )}

        {/* Predictive maintenance */}
        <Text style={styles.sectionTitle}>PREDICTIVE MAINTENANCE</Text>
        {REMINDERS.map((r) => (
          <View key={r.label} style={styles.reminder} testID={`reminder-${r.icon}`}>
            <View style={[styles.reminderIcon, { backgroundColor: sc(r.level) + "22" }]}>
              <MaterialCommunityIcons name={r.icon as any} size={20} color={sc(r.level)} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.reminderLabel}>{r.label}</Text>
              <Text style={[styles.reminderDetail, { color: sc(r.level) }]}>{r.detail}</Text>
              <View style={styles.lifeTrack}>
                <View style={[styles.lifeFill, { width: `${r.life}%`, backgroundColor: sc(r.level) }]} />
              </View>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { height: 260, justifyContent: "flex-end" },
  heroContent: { padding: spacing.lg },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroLabel: { color: colors.brand, fontSize: 11, letterSpacing: 2, fontWeight: "700" },
  reportsBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: "rgba(6,8,13,0.5)",
  },
  reportsText: { color: colors.brand, fontWeight: "700", fontSize: 12 },
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
  finding: {
    flexDirection: "row",
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  findingBar: { width: 4 },
  findingHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, paddingBottom: 2 },
  findingTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "600", flex: 1 },
  confidence: { fontFamily: font.display, fontSize: 18 },
  findingDetail: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
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
  badgeDot: { width: 8, height: 8, borderRadius: 4 },
  scoreCardVal: { fontFamily: font.display, fontSize: 28, marginTop: 4 },
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
  typeTag: { backgroundColor: colors.surfaceTertiary, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 2 },
  typeTagText: { color: colors.onSurfaceSecondary, fontSize: 8, fontWeight: "700" },
  dtcDesc: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 4 },
  dtcBody: { marginTop: spacing.md },
  analyzeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radius.sm,
    paddingVertical: 12,
  },
  analyzeText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
  dtcAnalysis: { color: colors.onSurfaceTertiary, fontSize: 14, lineHeight: 21 },
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
  lifeTrack: { height: 3, backgroundColor: colors.surfaceTertiary, borderRadius: 2, marginTop: 6, overflow: "hidden" },
  lifeFill: { height: "100%" },
});
