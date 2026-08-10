import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withDelay,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { useVehicle } from "@/src/vehicle/service";
import { vinService } from "@/src/vehicle/vin/vinService";
import { profileService } from "@/src/vehicle/profile/profileService";
import { recordRawVin } from "@/src/vehicle/enrichment/vinHistory";
import { getKnownIssues } from "@/src/vehicle/database/knownIssues";
import { computeSubsystems, overallHealth } from "@/src/vehicle/health";
import { api } from "@/src/api";
import { colors, font, radius, spacing } from "@/src/theme";

type Phase = "scanning" | "found" | "connecting" | "connected" | "failed";

const NO_ADAPTER_MESSAGE =
  "No OBD-II Bluetooth adapter detected. Turn on Bluetooth and make sure the adapter is plugged into the vehicle.";

const FAILURE_CAUSES = [
  { icon: "bluetooth-off", label: "Bluetooth disabled", fix: "Enable Bluetooth in device settings." },
  { icon: "power-plug-off", label: "Adapter unplugged", fix: "Reseat the scanner firmly in the OBD-II port." },
  { icon: "key-off", label: "Ignition off", fix: "Turn the ignition to ON (engine may be off)." },
  { icon: "sleep", label: "Adapter asleep", fix: "Unplug for 10s and reconnect to wake it." },
  { icon: "sync-alert", label: "Protocol mismatch", fix: "JARVIS will retry with auto-protocol detection." },
];

function Wave({ delay, active }: { delay: number; active: boolean }) {
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = active
      ? withDelay(delay, withRepeat(withTiming(1, { duration: 2200, easing: Easing.out(Easing.ease) }), -1, false))
      : 0;
  }, [active]);
  const style = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(p.value, [0, 1], [0.3, 1.6]) }],
    opacity: interpolate(p.value, [0, 0.15, 1], [0, 0.55, 0]),
  }));
  return <Animated.View style={[styles.wave, style]} />;
}

