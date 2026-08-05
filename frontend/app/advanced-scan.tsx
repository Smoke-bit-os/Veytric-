import React, { useCallback, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from "react-native";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useVehicle } from "@/src/vehicle/service";
import { discoverModules } from "@/src/vehicle/ecu/ecuService";
import { readinessMonitors } from "@/src/vehicle/diagnostics/dtcClassifier";
import { reliabilityReport } from "@/src/vehicle/diagnostics/reliability";
import { SYSTEMS, systemStatus } from "@/src/vehicle/system-monitor/systems";
import { WORKFLOWS, WorkflowDef, runScan, scanService } from "@/src/vehicle/diagnostics/scanWorkflow";
import { colors, font, radius, spacing } from "@/src/theme";

const wfColor = (s: number) => (s >= 80 ? colors.success : s >= 60 ? colors.warning : colors.error);

export default function AdvancedScanScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { identity, dtcs, signals, connection, getDiagnostics, getLog } = useVehicle();
  const connected = connection === "connected";
  const [running, setRunning] = useState<WorkflowDef | null>(null);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState("");
  const [scans, setScans] = useState<any[]>([]);
  const timer = useRef<any>(null);

  const load = useCallback(() => {
    scanService.list(id).then((r: any) => setScans(r || [])).catch(() => {});
  }, [id]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const start = (wf: WorkflowDef) => {
    if (!connected) { Alert.alert("Not connected", "Connect to a vehicle to run a scan."); return; }
    setRunning(wf);
    setProgress(0);
    const phases = ["Establishing link…", "Polling ECUs…", "Reading fault memory…", "Evaluating systems…", "Compiling report…"];
    let p = 0;
    const step = 100 / (wf.durationMs / 120);
    timer.current = setInterval(() => {
      p = Math.min(96, p + step);
      setProgress(p);
      setPhase(phases[Math.min(phases.length - 1, Math.floor((p / 100) * phases.length))]);
    }, 120);
    setTimeout(() => finish(wf), wf.durationMs);
  };

  const finish = async (wf: WorkflowDef) => {
    if (timer.current) clearInterval(timer.current);
    setProgress(98);
    setPhase("Generating AI report…");
    const diag = getDiagnostics();
    const modules = discoverModules(identity, dtcs, diag, connected);
    const rel = reliabilityReport(signals, diag, getLog());
    const readiness = readinessMonitors(identity, dtcs);
    const filterKeys = wf.systemFilter || SYSTEMS.map((s) => s.key);
    const systems = SYSTEMS.filter((s) => filterKeys.includes(s.key)).map((s) => {
      const st = systemStatus(s.key, signals, dtcs);
      return { key: s.key, name: s.name, level: st.level, note: st.note };
    });
    try {
      const res: any = await runScan({ workflow: wf, vehicleId: id, identity, modules, dtcs, readiness, systems, reliability: rel });
      setRunning(null);
      router.push(`/scan-report?id=${res.id}`);
    } catch {
      setRunning(null);
      Alert.alert("Scan failed", "Could not complete the scan. Please try again.");
    }
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="scan-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>ADVANCED SCAN</Text>
        <View style={{ width: 28 }} />
      </View>

      {running ? (
        <View style={styles.runWrap} testID="scan-running">
          <View style={styles.radar}>
            <MaterialCommunityIcons name={running.icon as any} size={44} color={colors.brand} />
          </View>
          <Text style={styles.runName}>{running.name}</Text>
          <Text style={styles.runPhase}>{phase}</Text>
          <View style={styles.progTrack}><View style={[styles.progFill, { width: `${progress}%` }]} /></View>
          <Text style={styles.progPct}>{Math.round(progress)}%</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing.xl }} showsVerticalScrollIndicator={false}>
          {!connected && <Text style={styles.warn}>⚠ Connect to a vehicle to run a scan.</Text>}
          <Text style={styles.sectionTitle}>SELECT A WORKFLOW</Text>
          {WORKFLOWS.map((wf) => (
            <Pressable key={wf.key} testID={`workflow-${wf.key}`} style={styles.wfCard} onPress={() => start(wf)}>
              <View style={styles.wfIcon}><MaterialCommunityIcons name={wf.icon as any} size={24} color={colors.brand} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.wfName}>{wf.name}</Text>
                <Text style={styles.wfDesc}>{wf.desc}</Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={22} color={colors.onSurfaceSecondary} />
            </Pressable>
          ))}

          <Text style={styles.sectionTitle}>RECENT SCANS</Text>
          {scans.length === 0 ? (
            <Text style={styles.dim}>No scans yet. Run a workflow above.</Text>
          ) : (
            scans.map((s) => (
              <Pressable key={s.id} testID={`scan-${s.id}`} style={styles.scanRow} onPress={() => router.push(`/scan-report?id=${s.id}`)}>
                <View style={[styles.scoreRing, { borderColor: wfColor(s.overall_score ?? 0) }]}>
                  <Text style={[styles.scoreText, { color: wfColor(s.overall_score ?? 0) }]}>{s.overall_score ?? "—"}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.scanTitle}>{s.title}</Text>
                  <Text style={styles.scanMeta}>{new Date(s.created_at).toLocaleString()}</Text>
                </View>
                <MaterialCommunityIcons name="file-document-outline" size={20} color={colors.onSurfaceSecondary} />
              </Pressable>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1.2 },
  warn: { color: colors.warning, fontSize: 12, marginBottom: spacing.sm },
  sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 2, fontWeight: "700", marginTop: spacing.md, marginBottom: spacing.sm },
  dim: { color: colors.onSurfaceSecondary, fontSize: 13 },
  wfCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.sm },
  wfIcon: { width: 46, height: 46, borderRadius: radius.sm, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  wfName: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  wfDesc: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  runWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  radar: { width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: colors.brand, alignItems: "center", justifyContent: "center", backgroundColor: colors.brandTertiary },
  runName: { color: colors.onSurface, fontFamily: font.display, fontSize: 22 },
  runPhase: { color: colors.brand, fontSize: 14 },
  progTrack: { width: "80%", height: 8, borderRadius: 4, backgroundColor: colors.surfaceTertiary, overflow: "hidden", marginTop: spacing.md },
  progFill: { height: "100%", borderRadius: 4, backgroundColor: colors.brand },
  progPct: { color: colors.onSurfaceSecondary, fontFamily: font.display, fontSize: 16 },
  scanRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  scoreRing: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  scoreText: { fontFamily: font.display, fontSize: 16 },
  scanTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "600" },
  scanMeta: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 1 },
});
