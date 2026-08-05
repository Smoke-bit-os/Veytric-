import React, { useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable, Modal, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Gauge from "@/src/components/Gauge";
import { useVehicle } from "@/src/vehicle/service";
import { useRecording } from "@/src/vehicle/recording/recordingContext";
import { colors, font, radius, spacing } from "@/src/theme";

type LiveEvent = { key: string; type: string; label: string; severity: "info" | "warn" | "bad"; at: number };

const sevColor = (s: string) => (s === "bad" ? colors.error : s === "warn" ? colors.warning : colors.info);

const fmtTime = (ms: number) => {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

export default function RecordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signals, dtcs, identity, connection, mode } = useVehicle();
  const { state, durationMs, sampleCount, start, pause, resume, stopAndSave, cancel } = useRecording();

  const [liveEvents, setLiveEvents] = useState<LiveEvent[]>([]);
  const lastEvent = useRef<Record<string, number>>({});
  const [saveModal, setSaveModal] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const connected = connection === "connected";

  // Live event detection while recording (mirrors telemetry/events thresholds).
  useEffect(() => {
    if (state !== "recording") return;
    const now = durationMs;
    const push = (type: string, label: string, severity: LiveEvent["severity"]) => {
      if (lastEvent.current[type] != null && now - lastEvent.current[type] < 3000) return;
      lastEvent.current[type] = now;
      setLiveEvents((prev) => [{ key: `${type}-${now}`, type, label, severity, at: now }, ...prev].slice(0, 40));
    };
    if ((signals.throttle ?? 0) >= 90) push("wot", "Wide Open Throttle", "info");
    if ((signals.coolantTemp ?? 0) > 104) push("high_coolant", "High Coolant Temp", "bad");
    if ((signals.batteryVoltage ?? 14) < 12.0) push("voltage_drop", "Battery Voltage Drop", "warn");
    if ((signals.rpm ?? 0) > 800 && (signals.chargingVoltage ?? 14) < 13.4) push("charging_problem", "Charging Problem", "bad");
    if ((signals.knockRetard ?? 0) > 3) push("knock", "Knock Event", "bad");
    if (Math.abs(signals.longFuelTrim ?? 0) > 10) push("fuel_trim", "Fuel Trim Anomaly", "warn");
    if ((signals.rpm ?? 0) > 5500) push("high_rpm", "High RPM Zone", "info");
  }, [signals, state, durationMs]);

  const onStart = () => {
    setLiveEvents([]);
    lastEvent.current = {};
    start();
  };

  const openSave = () => {
    pause();
    setName(`Drive · ${new Date().toLocaleDateString([], { month: "short", day: "numeric" })} ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`);
    setSaveModal(true);
  };

  const onDiscard = () => {
    cancel();
    setLiveEvents([]);
    setSaveModal(false);
    router.back();
  };

  const onSave = async () => {
    setSaving(true);
    const id = await stopAndSave({ name: name || "Drive Session", notes, driverNotes: notes });
    setSaving(false);
    setSaveModal(false);
    setLiveEvents([]);
    if (id) router.replace(`/playback?id=${id}`);
    else router.replace("/recordings");
  };

  const recording = state === "recording";
  const paused = state === "paused";
  const active = recording || paused;

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable
          testID="record-back"
          onPress={() => (active ? openSave() : router.back())}
          hitSlop={12}
        >
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>PERFORMANCE RECORDER</Text>
        <Pressable testID="open-sessions" onPress={() => router.push("/recordings")} hitSlop={12}>
          <MaterialCommunityIcons name="history" size={22} color={colors.brand} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + 160 }} showsVerticalScrollIndicator={false}>
        {/* Status + timer */}
        <View style={styles.timerCard} testID="recorder-status">
          <View style={styles.statusRow}>
            <View style={[styles.recDot, { backgroundColor: recording ? colors.error : paused ? colors.warning : colors.onSurfaceSecondary }]} />
            <Text style={styles.statusText}>
              {recording ? "RECORDING" : paused ? "PAUSED" : "READY"}
            </Text>
            <Text style={styles.modeTag}>{mode === "ble" ? "BLE" : "SIM"}</Text>
          </View>
          <Text style={styles.timer} testID="recorder-timer">{fmtTime(durationMs)}</Text>
          <Text style={styles.samples}>{sampleCount} samples captured</Text>
          {!connected && (
            <Text style={styles.warn}>No vehicle connected — connect first for live data.</Text>
          )}
        </View>

        {/* Large live gauges */}
        <View style={styles.grid}>
          <Gauge label="Engine RPM" value={Math.round(signals.rpm)} max={7000} numeric={signals.rpm} testID="rec-gauge-rpm" />
          <Gauge label="Speed" value={Math.round(signals.speed)} unit="km/h" max={200} numeric={signals.speed} testID="rec-gauge-speed" />
        </View>
        <View style={styles.grid}>
          <Gauge label="Coolant" value={Math.round(signals.coolantTemp)} unit="°C" min={60} max={120} numeric={signals.coolantTemp} accent={signals.coolantTemp > 100 ? colors.warning : colors.brand} testID="rec-gauge-coolant" />
          <Gauge label="Battery" value={signals.batteryVoltage.toFixed(1)} unit="V" min={11} max={15} numeric={signals.batteryVoltage} accent={signals.batteryVoltage < 12.3 ? colors.warning : colors.success} testID="rec-gauge-battery" />
        </View>
        <View style={styles.grid}>
          <Gauge label="Throttle" value={Math.round(signals.throttle)} unit="%" max={100} numeric={signals.throttle} testID="rec-gauge-throttle" />
          <Gauge label="Boost / MAP" value={Math.round(signals.boost)} unit="kPa" max={200} numeric={signals.boost} testID="rec-gauge-boost" />
        </View>

        {/* Live event feed */}
        <Text style={styles.sectionTitle}>LIVE EVENT FEED</Text>
        {liveEvents.length === 0 ? (
          <Text style={styles.dim}>{active ? "Watching telemetry for events…" : "Start a session to capture driving events."}</Text>
        ) : (
          liveEvents.map((e) => (
            <View key={e.key} style={styles.eventRow} testID={`live-event-${e.type}`}>
              <View style={[styles.evDot, { backgroundColor: sevColor(e.severity) }]} />
              <Text style={styles.evLabel}>{e.label}</Text>
              <Text style={styles.evTime}>{fmtTime(e.at)}</Text>
            </View>
          ))
        )}
      </ScrollView>

      {/* Transport controls */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + spacing.md }]}>
        {!active ? (
          <Pressable testID="btn-start" style={styles.startBtn} onPress={onStart}>
            <LinearGradient colors={[colors.error, "#B71C1C"]} style={styles.startGrad}>
              <MaterialCommunityIcons name="record-circle" size={26} color="#fff" />
              <Text style={styles.startText}>START RECORDING</Text>
            </LinearGradient>
          </Pressable>
        ) : (
          <View style={styles.ctrlRow}>
            {recording ? (
              <Pressable testID="btn-pause" style={styles.ctrlBtn} onPress={pause}>
                <MaterialCommunityIcons name="pause" size={24} color={colors.warning} />
                <Text style={[styles.ctrlText, { color: colors.warning }]}>Pause</Text>
              </Pressable>
            ) : (
              <Pressable testID="btn-resume" style={styles.ctrlBtn} onPress={resume}>
                <MaterialCommunityIcons name="play" size={24} color={colors.success} />
                <Text style={[styles.ctrlText, { color: colors.success }]}>Resume</Text>
              </Pressable>
            )}
            <Pressable testID="btn-stop" style={[styles.ctrlBtn, styles.stopBtn]} onPress={openSave}>
              <MaterialCommunityIcons name="stop" size={24} color={colors.error} />
              <Text style={[styles.ctrlText, { color: colors.error }]}>Stop & Save</Text>
            </Pressable>
          </View>
        )}
      </View>

      {/* Save modal */}
      <Modal visible={saveModal} transparent animationType="slide" onRequestClose={() => setSaveModal(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSaveModal(false)} />
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing.lg }]}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Save Session</Text>
            <Text style={styles.sheetMeta}>
              {fmtTime(durationMs)} · {sampleCount} samples{identity?.vin ? ` · ${identity.year} ${identity.make} ${identity.model}` : ""}
            </Text>
            <TextInput
              testID="session-name"
              style={styles.input}
              placeholder="Session name"
              placeholderTextColor={colors.onSurfaceSecondary}
              value={name}
              onChangeText={setName}
            />
            <TextInput
              testID="session-notes"
              style={[styles.input, { height: 90, textAlignVertical: "top" }]}
              placeholder="Driver notes (road, weather, mods…)"
              placeholderTextColor={colors.onSurfaceSecondary}
              value={notes}
              onChangeText={setNotes}
              multiline
            />
            <Pressable testID="btn-save-session" style={styles.saveBtn} onPress={onSave} disabled={saving}>
              <LinearGradient colors={[colors.brand, colors.brandSecondary]} style={styles.saveGrad}>
                {saving ? <ActivityIndicator color={colors.onBrandPrimary} /> : <Text style={styles.saveText}>SAVE SESSION</Text>}
              </LinearGradient>
            </Pressable>
            <Pressable testID="btn-discard" style={styles.discardBtn} onPress={onDiscard}>
              <Text style={styles.discardText}>Discard</Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1.5 },
  timerCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, alignItems: "center", marginBottom: spacing.md },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  recDot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { color: colors.onSurface, fontSize: 12, letterSpacing: 2, fontWeight: "700" },
  modeTag: { color: colors.brand, fontSize: 10, fontWeight: "700", borderWidth: 1, borderColor: colors.brand, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 4 },
  timer: { color: colors.onSurface, fontFamily: font.display, fontSize: 64, letterSpacing: 2, marginTop: spacing.sm },
  samples: { color: colors.onSurfaceSecondary, fontSize: 12 },
  warn: { color: colors.warning, fontSize: 12, marginTop: spacing.sm },
  grid: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 2, fontWeight: "700", marginTop: spacing.lg, marginBottom: spacing.sm },
  dim: { color: colors.onSurfaceSecondary, fontSize: 13 },
  eventRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.xs },
  evDot: { width: 8, height: 8, borderRadius: 4 },
  evLabel: { flex: 1, color: colors.onSurface, fontSize: 14 },
  evTime: { color: colors.onSurfaceSecondary, fontFamily: font.display, fontSize: 14 },
  controls: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingTop: spacing.md, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.divider },
  startBtn: { borderRadius: radius.md, overflow: "hidden" },
  startGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingVertical: 18 },
  startText: { color: "#fff", fontWeight: "800", letterSpacing: 1.5, fontSize: 15 },
  ctrlRow: { flexDirection: "row", gap: spacing.md },
  ctrlBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceSecondary },
  stopBtn: { borderColor: colors.error },
  ctrlText: { fontWeight: "700", fontSize: 15 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: { backgroundColor: colors.surfaceSecondary, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, borderTopWidth: 1, borderColor: colors.border },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, alignSelf: "center", marginBottom: spacing.md },
  sheetTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 24 },
  sheetMeta: { color: colors.onSurfaceSecondary, fontSize: 12, marginBottom: spacing.md, marginTop: 2 },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.lg, paddingVertical: 14, marginBottom: spacing.md, fontSize: 15 },
  saveBtn: { borderRadius: radius.md, overflow: "hidden" },
  saveGrad: { paddingVertical: 16, alignItems: "center" },
  saveText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 1.5 },
  discardBtn: { alignItems: "center", paddingVertical: spacing.md, marginTop: spacing.xs },
  discardText: { color: colors.onSurfaceSecondary, fontSize: 14 },
});
