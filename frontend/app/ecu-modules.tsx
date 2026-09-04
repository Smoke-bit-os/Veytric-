import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useVehicle } from "@/src/vehicle/service";
import { discoverModules } from "@/src/vehicle/ecu/ecuService";
import { computeModuleHealth, explainModule, ModuleHealth } from "@/src/vehicle/modules/moduleHealth";
import { classifyDtcs, readinessMonitors, mode06Results, verifyVin } from "@/src/vehicle/diagnostics/dtcClassifier";
import { reliabilityReport } from "@/src/vehicle/diagnostics/reliability";
import { colors, font, radius, spacing } from "@/src/theme";

const lvlColor = (l: string) => (l === "good" ? colors.success : l === "warn" ? colors.warning : colors.error);
const monColor = (s: string) => (s === "ready" ? colors.success : s === "not_ready" ? colors.warning : colors.onSurfaceSecondary);

export default function EcuModulesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { identity, dtcs, signals, connection, getDiagnostics, getLog } = useVehicle();
  const connected = connection === "connected";
  const [tab, setTab] = useState<"modules" | "data">("modules");
  const [open, setOpen] = useState<string | null>(null);
  const [ai, setAi] = useState<Record<string, string>>({});
  const [aiLoading, setAiLoading] = useState<string | null>(null);

  const diag = getDiagnostics();
  const log = getLog();
  const modules = useMemo(() => discoverModules(identity, dtcs, diag, connected), [identity, dtcs, connected]);
  const rel = useMemo(() => reliabilityReport(signals, diag, log), [signals]);
  const health = useMemo(() => computeModuleHealth(modules, dtcs, rel.commScore), [modules, dtcs, rel]);
  const cls = useMemo(() => classifyDtcs(dtcs), [dtcs]);
  const monitors = useMemo(() => readinessMonitors(identity, dtcs), [identity, dtcs]);
  const m06 = useMemo(() => mode06Results(signals, dtcs), [signals, dtcs]);
  const vin = verifyVin(identity);
  const vehName = identity ? `${identity.year} ${identity.make} ${identity.model}` : "Vehicle";

  const runAi = async (h: ModuleHealth) => {
    setAiLoading(h.key);
    try { const text = await explainModule(h, vehName); setAi((p) => ({ ...p, [h.key]: text })); }
    catch (e: any) { Alert.alert("AI", e?.message || "Module interpretation unavailable right now."); }
    setAiLoading(null);
  };

  const healthFor = (k: string) => health.find((h) => h.key === k);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="ecu-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>ECU INTELLIGENCE</Text>
        <View style={{ width: 28 }} />
      </View>

      <View style={styles.tabs}>
        {(["modules", "data"] as const).map((t) => (
          <Pressable key={t} testID={`ecu-tab-${t}`} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>{t === "modules" ? "MODULES" : "DIAGNOSTIC DATA"}</Text>
          </Pressable>
        ))}
      </View>

      {!connected && <Text style={styles.warn}>⚠ Not connected — showing last known / simulated modules.</Text>}

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }} showsVerticalScrollIndicator={false}>
        {tab === "modules" ? (
          <>
            <Text style={styles.count}>{modules.filter((m) => m.status === "online").length} of {modules.length} modules responding</Text>
            {modules.map((m) => {
              const h = healthFor(m.key)!;
              const isOpen = open === m.key;
              return (
                <View key={m.key} style={styles.card} testID={`module-${m.key}`}>
                  <Pressable style={styles.cardTop} onPress={() => setOpen(isOpen ? null : m.key)}>
                    <MaterialCommunityIcons name={m.icon as any} size={22} color={colors.brand} />
                    <View style={{ flex: 1, marginLeft: spacing.md }}>
                      <Text style={styles.mName}>{m.name}</Text>
                      <Text style={styles.mSub}>{m.short} · {m.address}</Text>
                    </View>
                    <View style={[styles.statusPill, { borderColor: m.status === "online" ? colors.success : colors.onSurfaceSecondary }]}>
                      <View style={[styles.sDot, { backgroundColor: m.status === "online" ? colors.success : colors.onSurfaceSecondary }]} />
                      <Text style={[styles.statusText, { color: m.status === "online" ? colors.success : colors.onSurfaceSecondary }]}>
                        {m.status === "online" ? "ONLINE" : "NO RESP"}
                      </Text>
                    </View>
                  </Pressable>

                  <View style={styles.healthRow}>
                    <View style={styles.hbarTrack}><View style={[styles.hbarFill, { width: `${h.score}%`, backgroundColor: lvlColor(h.level) }]} /></View>
                    <Text style={[styles.hscore, { color: lvlColor(h.level) }]}>{h.score}</Text>
                  </View>
                  <View style={styles.badgeRow}>
                    {m.dtcCount > 0 ? <Badge icon="alert-circle" text={`${m.dtcCount} DTC`} color={colors.warning} /> : <Badge icon="check-circle" text="No faults" color={colors.success} />}
                    <Badge icon="access-point" text={`${h.commReliability}% comm`} color={colors.onSurfaceSecondary} />
                    {m.calibrationId ? <Badge icon="chip" text={m.calibrationId} color={colors.onSurfaceSecondary} /> : null}
                  </View>

                  {isOpen && (
                    <View style={styles.detail}>
                      {m.softwareVersion ? <Text style={styles.detLine}><Text style={styles.detLabel}>Software: </Text>{m.softwareVersion}</Text> : null}
                      <Text style={styles.detLabel}>Supported functions</Text>
                      <View style={styles.fnWrap}>
                        {m.functions.map((f) => <View key={f} style={styles.fnChip}><Text style={styles.fnText}>{f}</Text></View>)}
                      </View>
                      {h.activeIssues.length > 0 && (
                        <>
                          <Text style={[styles.detLabel, { marginTop: spacing.sm }]}>Active issues</Text>
                          {h.activeIssues.map((d) => <Text key={d.code} style={styles.issue}>• {d.code} — {d.desc}</Text>)}
                        </>
                      )}
                      {h.historyIssues.length > 0 && (
                        <>
                          <Text style={[styles.detLabel, { marginTop: spacing.sm }]}>Historical (pending)</Text>
                          {h.historyIssues.map((d) => <Text key={d.code} style={styles.issueDim}>• {d.code} — {d.desc}</Text>)}
                        </>
                      )}
                      {ai[m.key] ? (
                        <View style={styles.aiBox}><Text style={styles.aiText}>{ai[m.key].replace(/\*\*/g, "")}</Text></View>
                      ) : (
                        <Pressable testID={`ai-module-${m.key}`} style={styles.aiBtn} onPress={() => runAi(h)} disabled={aiLoading === m.key}>
                          {aiLoading === m.key ? <ActivityIndicator color={colors.brand} /> : (
                            <><MaterialCommunityIcons name="robot" size={16} color={colors.brand} /><Text style={styles.aiBtnText}>AI health explanation</Text></>
                          )}
                        </Pressable>
                      )}
                    </View>
                  )}
                </View>
              );
            })}
          </>
        ) : (
          <>
            {/* VIN verification */}
            <View style={styles.dataCard} testID="vin-verify">
              <View style={styles.dataHead}><MaterialCommunityIcons name="barcode" size={18} color={colors.brand} /><Text style={styles.dataTitle}>VIN VERIFICATION</Text></View>
              <Text style={styles.vinText}>{vin.vin || "—"}</Text>
              <View style={styles.badgeRow}>
                <Badge icon={vin.valid ? "check-decagram" : "alert"} text={vin.valid ? "Valid" : "Unverified"} color={vin.valid ? colors.success : colors.warning} />
                <Badge icon="database" text={vin.source.toUpperCase()} color={colors.onSurfaceSecondary} />
              </View>
            </View>

            {/* DTC classification */}
            <View style={styles.dataCard} testID="dtc-classes">
              <View style={styles.dataHead}><MaterialCommunityIcons name="alert-circle" size={18} color={colors.brand} /><Text style={styles.dataTitle}>FAULT CODES ({cls.total})</Text></View>
              <DtcGroup label="Stored / Confirmed" items={cls.stored} color={colors.error} />
              <DtcGroup label="Pending" items={cls.pending} color={colors.warning} />
              <DtcGroup label="Permanent" items={cls.permanent} color={colors.info} />
              {cls.manufacturer.length > 0 && <DtcGroup label="Manufacturer" items={cls.manufacturer} color={colors.onSurfaceSecondary} />}
              {cls.total === 0 && <Text style={styles.dim}>No fault codes stored.</Text>}
            </View>

            {/* Live ECU-sourced data — only shown with a real OBD-II connection.
                We never fabricate readiness/monitor/reliability values offline. */}
            {connected ? (
              <>
                {/* Readiness monitors */}
                <View style={styles.dataCard} testID="readiness">
                  <View style={styles.dataHead}><MaterialCommunityIcons name="checkbox-marked-circle-auto-outline" size={18} color={colors.brand} /><Text style={styles.dataTitle}>READINESS MONITORS</Text></View>
                  {monitors.map((mo) => (
                    <View key={mo.key} style={styles.monRow}>
                      <Text style={styles.monName}>{mo.name}</Text>
                      <View style={styles.monStatus}>
                        <View style={[styles.sDot, { backgroundColor: monColor(mo.status) }]} />
                        <Text style={[styles.monText, { color: monColor(mo.status) }]}>{mo.status === "ready" ? "READY" : mo.status === "not_ready" ? "NOT READY" : mo.status === "not_supported" ? "NOT SUPPORTED" : "UNAVAILABLE"}</Text>
                      </View>
                    </View>
                  ))}
                </View>

                {/* Mode 06 */}
                <View style={styles.dataCard} testID="mode06">
                  <View style={styles.dataHead}><MaterialCommunityIcons name="flask" size={18} color={colors.brand} /><Text style={styles.dataTitle}>MODE 06 · ON-BOARD MONITORS</Text></View>
                  {m06.map((t) => (
                    <View key={t.id} style={styles.m06Row}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.m06Name}>{t.name}</Text>
                        <Text style={styles.m06Range}>{t.id} · limit {t.min}–{t.max} {t.unit}</Text>
                      </View>
                      <Text style={styles.m06Val}>{t.value}</Text>
                      <MaterialCommunityIcons name={t.pass ? "check-circle" : "close-circle"} size={18} color={t.pass ? colors.success : colors.error} />
                    </View>
                  ))}
                </View>

                {/* Reliability */}
                <View style={styles.dataCard} testID="reliability">
                  <View style={styles.dataHead}><MaterialCommunityIcons name="shield-check" size={18} color={colors.brand} /><Text style={styles.dataTitle}>DIAGNOSTIC RELIABILITY</Text></View>
                  <View style={styles.relGrid}>
                    <Rel label="DATA QUALITY" value={`${rel.dataQuality}`} accent />
                    <Rel label="COMM" value={rel.commQuality.toUpperCase()} />
                    <Rel label="LATENCY" value={`${rel.latencyMs}ms`} />
                    <Rel label="SUPPORTED PIDs" value={`${rel.supportedPidCount}`} />
                    <Rel label="UNSUPPORTED" value={`${rel.unsupportedPidCount}`} />
                    <Rel label="RETRY RATE" value={`${Math.round(rel.retryRate * 100)}%`} />
                    <Rel label="PID CONF." value={`${Math.round(rel.avgPidConfidence * 100)}%`} />
                    <Rel label="SENSOR CHK" value={`${rel.sensorChecksPassed}/${rel.sensorChecksTotal}`} />
                  </View>
                </View>
              </>
            ) : (
              <View style={styles.dataCard} testID="ecu-live-unavailable">
                <View style={styles.dataHead}><MaterialCommunityIcons name="access-point-network-off" size={18} color={colors.onSurfaceSecondary} /><Text style={styles.dataTitle}>READINESS · MODE 06 · RELIABILITY</Text></View>
                <Text style={styles.dim}>Unavailable from vehicle. Connect an OBD-II adapter to read live readiness monitors, Mode 06 results and diagnostic reliability directly from the ECU.</Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Badge({ icon, text, color }: { icon: string; text: string; color: string }) {
  return <View style={[styles.badge, { borderColor: color }]}><MaterialCommunityIcons name={icon as any} size={11} color={color} /><Text style={[styles.badgeText, { color }]}>{text}</Text></View>;
}
function DtcGroup({ label, items, color }: { label: string; items: any[]; color: string }) {
  if (items.length === 0) return null;
  return (
    <View style={{ marginTop: spacing.sm }}>
      <Text style={[styles.dtcGroupLabel, { color }]}>{label} ({items.length})</Text>
      {items.map((d) => <Text key={d.code} style={styles.dtcLine}><Text style={{ fontFamily: font.display, color }}>{d.code}</Text> — {d.desc}</Text>)}
    </View>
  );
}
function Rel({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return <View style={styles.relCell}><Text style={styles.relLabel}>{label}</Text><Text style={[styles.relVal, accent && { color: colors.brand }]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1.2 },
  tabs: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  tab: { flex: 1, paddingVertical: 10, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary, alignItems: "center" },
  tabActive: { borderColor: colors.brand, backgroundColor: colors.brandTertiary },
  tabText: { color: colors.onSurfaceSecondary, fontSize: 11, fontWeight: "700", letterSpacing: 1 },
  tabTextActive: { color: colors.brand },
  warn: { color: colors.warning, fontSize: 12, paddingHorizontal: spacing.lg, paddingBottom: spacing.xs },
  count: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: spacing.md },
  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.md },
  cardTop: { flexDirection: "row", alignItems: "center" },
  mName: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  mSub: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 1 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  sDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 9, fontWeight: "800" },
  healthRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md },
  hbarTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.surfaceTertiary, overflow: "hidden" },
  hbarFill: { height: "100%", borderRadius: 3 },
  hscore: { fontFamily: font.display, fontSize: 16, width: 34, textAlign: "right" },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  badge: { flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 10, fontWeight: "700" },
  detail: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider, paddingTop: spacing.sm },
  detLine: { color: colors.onSurfaceTertiary, fontSize: 13, marginBottom: spacing.xs },
  detLabel: { color: colors.onSurfaceSecondary, fontSize: 10, letterSpacing: 1, fontWeight: "700", marginBottom: spacing.xs },
  fnWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  fnChip: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 8, paddingVertical: 4 },
  fnText: { color: colors.onSurfaceTertiary, fontSize: 11 },
  issue: { color: colors.onSurface, fontSize: 13, marginTop: 2 },
  issueDim: { color: colors.onSurfaceSecondary, fontSize: 13, marginTop: 2 },
  aiBox: { backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginTop: spacing.sm },
  aiText: { color: colors.onSurfaceTertiary, fontSize: 13, lineHeight: 19 },
  aiBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: colors.brand, borderRadius: radius.sm, paddingVertical: 10, marginTop: spacing.sm, backgroundColor: colors.brandTertiary },
  aiBtnText: { color: colors.brand, fontWeight: "700", fontSize: 13 },
  dataCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md },
  dataHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.sm },
  dataTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 1.5, fontWeight: "700" },
  vinText: { color: colors.onSurface, fontFamily: font.display, fontSize: 18, letterSpacing: 1 },
  dim: { color: colors.onSurfaceSecondary, fontSize: 13 },
  dtcGroupLabel: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  dtcLine: { color: colors.onSurfaceTertiary, fontSize: 13, marginTop: 3 },
  monRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: colors.divider },
  monName: { color: colors.onSurface, fontSize: 13 },
  monStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  monText: { fontSize: 11, fontWeight: "700" },
  m06Row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.divider },
  m06Name: { color: colors.onSurface, fontSize: 13 },
  m06Range: { color: colors.onSurfaceSecondary, fontSize: 10, marginTop: 1 },
  m06Val: { color: colors.onSurface, fontFamily: font.display, fontSize: 16 },
  relGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  relCell: { flexGrow: 1, flexBasis: "22%", backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, alignItems: "center" },
  relLabel: { color: colors.onSurfaceSecondary, fontSize: 8, letterSpacing: 0.5, textAlign: "center" },
  relVal: { color: colors.onSurface, fontFamily: font.display, fontSize: 16, marginTop: 2 },
});
