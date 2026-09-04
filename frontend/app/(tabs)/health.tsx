import React, { useState, useEffect, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Image } from "expo-image";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useVehicle } from "@/src/vehicle/service";
import { computeSubsystems, overallHealth, analyzeFaults } from "@/src/vehicle/health";
import { api } from "@/src/api";
import { predictionsService, PredictionItem, PredictionResult, URGENCY_META, SOURCE_META } from "@/src/vehicle/predictions/predictionsService";
import { isCloudActive, runPreparedOnActive } from "@/src/ai/diagnosticAI";
import AIEngineBadge from "@/src/components/AIEngineBadge";
import { colors, font, radius, spacing } from "@/src/theme";

const HERO =
  "https://images.unsplash.com/photo-1719467292463-9a9a3490d69e?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MTJ8MHwxfHNlYXJjaHwxfHxkYXJrJTIwbWV0YWxsaWMlMjBzcG9ydHMlMjBjYXIlMjBzaWRlJTIwcHJvZmlsZSUyMDNkJTIwcmVuZGVyfGVufDB8fHx8MTc4NTc4NzQ3M3ww&ixlib=rb-4.1.0&q=85";

const sc = (s: string) => (s === "good" ? colors.success : s === "warn" ? colors.warning : colors.error);

const PRED_ICON: Record<string, string> = {
  oil: "oil", coolant: "coolant-temperature", plugs: "flash", air: "air-filter",
  battery: "car-battery", brakes: "car-brake-alert", trans: "car-shift-pattern", alternator: "car-battery",
};

