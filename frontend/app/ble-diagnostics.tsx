import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useVehicle } from "@/src/vehicle/service";
import { ConnectionDiagnostics, FreezeFrame, ObdLogEntry, BleStatusReport } from "@/src/vehicle/types";
import { PID_CATALOG } from "@/src/vehicle/health";
import { colors, font, radius, spacing } from "@/src/theme";

const qColor = (q: string) =>
  q === "excellent" ? colors.success : q === "good" ? colors.info : q === "fair" ? colors.warning : colors.error;

export default function BleDiagnostics() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { getDiagnostics, getLog, getStatusReport, readFreezeFrame, reconnect, connection, mode } = useVehicle();
  const [diag, setDiag] = useState<ConnectionDiagnostics | null>(null);
  const [report, setReport] = useState<BleStatusReport | null>(null);
  const [log, setLog] = useState<ObdLogEntry[]>([]);
  const [freeze, setFreeze] = useState<FreezeFrame | null>(null);
  const [loadingFreeze, setLoadingFreeze] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const logRef = useRef<ScrollView>(null);

  useEffect(() => {
    const tick = () => {
      setDiag(getDiagnostics());
      setReport(getStatusReport());
      setLog([...getLog()].slice(-40));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [getDiagnostics, getLog, getStatusReport]);

  const loadFreeze = async () => {
    setLoadingFreeze(true);
    try {
      setFreeze(await readFreezeFrame());
    } catch {}
    setLoadingFreeze(false);
  };

  const doReconnect = async () => {
    setReconnecting(true);
    try {
      await reconnect();
    } catch {}
    setReconnecting(false);
  };

  const metaFor = (k: string) => PID_CATALOG.find((p) => p.key === k);

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="blediag-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>CONNECTION DIAGNOSTICS</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }}>
        {/* Always-on developer status report */}
        {report && (
          <View style={styles.reportCard} testID="provider-status-report">
            <Text style={styles.sectionTitle}>PROVIDER STATUS REPORT</Text>
            <StatusRow label="Platform" value={Platform.OS.toUpperCase()} good />
            <StatusRow label="Vehicle mode" value={report.mode === "ble" ? "BLE" : "SIMULATION"} good={report.mode === "ble"} />
            <StatusRow label="Runtime provider" value={report.runtimeProvider} good={report.runtimeProvider.startsWith("BLEProvider")} />
            <StatusRow label="SimulationProvider active" bool={report.mode === "simulation"} invert />
            <StatusRow label="BLEProvider active" bool={report.mode === "ble"} />
            <StatusRow label="Native BLE available" bool={report.nativeBleAvailable} />
            <StatusRow
              label="Bluetooth"
              value={report.bluetoothPoweredOn == null ? "UNKNOWN" : report.bluetoothPoweredOn ? "ON" : "OFF"}
              good={report.bluetoothPoweredOn === true}
              bad={report.bluetoothPoweredOn === false}
            />
            <StatusRow
              label="Permissions"
              value={report.permissions.toUpperCase()}
              good={report.permissions === "granted" || report.permissions === "n/a"}
              bad={report.permissions === "denied"}
            />
            <StatusRow label="Adapter" value={diag?.adapterName || "—"} good={!!diag?.adapterName} />
            <StatusRow label="Adapter discovered" bool={report.adapterDiscovered} />
            <StatusRow label="Adapter connected" bool={report.adapterConnected} />
            <StatusRow label="Services discovered" bool={report.servicesDiscovered} />
            <StatusRow label="Characteristics discovered" bool={report.characteristicsDiscovered} />
            <StatusRow label="ELM327 initialized" bool={report.elm327Initialized} />
            <StatusRow label="OBD protocol" value={report.protocol} good={report.protocol !== "Unknown"} />
            <StatusRow label="VIN received" bool={report.vinReceived} />
            <StatusRow label="Last real PID" value={report.lastRealPid || "—"} good={!!report.lastRealPid} />
            <StatusRow
              label="Last real PID timestamp"
              value={report.lastRealPidTs ? new Date(report.lastRealPidTs).toLocaleTimeString() : "—"}
              good={!!report.lastRealPidTs}
            />
            <StatusRow label="Real PID polling active" bool={report.pollingActive} />
            <StatusRow label="DTC response received" bool={report.dtcResponseReceived} />
            <StatusRow label="ECU communication" bool={report.ecuCommunication} />
            <StatusRow label="Simulated vehicle data generated" bool={report.simulatedDataGenerated} invert />
            {report.lastError ? (
              <View style={styles.reportErr}>
                <MaterialCommunityIcons name="alert-circle" size={14} color={colors.error} />
                <Text style={styles.reportErrText}>{report.lastError}</Text>
              </View>
            ) : null}
          </View>
        )}

        {!diag ? (
          <View style={styles.notConnected} testID="blediag-empty">
            <MaterialCommunityIcons name="bluetooth-off" size={44} color={colors.onSurfaceSecondary} />
            <Text style={styles.emptyText}>No adapter connected.</Text>
            <Pressable style={styles.reconnectBtn} onPress={() => router.replace("/connect")}>
              <Text style={styles.reconnectText}>OPEN CONNECTION CENTER</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {/* Status banner */}
            <View style={[styles.banner, { borderColor: qColor(diag.quality) }]} testID="blediag-status">
              <View style={[styles.pulse, { backgroundColor: connection === "connected" ? colors.success : colors.warning }]} />
              <Text style={styles.bannerText}>
                {connection === "connected" ? "LINK ACTIVE" : connection.toUpperCase()}
              </Text>
              <Text style={[styles.bannerQuality, { color: qColor(diag.quality) }]}>
                {diag.quality.toUpperCase()}
              </Text>
            </View>

            {/* Key metrics */}
            <View style={styles.grid}>
              <Metric label="ADAPTER" value={diag.adapterName} wide />
              <Metric label="DEVICE ID" value={diag.deviceId} wide />
              <Metric label="PROTOCOL" value={diag.protocol} wide />
              <Metric label="VOLTAGE" value={`${diag.voltage.toFixed(1)} V`} accent={diag.voltage < 12.2 ? colors.warning : colors.success} />
              <Metric label="LATENCY" value={`${diag.latencyMs} ms`} accent={diag.latencyMs > 120 ? colors.warning : colors.brand} />
              <Metric label="SUPPORTED PIDs" value={`${diag.supportedPidCount}`} />
              <Metric label="RECONNECTS" value={`${diag.reconnectAttempts}`} />
            </View>

            <Pressable testID="blediag-reconnect" style={styles.reconnectBtn} onPress={doReconnect} disabled={reconnecting}>
              {reconnecting ? (
                <ActivityIndicator color={colors.onBrandPrimary} />
              ) : (
                <>
                  <MaterialCommunityIcons name="bluetooth-connect" size={18} color={colors.onBrandPrimary} />
                  <Text style={styles.reconnectText}>RECONNECT ADAPTER</Text>
                </>
              )}
            </Pressable>

            {/* Freeze frame */}
            <View style={styles.section}>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>FREEZE FRAME</Text>
                <Pressable testID="load-freeze" onPress={loadFreeze}>
                  <Text style={styles.link}>{freeze ? "Refresh" : "Load"}</Text>
                </Pressable>
              </View>
              {loadingFreeze ? (
                <ActivityIndicator color={colors.brand} style={{ marginVertical: spacing.md }} />
              ) : freeze ? (
                <View testID="freeze-frame">
                  <Text style={styles.freezeCode}>Captured at DTC {freeze.code || "—"}</Text>
                  <View style={styles.freezeGrid}>
                    {Object.entries(freeze.signals).map(([k, v]) => {
                      const m = metaFor(k);
                      return (
                        <View key={k} style={styles.freezeCell}>
                          <Text style={styles.freezeLabel}>{m?.label || k}</Text>
                          <Text style={styles.freezeVal}>
                            {v as number}
                            <Text style={styles.freezeUnit}> {m?.unit || ""}</Text>
                          </Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ) : (
                <Text style={styles.hint}>Load the snapshot of sensor values captured when the DTC set.</Text>
              )}
            </View>

            {/* OBD log monitor */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>OBD-II REQUEST / RESPONSE LOG</Text>
              <View style={styles.console} testID="obd-log">
                <ScrollView
                  ref={logRef}
                  style={{ maxHeight: 240 }}
                  onContentSizeChange={() => logRef.current?.scrollToEnd({ animated: false })}
                >
                  {log.length === 0 ? (
                    <Text style={styles.logHint}>Waiting for OBD traffic…</Text>
                  ) : (
                    log.map((e, i) => (
                      <Text key={i} style={styles.logLine}>
                        <Text style={{ color: colors.onSurfaceSecondary }}>{time(e.ts)} </Text>
                        <Text style={{ color: e.dir === "tx" ? colors.info : e.ok ? colors.success : colors.error }}>
                          {e.dir === "tx" ? "» " : "« "}
                        </Text>
                        <Text style={{ color: colors.onSurfaceTertiary }}>{e.dir === "tx" ? e.cmd : e.data}</Text>
                        {e.latencyMs != null ? <Text style={{ color: colors.onSurfaceSecondary }}>  {e.latencyMs}ms</Text> : null}
                      </Text>
                    ))
                  )}
                </ScrollView>
              </View>
              <Text style={styles.modeNote}>
                {mode === "ble"
                  ? "Live BLE transport — real ELM327 traffic."
                  : "Simulation transport — synthetic OBD frames. Real traffic appears on a native BLE build."}
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StatusRow({ label, value, bool, good, bad, invert }: { label: string; value?: string; bool?: boolean; good?: boolean; bad?: boolean; invert?: boolean }) {
  const isYesNo = typeof bool === "boolean";
  const display = isYesNo ? (bool ? "YES" : "NO") : value ?? "—";
  // invert: a YES is undesirable (e.g. "Simulated data generated"), so YES→red, NO→green.
  const positive = isYesNo ? (invert ? !bool : bool) : good;
  const negative = isYesNo ? (invert ? bool : !bool) : bad;
  const color = positive ? colors.success : negative ? colors.error : colors.onSurface;
  return (
    <View style={styles.statusRow}>
      <Text style={styles.statusLabel}>{label}</Text>
      <Text style={[styles.statusValue, { color }]} numberOfLines={1}>{display}</Text>
    </View>
  );
}

function Metric({ label, value, wide, accent }: { label: string; value: string; wide?: boolean; accent?: string }) {
  return (
    <View style={[styles.metric, wide && { flexBasis: "100%" }]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, accent ? { color: accent } : null]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const time = (ts: number) => new Date(ts).toLocaleTimeString([], { hour12: false }) + "." + String(ts % 1000).padStart(3, "0");

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 18, letterSpacing: 1.5 },
  reportCard: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  statusLabel: { color: colors.onSurfaceSecondary, fontSize: 13 },
  statusValue: { fontFamily: font.display, fontSize: 14, maxWidth: "55%" },
  reportErr: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  reportErrText: { color: colors.error, fontSize: 12, flex: 1 },
  notConnected: { alignItems: "center", paddingVertical: spacing["3xl"], gap: spacing.md },
  emptyText: { color: colors.onSurfaceSecondary },
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    backgroundColor: colors.surfaceSecondary,
    marginBottom: spacing.md,
  },
  pulse: { width: 10, height: 10, borderRadius: 5 },
  bannerText: { color: colors.onSurface, fontFamily: font.display, fontSize: 18, flex: 1 },
  bannerQuality: { fontFamily: font.display, fontSize: 16 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: {
    flexGrow: 1,
    flexBasis: "45%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  metricLabel: { color: colors.onSurfaceSecondary, fontSize: 10, letterSpacing: 1 },
  metricValue: { color: colors.onSurface, fontFamily: font.display, fontSize: 20, marginTop: 2 },
  reconnectBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: spacing.md,
  },
  reconnectText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 1 },
  section: { marginTop: spacing.xl },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 2, fontWeight: "700", marginBottom: spacing.sm },
  link: { color: colors.brand, fontWeight: "700" },
  hint: { color: colors.onSurfaceSecondary, fontSize: 13 },
  freezeCode: { color: colors.warning, fontSize: 13, marginBottom: spacing.sm },
  freezeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  freezeCell: {
    flexGrow: 1,
    flexBasis: "30%",
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  freezeLabel: { color: colors.onSurfaceSecondary, fontSize: 9 },
  freezeVal: { color: colors.onSurface, fontFamily: font.display, fontSize: 18 },
  freezeUnit: { fontSize: 10, color: colors.onSurfaceSecondary },
  console: {
    backgroundColor: "#03040A",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  logHint: { color: colors.onSurfaceSecondary, fontSize: 12 },
  logLine: { fontSize: 11, fontFamily: font.display, lineHeight: 18 },
  modeNote: { color: colors.onSurfaceSecondary, fontSize: 11, marginTop: spacing.sm, fontStyle: "italic" },
});