export default function ConnectionCenter() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { scan, connect, adapter, identity, mode, connection, enrichIdentity, signals, dtcs } = useVehicle();
  const [phase, setPhase] = useState<Phase>(mode === "ble" ? "scanning" : "scanning");
  const [saved, setSaved] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const started = useRef(false);

  const announce = async (text: string) => {
    try {
      const res = await api.speak(text, "onyx");
      await setAudioModeAsync({ playsInSilentMode: true });
      createAudioPlayer({ uri: `data:${res.mime};base64,${res.audio}` }).play();
    } catch {}
  };

  const runSequence = async () => {
    setSaved(false);
    setSavedMsg("");
    setErrMsg("");
    setPhase("scanning");
    try {
      const adapters = await scan();
      if (!adapters.length) throw new Error(NO_ADAPTER_MESSAGE);
      setPhase("found");
      await new Promise((r) => setTimeout(r, 900));
      setPhase("connecting");
      const idn = await connect(adapters[0].id);
      setPhase("connected");
      announce("Vehicle connected successfully. Beginning complete system scan.");
      try {
        const decoded = await vinService.decodeVin(idn.vin);
        enrichIdentity(decoded);
        recordRawVin(idn.vin, mode === "ble" ? "ble-mode09" : "simulation");
        if (decoded.make && decoded.make !== "Unknown") {
          announce(`Vehicle identified. ${decoded.year || ""} ${decoded.make} ${decoded.model || ""}.`);
        }
      } catch {}
    } catch (e: any) {
      // Real BLE NEVER falls back to simulation — surface the exact reason.
      setErrMsg(e?.message || NO_ADAPTER_MESSAGE);
      setPhase("failed");
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    runSequence();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveToGarage = async () => {
    if (!identity) return;
    try {
      const res = await profileService.upsertByVin(
        identity.vin,
        identity,
        `${identity.year} ${identity.make} ${identity.model}`.trim()
      );
      try {
        const health = overallHealth(
          computeSubsystems({ signals, dtcs, identity, phase: "cruise", connected: true })
        );
        if (res?.id) await profileService.addHealthSample(res.id, health);
      } catch {}
      setSaved(true);
      setSavedMsg(res?.created === false ? "Profile updated" : "Saved to Garage");
    } catch (e: any) {
      setSavedMsg(e.message || "Could not save");
    }
  };

  const scanning = phase === "scanning" || phase === "connecting" || phase === "found";

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Text style={styles.title}>VEHICLE CONNECTION CENTER</Text>
        <Pressable testID="connect-close" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="close" size={24} color={colors.onSurfaceSecondary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing["2xl"] }} showsVerticalScrollIndicator={false}>
        {/* Radar */}
        <View style={styles.radar}>
          <Wave delay={0} active={scanning} />
          <Wave delay={700} active={scanning} />
          <Wave delay={1400} active={scanning} />
          <LinearGradient colors={[colors.brand, colors.brandSecondary]} style={styles.radarCore}>
            <MaterialCommunityIcons
              name={phase === "connected" ? "check-bold" : phase === "failed" ? "alert" : "bluetooth"}
              size={40}
              color={colors.onBrandPrimary}
            />
          </LinearGradient>
        </View>

        <Text style={styles.phaseText} testID="connect-phase">
          {phase === "scanning" && "Scanning for OBD-II adapters…"}
          {phase === "found" && "Innova scanner detected"}
          {phase === "connecting" && "Initializing adapter…"}
          {phase === "connected" && "Vehicle connected"}
          {phase === "failed" && "Connection failed"}
        </Text>
        <Text style={styles.modeTag}>{mode === "ble" ? "BLE TRANSPORT" : "SIMULATION MODE"}</Text>

        {/* Real-data indicator — only for the live BLE provider */}
        {mode === "ble" ? (
          <View style={styles.liveBanner} testID="live-ble-banner">
            <View style={[styles.liveDot, { backgroundColor: connection === "connected" ? colors.success : colors.warning }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.liveTitle}>LIVE BLE — REAL VEHICLE DATA</Text>
              <Text style={styles.liveSub}>
                {connection === "connected"
                  ? `Connected · ${adapter?.name || "OBD-II adapter"}`
                  : connection === "scanning" || connection === "connecting"
                  ? "Establishing Bluetooth link…"
                  : "No live link yet · scan to connect"}
              </Text>
            </View>
            <MaterialCommunityIcons name="bluetooth-audio" size={20} color={colors.brand} />
          </View>
        ) : (
          <View style={styles.simBanner} testID="sim-banner">
            <MaterialCommunityIcons name="flask-outline" size={16} color={colors.warning} />
            <Text style={styles.simText}>SIMULATION — synthetic data (web/preview). Real BLE runs on the native build.</Text>
          </View>
        )}

        {/* Connection card */}
        {phase === "connected" && adapter && (
          <View style={styles.card} testID="adapter-card">
            <View style={styles.cardHead}>
              <MaterialCommunityIcons name="access-point" size={22} color={colors.brand} />
              <Text style={styles.cardTitle}>{adapter.name}</Text>
              <View style={styles.qualityPill}>
                <Text style={styles.qualityText}>{adapter.quality.toUpperCase()}</Text>
              </View>
            </View>
            <View style={styles.statRow}>
              <Stat label="MODEL" value={adapter.model} />
              <Stat label="SIGNAL" value={`${adapter.rssi} dBm`} />
              <Stat label="BATTERY" value={adapter.battery != null ? `${adapter.battery}%` : "—"} />
            </View>
            <View style={styles.statRow}>
              <Stat label="FIRMWARE" value={adapter.firmware || "—"} />
              <Stat label="PROTOCOL" value={adapter.protocol} wide />
            </View>
            <Pressable
              testID="open-blediag"
              style={styles.diagBtn}
              onPress={() => router.push("/ble-diagnostics")}
            >
              <MaterialCommunityIcons name="chart-timeline-variant" size={16} color={colors.brand} />
              <Text style={styles.diagBtnText}>Connection Diagnostics</Text>
            </Pressable>
          </View>
        )}

        {/* Auto vehicle identification */}
        {phase === "connected" && identity && (
          <View style={styles.card} testID="identity-card">
            <View style={styles.cardHead}>
              <MaterialCommunityIcons name="car-info" size={22} color={colors.brand} />
              <Text style={styles.cardTitle}>Vehicle Identified</Text>
              {identity.confidence != null && identity.confidence > 0 && (
                <View style={styles.confPill}>
                  <MaterialCommunityIcons name="shield-check" size={11} color={colors.success} />
                  <Text style={styles.confText}>{Math.round((identity.confidence || 0) * 100)}% MATCH</Text>
                </View>
              )}
            </View>
            <View style={styles.vehImage} testID="vehicle-image">
              <MaterialCommunityIcons name="car-sports" size={52} color={colors.brand} />
              <Text style={styles.vehImageText}>VEHICLE PREVIEW</Text>
            </View>
            <Text style={styles.vehName}>
              {identity.year} {identity.make} {identity.model}
            </Text>
            <Text style={styles.vehTrim}>
              {identity.trim} · {identity.engine} · {identity.driveType}
            </Text>
            {identity.decodeSource && (
              <Text style={styles.sourceText}>
                VIN decoded via {String(identity.decodeSource).toUpperCase()}
                {identity.checksumValid ? " · checksum valid" : ""}
                {identity.plant ? ` · ${identity.plant}` : ""}
              </Text>
            )}
            <View style={styles.idGrid}>
              <Stat label="VIN" value={identity.vin} wide />
              <Stat label="TRANSMISSION" value={identity.transmission} wide />
              <Stat label="FUEL" value={identity.fuelType} />
              <Stat label="ODOMETER" value={identity.odometer ? `${identity.odometer.toLocaleString()} mi` : "—"} />
              <Stat label="EMISSIONS" value={identity.emissionsReady ? "Ready" : "Not Ready"} />
              <Stat label="ECU" value={identity.ecu} />
              <Stat label="CAL IDs" value={identity.calibrationIds.join(", ")} wide />
              <Stat label="PROTOCOLS" value={identity.protocols.join("; ")} wide />
            </View>

            {identity.ecuModules && identity.ecuModules.length > 0 && (
              <View style={styles.modulesWrap} testID="ecu-modules">
                <Text style={styles.modulesTitle}>ECU MODULES DETECTED</Text>
                <View style={styles.moduleRow}>
                  {identity.ecuModules.map((m) => (
                    <View key={m} style={styles.moduleChip}>
                      <MaterialCommunityIcons name="chip" size={12} color={colors.brand} />
                      <Text style={styles.moduleText}>{m}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            <View style={styles.knownRow} testID="known-issues-note">
              <MaterialCommunityIcons name="brain" size={14} color={colors.brand} />
              <Text style={styles.knownText}>
                JARVIS loaded {getKnownIssues(identity.make, identity.model).length} common failure patterns for this platform
              </Text>
            </View>

            <Pressable
              testID="save-to-garage"
              style={[styles.saveBtn, saved && styles.saveBtnDone]}
              onPress={saveToGarage}
              disabled={saved}
            >
              <MaterialCommunityIcons name={saved ? "check" : "content-save"} size={18} color={colors.onBrandPrimary} />
              <Text style={styles.saveText}>{saved ? "SAVED TO GARAGE" : "SAVE VEHICLE PROFILE"}</Text>
            </Pressable>
            {savedMsg && !saved ? <Text style={styles.err}>{savedMsg}</Text> : null}
          </View>
        )}

        {/* Failure recovery */}
        {phase === "failed" && (
          <View style={styles.card} testID="failure-card">
            <View style={styles.errRow} testID="connect-error">
              <MaterialCommunityIcons name="bluetooth-off" size={20} color={colors.error} />
              <Text style={styles.errText}>{errMsg || NO_ADAPTER_MESSAGE}</Text>
            </View>
            <Text style={styles.recoverTitle}>JARVIS diagnosis — likely causes</Text>
            {FAILURE_CAUSES.map((c) => (
              <View key={c.label} style={styles.recoverRow}>
                <MaterialCommunityIcons name={c.icon as any} size={20} color={colors.warning} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.recoverLabel}>{c.label}</Text>
                  <Text style={styles.recoverFix}>{c.fix}</Text>
                </View>
              </View>
            ))}
            <Pressable testID="retry-connect" style={styles.retryBtn} onPress={runSequence}>
              <MaterialCommunityIcons name="refresh" size={18} color={colors.onBrandPrimary} />
              <Text style={styles.saveText}>RETRY CONNECTION</Text>
            </Pressable>
          </View>
        )}

        {scanning && <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.lg }} />}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <View style={[styles.stat, wide && { flexBasis: "100%" }]}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 18, letterSpacing: 1.5 },
  radar: { height: 220, alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  wave: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    borderColor: colors.brand,
  },
  radarCore: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.brand,
    shadowOpacity: 0.8,
    shadowRadius: 24,
    elevation: 16,
  },
  phaseText: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, textAlign: "center", marginTop: spacing.lg },
  modeTag: { color: colors.brand, fontSize: 10, letterSpacing: 2, textAlign: "center", marginTop: 4, marginBottom: spacing.md },
  liveBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand,
    backgroundColor: colors.brandTertiary,
  },
  liveDot: { width: 12, height: 12, borderRadius: 6 },
  liveTitle: { color: colors.brand, fontFamily: font.display, fontSize: 14, letterSpacing: 1 },
  liveSub: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 2 },
  simBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.warning,
    backgroundColor: colors.warning + "18",
  },
  simText: { color: colors.warning, fontSize: 11, flex: 1 },
  errRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.error + "18",
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  errText: { color: colors.error, fontSize: 13, flex: 1, fontWeight: "600" },
  card: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.lg,
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  cardTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 18, flex: 1 },
  qualityPill: { backgroundColor: colors.success + "22", borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  qualityText: { color: colors.success, fontSize: 10, fontWeight: "700" },
  diagBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingVertical: 12,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.brand,
  },
  diagBtnText: { color: colors.brand, fontWeight: "700" },
  statRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  stat: { flexGrow: 1, flexBasis: "30%", backgroundColor: colors.surface, borderRadius: radius.sm, padding: spacing.sm },
  statLabel: { color: colors.onSurfaceSecondary, fontSize: 9, letterSpacing: 1 },
  statValue: { color: colors.onSurface, fontSize: 13, marginTop: 2, fontWeight: "600" },
  vehName: { color: colors.brand, fontFamily: font.display, fontSize: 26 },
  vehTrim: { color: colors.onSurfaceSecondary, fontSize: 13, marginBottom: spacing.md },
  confPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.success + "22",
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  confText: { color: colors.success, fontSize: 10, fontWeight: "700" },
  vehImage: {
    height: 96,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceTertiary,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
    gap: 4,
  },
  vehImageText: { color: colors.onSurfaceSecondary, fontSize: 9, letterSpacing: 1.5 },
  sourceText: { color: colors.info, fontSize: 11, marginBottom: spacing.md },
  modulesWrap: { marginTop: spacing.sm, marginBottom: spacing.xs },
  modulesTitle: { color: colors.onSurfaceSecondary, fontSize: 9, letterSpacing: 1, marginBottom: spacing.sm },
  moduleRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  moduleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  moduleText: { color: colors.onSurfaceTertiary, fontSize: 11 },
  knownRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.md, marginBottom: spacing.xs },
  knownText: { color: colors.onSurfaceSecondary, fontSize: 12, flex: 1 },
  idGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: spacing.md,
  },
  saveBtnDone: { backgroundColor: colors.success },
  saveText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 1 },
  err: { color: colors.error, marginTop: spacing.sm, fontSize: 13 },
  recoverTitle: { color: colors.warning, fontWeight: "700", marginBottom: spacing.md },
  recoverRow: { flexDirection: "row", alignItems: "center", paddingVertical: spacing.sm },
  recoverLabel: { color: colors.onSurface, fontSize: 14 },
  recoverFix: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 1 },
  retryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: spacing.md,
  },
});