export default function Health() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signals, dtcs, identity, hasLiveData } = useVehicle();
  const vd = { signals, dtcs, identity, phase: "cruise" as const, connected: hasLiveData };
  const systems = computeSubsystems(vd);
  const overall = overallHealth(systems);
  const findings = analyzeFaults(vd);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Record<string, string>>({});
  const [loadingCode, setLoadingCode] = useState<string | null>(null);

  // Real, source-aware predictive maintenance (backend engine). NO fabricated values.
  const [preds, setPreds] = useState<PredictionResult | null>(null);
  const [predsLoading, setPredsLoading] = useState(true);

  const loadPreds = useCallback(async () => {
    setPredsLoading(true);
    try {
      const list: any = await api.vehicles();
      const arr: any[] = Array.isArray(list) ? list : list?.vehicles || [];
      const active = arr.find((v) => v.is_active) || arr[0] || null;
      if (active?.id) {
        const { data } = await predictionsService.get(active.id);
        setPreds(data);
      } else {
        setPreds(null);
      }
    } catch {
      setPreds(null);
    }
    setPredsLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { loadPreds(); }, [loadPreds]));

  const analyze = async (code: string, desc: string) => {
    setLoadingCode(code);
    const payload = {
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
    };
    try {
      let text: string;
      if (await isCloudActive()) {
        const res = await api.analyzeDtc(payload);
        text = res.analysis;
      } else {
        const prep = await api.analyzeDtc(payload, true);
        const res = await runPreparedOnActive(prep);
        text = res.text;
      }
      setAnalysis((a) => ({ ...a, [code]: text }));
    } catch (e: any) {
      setAnalysis((a) => ({ ...a, [code]: e?.message || "Analysis unavailable. Check connection." }));
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
              <Text style={styles.scoreBig}>{hasLiveData ? overall : "—"}</Text>
              <Text style={styles.scoreSlash}>/100</Text>
            </View>
            <Text style={styles.heroSub}>
              {hasLiveData
                ? identity
                  ? `${identity.year} ${identity.make} ${identity.model}`
                  : "Live vehicle data"
                : "Health score unavailable — connect an OBD-II adapter"}
            </Text>
          </View>
        </View>

        {!hasLiveData ? (
          <View style={styles.noLive} testID="health-no-live">
            <MaterialCommunityIcons name="heart-off-outline" size={40} color={colors.onSurfaceSecondary} />
            <Text style={styles.noLiveTitle}>Health score unavailable</Text>
            <Text style={styles.noLiveSub}>Insufficient live vehicle data. Connect an OBD-II adapter to view real system health.</Text>
            <Pressable testID="health-connect" style={styles.noLiveBtn} onPress={() => router.push("/connect")}>
              <Text style={styles.noLiveBtnText}>OPEN CONNECTION CENTER</Text>
            </Pressable>
          </View>
        ) : (
          <>
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
          </>
        )}

        {/* DTCs with AI analyze */}
        <View style={styles.dtcHead}>
          <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>DIAGNOSTIC TROUBLE CODES</Text>
          <AIEngineBadge style={{ marginRight: spacing.lg }} />
        </View>
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

        {/* Predictive maintenance — real, source-labeled, never fabricated */}
        <View style={styles.pmHead}>
          <Text style={[styles.sectionTitle, { marginBottom: 0 }]}>PREDICTIVE MAINTENANCE</Text>
          {preds?.mileage ? <Text style={styles.pmMileage}>{preds.mileage.toLocaleString()} km</Text> : null}
        </View>
        {predsLoading ? (
          <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.lg }} />
        ) : !preds || preds.items.length === 0 ? (
          <View style={styles.pmEmpty} testID="pm-empty">
            <MaterialCommunityIcons name="wrench-outline" size={34} color={colors.onSurfaceSecondary} />
            <Text style={styles.pmEmptyText}>No maintenance data yet. Add a vehicle and log its service history to get accurate, source-backed predictions.</Text>
          </View>
        ) : (
          <>
            {!preds.mileageKnown ? (
              <Text style={styles.pmNotice}>Set your vehicle's current mileage to enable distance-based predictions.</Text>
            ) : null}
            {preds.items.map((r) => <PredictionCard key={r.key} item={r} />)}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function PredictionCard({ item }: { item: PredictionItem }) {
  const meta = URGENCY_META[item.urgency];
  const src = SOURCE_META[item.source];
  const measured = item.remainingLifePct != null; // only a REAL measurement sets this
  const detail =
    item.source === "UNAVAILABLE"
      ? (item.reasons[0] || "Insufficient maintenance data")
      : item.urgency === "overdue"
        ? (item.remainingKm != null ? `Overdue by ${Math.abs(item.remainingKm).toLocaleString()} km` : "Service overdue")
        : item.dueMileage != null
          ? `Due at ${item.dueMileage.toLocaleString()} km${item.remainingKm != null ? ` · ${item.remainingKm.toLocaleString()} km left` : ""}`
          : (item.reasons[0] || "Log service history or set mileage to estimate");
  return (
    <View style={styles.reminder} testID={`reminder-${item.key}`}>
      <View style={[styles.reminderIcon, { backgroundColor: meta.color + "22" }]}>
        <MaterialCommunityIcons name={(PRED_ICON[item.key] || "wrench") as any} size={20} color={meta.color} />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.reminderTop}>
          <Text style={styles.reminderLabel}>{item.name}</Text>
          <View style={[styles.urgencyTag, { borderColor: meta.color }]}>
            <Text style={[styles.urgencyTagText, { color: meta.color }]}>{meta.label}</Text>
          </View>
        </View>
        <Text style={[styles.reminderDetail, { color: meta.color }]}>{detail}</Text>
        {measured ? (
          <View style={styles.lifeTrack}>
            <View style={[styles.lifeFill, { width: `${Math.round((item.remainingLifePct || 0) * 100)}%`, backgroundColor: meta.color }]} />
          </View>
        ) : null}
        <View style={styles.provRow}>
          <MaterialCommunityIcons name="database-check-outline" size={11} color={colors.onSurfaceSecondary} />
          <Text style={styles.provText}>
            {src.label}{item.confidence != null ? ` · ${Math.round(item.confidence * 100)}% confidence` : ""}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { height: 260, justifyContent: "flex-end" },
  dtcHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noLive: { alignItems: "center", marginHorizontal: spacing.lg, marginTop: spacing.lg, padding: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.sm },
  noLiveTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 16, marginTop: spacing.sm },
  noLiveSub: { color: colors.onSurfaceSecondary, fontSize: 13, textAlign: "center" },
  noLiveBtn: { marginTop: spacing.md, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  noLiveBtnText: { color: colors.brand, fontWeight: "700", letterSpacing: 1, fontSize: 12 },
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
  reminderTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reminderLabel: { color: colors.onSurface, fontSize: 15, flex: 1 },
  urgencyTag: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
  urgencyTagText: { fontSize: 8, fontWeight: "800", letterSpacing: 0.5 },
  provRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 6 },
  provText: { color: colors.onSurfaceSecondary, fontSize: 10 },
  pmHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginRight: spacing.lg },
  pmMileage: { color: colors.onSurfaceSecondary, fontSize: 12, fontWeight: "600", marginTop: spacing.lg },
  pmEmpty: { alignItems: "center", gap: spacing.sm, marginHorizontal: spacing.lg, padding: spacing.xl, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  pmEmptyText: { color: colors.onSurfaceSecondary, fontSize: 13, textAlign: "center", lineHeight: 19 },
  pmNotice: { color: colors.onSurfaceSecondary, fontSize: 12, marginHorizontal: spacing.lg, marginBottom: spacing.sm, fontStyle: "italic" },
  reminderDetail: { fontSize: 12, marginTop: 2 },
  lifeTrack: { height: 3, backgroundColor: colors.surfaceTertiary, borderRadius: 2, marginTop: 6, overflow: "hidden" },
  lifeFill: { height: "100%" },
});
