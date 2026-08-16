import React from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { colors, font, radius, spacing } from "@/src/theme";

const STEPS: { icon: string; title: string; body: string }[] = [
  { icon: "car-info", title: "1. Find your OBD-II port", body: "Almost every car built since 1996 has one. It's a trapezoid-shaped socket usually under the dashboard on the driver's side, near your knees or behind a small cover." },
  { icon: "bluetooth", title: "2. Get a Bluetooth OBD-II adapter", body: "You need an ELM327-based Bluetooth adapter (e.g. Innova, Veepeak, Vgate). Plug it firmly into the OBD-II port." },
  { icon: "key-variant", title: "3. Turn the ignition on", body: "Turn the key to the 'ON' position (dash lights up) or start the engine. The adapter needs power from the car to talk to the computer." },
  { icon: "bluetooth-settings", title: "4. Enable Bluetooth", body: "Turn on Bluetooth on your phone. You do NOT need to pair the adapter in phone settings — JARVIS connects to it directly." },
  { icon: "shield-check", title: "5. Allow JARVIS permissions", body: "When prompted, allow JARVIS to use Bluetooth / Nearby devices (and Location on older Android). This is required to find the adapter." },
  { icon: "access-point", title: "6. Open the Connection Center & scan", body: "In JARVIS, open the Connection Center and tap scan. Your adapter appears in the list — select it and connect." },
  { icon: "engine", title: "7. Wait for ECU communication", body: "JARVIS runs the ELM327 handshake and detects your vehicle's protocol. When you see 'LIVE BLE — REAL VEHICLE DATA', you're connected." },
  { icon: "speedometer", title: "8. Start live diagnostics", body: "You'll now see real RPM, speed, temperatures and trouble codes straight from your car's computer." },
];

const TROUBLE: { q: string; a: string }[] = [
  { q: "Adapter not found", a: "Make sure the adapter is fully plugged in and the ignition is ON. Toggle phone Bluetooth off/on and scan again." },
  { q: "Bluetooth permission denied", a: "Open your phone Settings → Apps → JARVIS Auto AI → Permissions and enable Bluetooth/Nearby devices (and Location on older Android), then retry." },
  { q: "Connection failed", a: "Unplug the adapter, wait 10 seconds, plug it back in, restart the engine and try again. Cheap clone adapters can be unreliable." },
  { q: "Vehicle not responding / No supported PIDs", a: "Some vehicles expose fewer sensors. JARVIS only shows what your ECU actually reports — unsupported values are marked unavailable, never faked." },
  { q: "Connection drops", a: "Keep the phone near the adapter and avoid other apps grabbing the Bluetooth radio. JARVIS auto-reconnects when the link returns." },
  { q: "\"No vehicle data\"", a: "This means there's no live connection. JARVIS will NOT invent readings — connect a real adapter to a running vehicle to see live data." },
];

export default function HowToConnect() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="howto-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>HOW TO CONNECT</Text>
        <View style={{ width: 28 }} />
      </View>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }}>
        <Text style={styles.h1}>How to Connect JARVIS to Your Vehicle</Text>
        <Text style={styles.intro}>
          JARVIS Auto AI reads live data and trouble codes directly from your car's computer using a small Bluetooth
          adapter. It's easy — no mechanical experience needed. Follow these steps.
        </Text>

        {STEPS.map((s) => (
          <View key={s.title} style={styles.step} testID={`howto-step-${s.title[0]}`}>
            <View style={styles.stepIcon}>
              <MaterialCommunityIcons name={s.icon as any} size={22} color={colors.brand} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.stepTitle}>{s.title}</Text>
              <Text style={styles.stepBody}>{s.body}</Text>
            </View>
          </View>
        ))}

        <Text style={styles.section}>TROUBLESHOOTING</Text>
        {TROUBLE.map((t) => (
          <View key={t.q} style={styles.tCard}>
            <Text style={styles.tQ}>{t.q}</Text>
            <Text style={styles.tA}>{t.a}</Text>
          </View>
        ))}

        <View style={styles.note}>
          <MaterialCommunityIcons name="information" size={16} color={colors.brand} />
          <Text style={styles.noteText}>
            JARVIS cannot generate real vehicle data without an actual vehicle connection. On the installed app, no
            adapter means no live readings — it will never show made-up numbers.
          </Text>
        </View>

        <Pressable testID="howto-open-connect" style={styles.cta} onPress={() => router.push("/connect")}>
          <Text style={styles.ctaText}>OPEN CONNECTION CENTER</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 17, letterSpacing: 1.2 },
  h1: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, marginBottom: spacing.sm },
  intro: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21, marginBottom: spacing.lg },
  step: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.lg },
  stepIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  stepTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  stepBody: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 20, marginTop: 3 },
  section: { color: colors.onSurfaceSecondary, fontSize: 12, letterSpacing: 2, fontWeight: "700", marginTop: spacing.md, marginBottom: spacing.md },
  tCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.sm },
  tQ: { color: colors.onSurface, fontSize: 14, fontWeight: "700" },
  tA: { color: colors.onSurfaceSecondary, fontSize: 13, lineHeight: 19, marginTop: 4 },
  note: { flexDirection: "row", gap: spacing.sm, backgroundColor: colors.brandTertiary, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.md },
  noteText: { flex: 1, color: colors.onSurface, fontSize: 12, lineHeight: 18 },
  cta: { marginTop: spacing.lg, backgroundColor: colors.brand, borderRadius: radius.md, paddingVertical: 14, alignItems: "center" },
  ctaText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 1 },
});
