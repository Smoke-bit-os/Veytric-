import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  TextInput,
  ScrollView,
  Linking,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api";
import { isNativeScanSupported, recognizeText } from "@/src/vehicle/vin/ocrEngine";
import { extractVinCandidates, isValidVinFormat, VinCandidate } from "@/src/vehicle/vin/vinOcr";
import { vinService } from "@/src/vehicle/vin/vinService";
import { colors, font, radius, spacing } from "@/src/theme";

type Stage = "camera" | "processing" | "select" | "confirm" | "decoding" | "review" | "error";

export default function ScanVin() {
  const router = useRouter();
  const supported = isNativeScanSupported();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [stage, setStage] = useState<Stage>("camera");
  const [torch, setTorch] = useState(false);
  const [candidates, setCandidates] = useState<VinCandidate[]>([]);
  const [vin, setVin] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [decoded, setDecoded] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [existingVehicles, setExistingVehicles] = useState<any[]>([]);

  useEffect(() => {
    // Preload the user's garage so we can detect a duplicate VIN before saving.
    api.vehicles().then((v: any) => setExistingVehicles(Array.isArray(v) ? v : v?.vehicles || [])).catch(() => {});
  }, []);

  const goManual = () => router.replace("/(tabs)/garage?add=1");

  const capture = useCallback(async () => {
    try {
      setStage("processing");
      setErrMsg("");
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.85, skipProcessing: false });
      if (!photo?.uri) throw new Error("capture failed");
      const text = await recognizeText(photo.uri); // on-device, offline
      const found = extractVinCandidates(text);
      if (found.length === 0) {
        setErrMsg("We couldn't confidently read the VIN. Move closer, steady your hand, and make sure it's well lit.");
        setStage("error");
      } else if (found.length === 1) {
        setCandidates(found);
        setVin(found[0].vin);
        setStage("confirm");
      } else {
        setCandidates(found);
        setStage("select");
      }
    } catch (e: any) {
      setErrMsg(
        e?.message === "OCR_UNAVAILABLE"
          ? "On-device scanning isn't available in this build."
          : "Something went wrong while scanning. Please try again."
      );
      setStage("error");
    }
  }, []);

  const decode = useCallback(async () => {
    const clean = vin.trim().toUpperCase();
    if (!isValidVinFormat(clean)) {
      setErrMsg("That VIN doesn't look right. A VIN is 17 characters and never uses I, O or Q.");
      return;
    }
    // Duplicate check against the CURRENT user's garage.
    const dup = existingVehicles.find((v) => (v.vin || "").toUpperCase() === clean);
    if (dup) {
      setErrMsg("");
      setDecoded({ __duplicate: true, id: dup.id, name: dup.name });
      setStage("review");
      return;
    }
    setStage("decoding");
    setErrMsg("");
    try {
      const res = await vinService.decodeVin(clean);
      setDecoded(res);
      setStage("review");
    } catch {
      setDecoded({ decodeSource: "offline_unavailable" });
      setStage("review");
    }
  }, [vin, existingVehicles]);

  const save = useCallback(async () => {
    const clean = vin.trim().toUpperCase();
    setSaving(true);
    try {
      const res = await api.upsertVehicleByVin({
        vin: clean,
        spec: decoded && !decoded.__duplicate ? decoded : {},
      });
      router.replace(`/vehicle-profile?id=${res.id}`);
    } catch (e: any) {
      setErrMsg(e?.status === 401 ? "Sign in to save vehicles to your garage." : "Couldn't save this vehicle. Please try again.");
      setSaving(false);
    }
  }, [vin, decoded, router]);

  // ---------- Non-native environments: never fake a scan ----------
  if (!supported) {
    return (
      <SafeAreaView style={styles.root}>
        <Header title="SCAN VIN" onBack={() => router.back()} />
        <View style={styles.centerPad}>
          <MaterialCommunityIcons name="camera-off-outline" size={48} color={colors.onSurfaceSecondary} />
          <Text style={styles.h2}>Camera scanning needs the app</Text>
          <Text style={styles.body}>
            VIN scanning uses your phone's camera and runs entirely on your device. It only works in the installed
            JARVIS Auto AI app (Android/iOS build){Platform.OS === "web" ? ", not the web preview" : ""}.
          </Text>
          <PrimaryButton icon="pencil-outline" label="ADD VEHICLE MANUALLY" onPress={goManual} />
        </View>
      </SafeAreaView>
    );
  }

  // ---------- Permission gate ----------
  if (!permission) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.centerPad}><ActivityIndicator color={colors.brand} /></View>
      </SafeAreaView>
    );
  }
  if (!permission.granted) {
    const blocked = !permission.canAskAgain;
    return (
      <SafeAreaView style={styles.root}>
        <Header title="SCAN VIN" onBack={() => router.back()} />
        <View style={styles.centerPad}>
          <MaterialCommunityIcons name="camera-outline" size={48} color={colors.brand} />
          <Text style={styles.h2}>Allow camera access</Text>
          <Text style={styles.body}>
            JARVIS uses your camera to read your VIN so we can set up your vehicle automatically. Images are processed
            on your device and never uploaded.
          </Text>
          {blocked ? (
            <PrimaryButton icon="cog-outline" label="OPEN SETTINGS" onPress={() => Linking.openSettings()} />
          ) : (
            <PrimaryButton icon="camera" label="ALLOW CAMERA" onPress={requestPermission} />
          )}
          <Pressable style={styles.linkBtn} onPress={goManual}>
            <Text style={styles.link}>Add vehicle manually instead</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ---------- Camera live ----------
  if (stage === "camera" || stage === "processing") {
    return (
      <View style={styles.cameraRoot}>
        <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} enableTorch={torch} />
        <SafeAreaView style={styles.cameraOverlay}>
          <View style={styles.camTop}>
            <Pressable style={styles.camIcon} onPress={() => router.back()} hitSlop={12}>
              <MaterialCommunityIcons name="close" size={26} color="#fff" />
            </Pressable>
            <Text style={styles.camTitle}>SCAN YOUR VIN</Text>
            <Pressable style={styles.camIcon} onPress={() => setTorch((t) => !t)} hitSlop={12}>
              <MaterialCommunityIcons name={torch ? "flashlight" : "flashlight-off"} size={24} color="#fff" />
            </Pressable>
          </View>

          <View style={styles.frameWrap}>
            <View style={styles.frame} />
            <Text style={styles.frameHint}>Point at the 17-character VIN{"\n"}(windshield, door jamb, or dashboard)</Text>
          </View>

          <View style={styles.camBottom}>
            {stage === "processing" ? (
              <View style={styles.processing}>
                <ActivityIndicator color="#fff" />
                <Text style={styles.processingText}>Reading VIN…</Text>
              </View>
            ) : (
              <>
                <Pressable testID="capture-vin" style={styles.shutter} onPress={capture}>
                  <View style={styles.shutterInner} />
                </Pressable>
                <Pressable style={styles.manualLink} onPress={goManual}>
                  <MaterialCommunityIcons name="pencil-outline" size={16} color="#fff" />
                  <Text style={styles.manualLinkText}>Enter manually</Text>
                </Pressable>
              </>
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ---------- Result stages ----------
  return (
    <SafeAreaView style={styles.root}>
      <Header title="SCAN VIN" onBack={() => setStage("camera")} />
      <ScrollView contentContainerStyle={styles.resultPad}>
        {stage === "error" && (
          <View style={styles.card}>
            <MaterialCommunityIcons name="text-search" size={40} color={colors.warning} />
            <Text style={styles.h2}>Couldn't read the VIN</Text>
            <Text style={styles.body}>{errMsg}</Text>
            <PrimaryButton icon="camera-retake" label="TRY AGAIN" onPress={() => setStage("camera")} />
            <Pressable style={styles.linkBtn} onPress={goManual}>
              <Text style={styles.link}>Enter VIN manually</Text>
            </Pressable>
          </View>
        )}

        {stage === "select" && (
          <View style={styles.card}>
            <Text style={styles.h2}>Which VIN is correct?</Text>
            <Text style={styles.body}>We found a few possible VINs. Tap the right one.</Text>
            {candidates.map((c) => (
              <Pressable
                key={c.vin}
                style={styles.candidate}
                onPress={() => { setVin(c.vin); setStage("confirm"); }}
              >
                <Text style={styles.candidateVin}>{c.vin}</Text>
                <View style={styles.candidateTags}>
                  {c.checksumValid && <Text style={styles.tagOk}>checksum ✓</Text>}
                  {c.corrected && <Text style={styles.tagWarn}>auto-corrected</Text>}
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {stage === "confirm" && (
          <View style={styles.card}>
            <MaterialCommunityIcons name="barcode-scan" size={40} color={colors.brand} />
            <Text style={styles.h2}>VIN detected</Text>
            <Text style={styles.body}>Check each character and fix anything the camera got wrong.</Text>
            <TextInput
              testID="vin-confirm-input"
              style={styles.vinInput}
              value={vin}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={17}
              onChangeText={(t) => setVin(t.toUpperCase())}
            />
            <Text style={styles.counter}>{vin.trim().length}/17</Text>
            {errMsg ? <Text style={styles.errText}>{errMsg}</Text> : null}
            <PrimaryButton icon="check" label="USE THIS VIN" onPress={decode} />
            <Pressable style={styles.linkBtn} onPress={() => setStage("camera")}>
              <Text style={styles.link}>Retake scan</Text>
            </Pressable>
          </View>
        )}

        {stage === "decoding" && (
          <View style={styles.card}>
            <ActivityIndicator color={colors.brand} />
            <Text style={styles.body}>Looking up vehicle details…</Text>
          </View>
        )}

        {stage === "review" && decoded && (
          decoded.__duplicate ? (
            <View style={styles.card}>
              <MaterialCommunityIcons name="car-info" size={40} color={colors.brand} />
              <Text style={styles.h2}>Already in your garage</Text>
              <Text style={styles.body}>{decoded.name || "This vehicle"} is already saved.</Text>
              <PrimaryButton icon="arrow-right" label="OPEN VEHICLE" onPress={() => router.replace(`/vehicle-profile?id=${decoded.id}`)} />
              <Pressable style={styles.linkBtn} onPress={() => setStage("camera")}>
                <Text style={styles.link}>Scan a different VIN</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.card}>
              <View style={styles.verifiedRow}>
                <MaterialCommunityIcons name="shield-check" size={20} color={colors.success} />
                <Text style={styles.verified}>VIN VERIFIED</Text>
              </View>
              <Text style={styles.h2}>{[decoded.year, decoded.make, decoded.model].filter(Boolean).join(" ") || "Vehicle"}</Text>
              {decoded.decodeSource === "offline_unavailable" ? (
                <Text style={styles.offlineNote}>You're offline — connect to the internet to load full vehicle details. Your VIN is saved.</Text>
              ) : null}
              <View style={styles.specTable}>
                {[
                  ["VIN", vin],
                  ["Year", decoded.year],
                  ["Make", decoded.make],
                  ["Model", decoded.model],
                  ["Trim", decoded.trim],
                  ["Engine", decoded.engine],
                  ["Drive type", decoded.driveType],
                  ["Transmission", decoded.transmission],
                  ["Plant", decoded.plant],
                  ["Country", decoded.country],
                ].map(([label, val]) => (
                  <View key={String(label)} style={styles.specRow}>
                    <Text style={styles.specLabel}>{label}</Text>
                    <Text style={[styles.specVal, !val && styles.specUnavail]}>{val ? String(val) : "Unavailable"}</Text>
                  </View>
                ))}
              </View>
              {errMsg ? <Text style={styles.errText}>{errMsg}</Text> : null}
              <PrimaryButton icon="plus" label={saving ? "" : "ADD VEHICLE"} loading={saving} onPress={save} />
              <Pressable style={styles.linkBtn} onPress={() => setStage("camera")}>
                <Text style={styles.link}>Scan again</Text>
              </Pressable>
            </View>
          )
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Header({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} hitSlop={12} style={styles.backBtn}>
        <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
      </Pressable>
      <Text style={styles.headerTitle}>{title}</Text>
      <View style={{ width: 28 }} />
    </View>
  );
}

function PrimaryButton({ icon, label, onPress, loading }: { icon: any; label: string; onPress: () => void; loading?: boolean }) {
  return (
    <Pressable style={styles.primaryBtn} onPress={onPress} disabled={loading} testID={`btn-${label}`}>
      <LinearGradient colors={[colors.brand, colors.brandSecondary]} style={styles.primaryGrad}>
        {loading ? (
          <ActivityIndicator color={colors.onBrandPrimary} />
        ) : (
          <>
            <MaterialCommunityIcons name={icon} size={18} color={colors.onBrandPrimary} />
            <Text style={styles.primaryText}>{label}</Text>
          </>
        )}
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  backBtn: { padding: 4 },
  headerTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 16, letterSpacing: 2 },
  centerPad: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  resultPad: { padding: spacing.lg, gap: spacing.md },
  h2: { color: colors.onSurface, fontFamily: font.display, fontSize: 20, letterSpacing: 0.5, textAlign: "center", marginTop: spacing.sm },
  body: { color: colors.onSurfaceSecondary, fontSize: 14, lineHeight: 21, textAlign: "center" },
  link: { color: colors.brand, fontSize: 14, fontWeight: "600" },
  linkBtn: { paddingVertical: spacing.sm },

  primaryBtn: { width: "100%", borderRadius: radius.md, overflow: "hidden", marginTop: spacing.sm },
  primaryGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 15, minHeight: 50 },
  primaryText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 1.2, fontSize: 14 },

  cameraRoot: { flex: 1, backgroundColor: "#000" },
  cameraOverlay: { flex: 1, justifyContent: "space-between" },
  camTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  camIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: "rgba(0,0,0,0.4)" },
  camTitle: { color: "#fff", fontFamily: font.display, fontSize: 16, letterSpacing: 2 },
  frameWrap: { alignItems: "center", gap: spacing.md },
  frame: { width: "82%", height: 96, borderWidth: 2, borderColor: colors.brand, borderRadius: radius.md, backgroundColor: "rgba(255,255,255,0.04)" },
  frameHint: { color: "rgba(255,255,255,0.85)", textAlign: "center", fontSize: 13, lineHeight: 19 },
  camBottom: { alignItems: "center", paddingBottom: spacing.xl, gap: spacing.md },
  shutter: { width: 74, height: 74, borderRadius: 37, borderWidth: 4, borderColor: "#fff", alignItems: "center", justifyContent: "center" },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: "#fff" },
  manualLink: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6 },
  manualLinkText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  processing: { alignItems: "center", gap: spacing.sm, paddingVertical: spacing.lg },
  processingText: { color: "#fff", fontSize: 15 },

  card: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, alignItems: "center", gap: spacing.sm },
  candidate: { width: "100%", borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, backgroundColor: colors.surface, marginTop: spacing.sm },
  candidateVin: { color: colors.onSurface, fontSize: 16, letterSpacing: 1, fontWeight: "700" },
  candidateTags: { flexDirection: "row", gap: 8, marginTop: 6 },
  tagOk: { color: colors.success, fontSize: 11, fontWeight: "700" },
  tagWarn: { color: colors.warning, fontSize: 11, fontWeight: "700" },
  vinInput: { width: "100%", borderWidth: 1, borderColor: colors.brand, borderRadius: radius.md, backgroundColor: colors.surfaceSecondary, color: colors.onSurface, fontSize: 20, letterSpacing: 2, textAlign: "center", paddingVertical: 14, marginTop: spacing.sm },
  counter: { color: colors.onSurfaceSecondary, fontSize: 12 },
  errText: { color: colors.error, fontSize: 13, textAlign: "center" },
  verifiedRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  verified: { color: colors.success, fontWeight: "800", letterSpacing: 1.5, fontSize: 12 },
  offlineNote: { color: colors.warning, fontSize: 13, textAlign: "center" },
  specTable: { width: "100%", marginTop: spacing.sm },
  specRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.divider },
  specLabel: { color: colors.onSurfaceSecondary, fontSize: 13 },
  specVal: { color: colors.onSurface, fontSize: 13, fontWeight: "600", maxWidth: "60%", textAlign: "right" },
  specUnavail: { color: colors.onSurfaceSecondary, fontStyle: "italic", fontWeight: "400" },
});
