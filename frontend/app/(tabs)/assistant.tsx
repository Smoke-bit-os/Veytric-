import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  useAudioRecorder,
  RecordingPresets,
  AudioModule,
  createAudioPlayer,
  setAudioModeAsync,
} from "expo-audio";
import AIOrb from "@/src/components/AIOrb";
import AIUsageBar from "@/src/components/AIUsageBar";
import { api } from "@/src/api";
import { useAI } from "@/src/ai/aiContext";
import { AIProviderType } from "@/src/ai/types";
import { useTelemetry } from "@/src/telemetry";
import { buildVehicleIntelligence } from "@/src/vehicle/enrichment/enrichmentService";
import { colors, font, radius, spacing } from "@/src/theme";

type Msg = { role: "user" | "assistant"; content: string };

const SESSION = "main";
const SUGGESTIONS = [
  "Why is my engine idling rough?",
  "Analyze my charging system",
  "What do these trouble codes mean?",
  "Is my coolant temp normal?",
];

export default function Assistant() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ voice?: string }>();
  const router = useRouter();
  const ai = useAI();
  const { data, identity } = useTelemetry();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  useEffect(() => {
    api.chatHistory(SESSION).then((h) => setMessages(h)).catch(() => {});
  }, []);

  useEffect(() => {
    if (params.voice === "1") toggleRecord();
  }, [params.voice]);

  const scrollToEnd = () => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || thinking) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setThinking(true);
    scrollToEnd();
    try {
      const snapshot = {
        rpm: Math.round(data.rpm),
        coolantTemp: Math.round(data.coolantTemp),
        oilTemp: Math.round(data.oilTemp),
        batteryVoltage: data.batteryVoltage.toFixed(1),
        chargingVoltage: data.chargingVoltage.toFixed(1),
        shortFuelTrim: data.shortFuelTrim.toFixed(1),
        longFuelTrim: data.longFuelTrim.toFixed(1),
        boost: Math.round(data.boost),
        dtcs: data.dtcs.map((d) => `${d.code} ${d.desc}`),
      };
      const platformSummary = buildVehicleIntelligence(identity as any)?.platformSummary;

      let reply = "";
      if (ai.providerType === AIProviderType.JARVIS_CLOUD) {
        // Cloud keeps server-side session history + persistence.
        const res = await api.chat({
          session_id: SESSION,
          message: msg,
          telemetry: snapshot,
          vehicle: platformSummary,
        });
        reply = res.reply;
        ai.refreshUsage();
      } else {
        // BYOK / Local: stateless analyze with compact local context.
        const id = identity as any;
        const res = await ai.analyze(
          msg,
          {
            profile: id ? { vin: id.vin, year: id.year, make: id.make, model: id.model, trim: id.trim, engine: id.engine } : undefined,
            live: { rpm: snapshot.rpm, coolantTemp: snapshot.coolantTemp, oilTemp: snapshot.oilTemp, batteryVoltage: snapshot.batteryVoltage, chargingVoltage: snapshot.chargingVoltage, shortFuelTrim: snapshot.shortFuelTrim, longFuelTrim: snapshot.longFuelTrim, boost: snapshot.boost },
            diagnostics: { dtcs: snapshot.dtcs },
          },
          { history: messages.slice(-8) },
        );
        if (!res.ok) throw new Error(res.error || "AI unavailable");
        reply = res.text;
      }
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      speak(reply);
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: "⚠️ " + (e.message || "AI unavailable") }]);
    } finally {
      setThinking(false);
      scrollToEnd();
    }
  };

  const speak = async (text: string) => {
    try {
      const res = await api.speak(text.slice(0, 500), "onyx");
      await setAudioModeAsync({ playsInSilentMode: true });
      const player = createAudioPlayer({ uri: `data:${res.mime};base64,${res.audio}` });
      player.play();
    } catch {}
  };

  const toggleRecord = async () => {
    if (recording) {
      setRecording(false);
      try {
        await recorder.stop();
        const uri = recorder.uri;
        if (uri) {
          setTranscribing(true);
          const res = await api.transcribe(uri);
          setTranscribing(false);
          if (res.text) await send(res.text);
        }
      } catch {
        setTranscribing(false);
      }
      return;
    }
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) return;
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch {}
  };

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={0}
      >
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <AIOrb size={40} active={thinking || recording} />
          <View style={{ marginLeft: spacing.md }}>
            <Text style={styles.title}>JARVIS</Text>
            <Text style={styles.subtitle}>
              {recording ? "Listening…" : thinking ? "Analyzing telemetry…" : transcribing ? "Transcribing…" : ai.providerName}
            </Text>
          </View>
          <View style={{ flex: 1 }} />
          <Pressable testID="ai-engine-button" onPress={() => router.push("/ai-settings")} hitSlop={12} style={styles.engineBtn}>
            <MaterialCommunityIcons name="tune-variant" size={20} color={colors.brand} />
          </Pressable>
        </View>

        <AIUsageBar />

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.messages}
          showsVerticalScrollIndicator={false}
        >
          {messages.length === 0 && (
            <View style={styles.welcome} testID="assistant-welcome">
              <AIOrb size={90} active />
              <Text style={styles.welcomeTitle}>How can I help, mechanic?</Text>
              <Text style={styles.welcomeText}>
                Ask about symptoms, trouble codes, or request a system analysis. I read your live sensors.
              </Text>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((s) => (
                  <Pressable key={s} testID={`suggestion-${s.slice(0, 10)}`} style={styles.suggestion} onPress={() => send(s)}>
                    <MaterialCommunityIcons name="lightning-bolt" size={14} color={colors.brand} />
                    <Text style={styles.suggestionText}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {messages.map((m, i) => (
            <View
              key={i}
              testID={`message-${m.role}-${i}`}
              style={[styles.bubble, m.role === "user" ? styles.userBubble : styles.aiBubble]}
            >
              {m.role === "assistant" && <Text style={styles.aiTag}>JARVIS</Text>}
              <Text style={m.role === "user" ? styles.userText : styles.aiText}>{m.content}</Text>
            </View>
          ))}

          {thinking && (
            <View style={[styles.bubble, styles.aiBubble]} testID="thinking-indicator">
              <ActivityIndicator color={colors.brand} />
            </View>
          )}
        </ScrollView>

        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 76 }]}>
          <Pressable
            testID="mic-button"
            onPress={toggleRecord}
            style={[styles.micBtn, recording && styles.micActive]}
          >
            <MaterialCommunityIcons
              name={recording ? "stop" : "microphone"}
              size={22}
              color={recording ? colors.onBrandPrimary : colors.brand}
            />
          </Pressable>
          <TextInput
            testID="chat-input"
            style={styles.textInput}
            placeholder="Ask JARVIS…"
            placeholderTextColor={colors.onSurfaceSecondary}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => send(input)}
            returnKeyType="send"
          />
          <Pressable testID="send-button" style={styles.sendBtn} onPress={() => send(input)}>
            <MaterialCommunityIcons name="send" size={20} color={colors.onBrandPrimary} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  flex: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 22, letterSpacing: 2 },
  subtitle: { color: colors.brand, fontSize: 12 },
  engineBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  messages: { padding: spacing.lg, paddingBottom: spacing.xl },
  welcome: { alignItems: "center", paddingVertical: spacing.xl },
  welcomeTitle: { color: colors.onSurface, fontFamily: font.display, fontSize: 24, marginTop: spacing.lg },
  welcomeText: {
    color: colors.onSurfaceSecondary,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
    lineHeight: 20,
  },
  suggestions: { width: "100%", gap: spacing.sm },
  suggestion: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surfaceSecondary,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  suggestionText: { color: colors.onSurfaceTertiary, fontSize: 14 },
  bubble: { maxWidth: "88%", borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.md },
  userBubble: { alignSelf: "flex-end", backgroundColor: colors.brandTertiary, borderWidth: 1, borderColor: colors.brandSecondary },
  aiBubble: { alignSelf: "flex-start", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border },
  aiTag: { color: colors.brand, fontSize: 10, letterSpacing: 1.5, fontWeight: "700", marginBottom: 4 },
  userText: { color: colors.onSurface, fontSize: 15, lineHeight: 21 },
  aiText: { color: colors.onSurfaceTertiary, fontSize: 15, lineHeight: 22 },
  inputBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: colors.surfaceSecondary,
  },
  micBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  micActive: { backgroundColor: colors.error, borderColor: colors.error },
  textInput: {
    flex: 1,
    color: colors.onSurface,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: 12,
    fontSize: 15,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
});
