import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useAI } from "@/src/ai/aiContext";
import { AIProviderType } from "@/src/ai/types";
import { colors, font, radius, spacing } from "@/src/theme";

const OPTIONS: { type: AIProviderType; title: string; sub: string; icon: string }[] = [
  { type: AIProviderType.JARVIS_CLOUD, title: "JARVIS Cloud AI", sub: "Powered by JARVIS servers · no setup", icon: "cloud" },
  { type: AIProviderType.OPENAI_USER_KEY, title: "OpenAI Personal Key", sub: "Use your own OpenAI API key (BYOK)", icon: "key-variant" },
  { type: AIProviderType.LOCAL_AI, title: "Local AI", sub: "Offline processing via Ollama", icon: "laptop" },
];

export default function AISettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const ai = useAI();
  const [keyInput, setKeyInput] = useState("");
  const [modelInput, setModelInput] = useState(ai.openaiModel);
  const [urlInput, setUrlInput] = useState(ai.localUrl);
  const [localModelInput, setLocalModelInput] = useState(ai.localModel);
  const [busy, setBusy] = useState<string | null>(null);

  const saveKey = async () => {
    setBusy("save");
    const res = await ai.saveOpenAIKey(keyInput);
    setBusy(null);
    if (res.ok) { setKeyInput(""); Alert.alert("Saved", "Your OpenAI key was validated and saved securely."); }
    else Alert.alert("Could not save", res.error || "Invalid key");
  };

  const testKey = async () => {
    if (keyInput.trim()) {
      // Validate + save the entered key (save runs a live test).
      return saveKey();
    }
    setBusy("test");
    const ok = await ai.testOpenAI();
    setBusy(null);
    Alert.alert(ok ? "Connected" : "Failed", ok ? "OpenAI connection successful." : "Could not connect. Check your saved key.");
  };

  const removeKey = async () => {
    await ai.removeOpenAIKey();
    Alert.alert("Removed", "Your OpenAI key was deleted.");
  };

  const saveModel = async () => { await ai.setOpenAIModel(modelInput); Alert.alert("Saved", `Model set to ${modelInput || "default"}.`); };

  const saveLocal = async () => {
    await ai.setLocalUrl(urlInput);
    await ai.setLocalModel(localModelInput);
    Alert.alert("Saved", "Local AI settings saved.");
  };

  const testLocal = async () => {
    setBusy("local");
    await ai.setLocalUrl(urlInput);
    const ok = await ai.testLocal();
    setBusy(null);
    Alert.alert(ok ? "Connected" : "Unreachable", ok ? "Local AI server reachable." : "Could not reach the local AI server. It must be running and reachable from this device.");
  };

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <Pressable testID="ai-back" onPress={() => router.back()} hitSlop={12}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.onSurface} />
        </Pressable>
        <Text style={styles.title}>ARTIFICIAL INTELLIGENCE</Text>
        <View style={{ width: 28 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"] }} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionTitle}>AI ENGINE</Text>
          <Text style={styles.help}>Choose how JARVIS powers its AI features. Your selection is saved and used across the app.</Text>

          {OPTIONS.map((o) => {
            const selected = ai.providerType === o.type;
            return (
              <Pressable key={o.type} testID={`ai-option-${o.type}`} style={[styles.option, selected && styles.optionActive]} onPress={() => ai.setProviderType(o.type)}>
                <View style={[styles.radio, selected && styles.radioActive]}>{selected && <View style={styles.radioDot} />}</View>
                <MaterialCommunityIcons name={o.icon as any} size={22} color={selected ? colors.brand : colors.onSurfaceSecondary} />
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.optTitle}>{o.title}</Text>
                  <Text style={styles.optSub}>{o.sub}</Text>
                </View>
                {o.type === AIProviderType.OPENAI_USER_KEY && ai.hasOpenAIKey && <View style={styles.dot} />}
              </Pressable>
            );
          })}

          {/* OpenAI BYOK */}
          {ai.providerType === AIProviderType.OPENAI_USER_KEY && (
            <View style={styles.panel} testID="openai-panel">
              <Text style={styles.panelTitle}>OpenAI API Key</Text>
              {ai.hasOpenAIKey ? (
                <View style={styles.savedRow}>
                  <MaterialCommunityIcons name="check-decagram" size={16} color={colors.success} />
                  <Text style={styles.savedKey} testID="openai-masked-key">{ai.maskedKey}</Text>
                </View>
              ) : (
                <Text style={styles.help}>No key saved. Enter your key below — it's stored encrypted on this device only.</Text>
              )}
              <TextInput
                testID="openai-key-input"
                style={styles.input}
                placeholder="sk-proj-..."
                placeholderTextColor={colors.onSurfaceSecondary}
                value={keyInput}
                onChangeText={setKeyInput}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <View style={styles.btnRow}>
                <Pressable testID="openai-test" style={[styles.btn, styles.btnGhost]} onPress={testKey} disabled={!!busy}>
                  {busy === "test" || busy === "save" ? <ActivityIndicator color={colors.brand} /> : <Text style={styles.btnGhostText}>Test Connection</Text>}
                </Pressable>
                <Pressable testID="openai-save" style={[styles.btn, styles.btnPrimary]} onPress={saveKey} disabled={!!busy || !keyInput.trim()}>
                  <Text style={styles.btnPrimaryText}>Save Key</Text>
                </Pressable>
              </View>
              {ai.hasOpenAIKey && (
                <Pressable testID="openai-remove" style={styles.removeBtn} onPress={removeKey}>
                  <MaterialCommunityIcons name="trash-can-outline" size={16} color={colors.error} />
                  <Text style={styles.removeText}>Remove Key</Text>
                </Pressable>
              )}
              <Text style={styles.panelTitle}>Model</Text>
              <TextInput testID="openai-model-input" style={styles.input} value={modelInput} onChangeText={setModelInput} autoCapitalize="none" placeholder="gpt-4o-mini" placeholderTextColor={colors.onSurfaceSecondary} onBlur={saveModel} />
              <Text style={styles.help}>You pay OpenAI directly for usage. Your key never leaves this device except to OpenAI.</Text>
            </View>
          )}

          {/* Local AI */}
          {ai.providerType === AIProviderType.LOCAL_AI && (
            <View style={styles.panel} testID="local-panel">
              <Text style={styles.panelTitle}>Ollama Server URL</Text>
              <TextInput testID="local-url-input" style={styles.input} value={urlInput} onChangeText={setUrlInput} autoCapitalize="none" autoCorrect={false} placeholder="http://localhost:11434" placeholderTextColor={colors.onSurfaceSecondary} />
              <Text style={styles.panelTitle}>Model</Text>
              <TextInput testID="local-model-input" style={styles.input} value={localModelInput} onChangeText={setLocalModelInput} autoCapitalize="none" placeholder="llama3.1" placeholderTextColor={colors.onSurfaceSecondary} />
              <View style={styles.btnRow}>
                <Pressable testID="local-test" style={[styles.btn, styles.btnGhost]} onPress={testLocal} disabled={!!busy}>
                  {busy === "local" ? <ActivityIndicator color={colors.brand} /> : <Text style={styles.btnGhostText}>Test Connection</Text>}
                </Pressable>
                <Pressable testID="local-save" style={[styles.btn, styles.btnPrimary]} onPress={saveLocal}>
                  <Text style={styles.btnPrimaryText}>Save</Text>
                </Pressable>
              </View>
              <Text style={styles.help}>Runs fully offline. Requires an Ollama server reachable from this device (won't work in Expo Go / web preview).</Text>
            </View>
          )}

          {/* Cloud info */}
          {ai.providerType === AIProviderType.JARVIS_CLOUD && (
            <View style={styles.panel} testID="cloud-panel">
              <Text style={styles.help}>JARVIS Cloud is ready to use with no setup. AI runs on JARVIS servers using the managed model.</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  title: { color: colors.onSurface, fontFamily: font.display, fontSize: 16, letterSpacing: 1 },
  sectionTitle: { color: colors.onSurfaceSecondary, fontSize: 11, letterSpacing: 2, fontWeight: "700", marginBottom: spacing.sm },
  help: { color: colors.onSurfaceSecondary, fontSize: 12, lineHeight: 18, marginBottom: spacing.md },
  option: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.sm },
  optionActive: { borderColor: colors.brand },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.borderStrong, alignItems: "center", justifyContent: "center", marginRight: spacing.md },
  radioActive: { borderColor: colors.brand },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  optTitle: { color: colors.onSurface, fontSize: 15, fontWeight: "700" },
  optSub: { color: colors.onSurfaceSecondary, fontSize: 12, marginTop: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  panel: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginTop: spacing.md },
  panelTitle: { color: colors.onSurface, fontSize: 13, fontWeight: "700", marginBottom: spacing.sm, marginTop: spacing.sm },
  savedRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.md },
  savedKey: { color: colors.onSurfaceTertiary, fontSize: 14, fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, color: colors.onSurface, paddingHorizontal: spacing.lg, paddingVertical: 13, fontSize: 15, marginBottom: spacing.md },
  btnRow: { flexDirection: "row", gap: spacing.sm },
  btn: { flex: 1, borderRadius: radius.sm, paddingVertical: 13, alignItems: "center" },
  btnGhost: { borderWidth: 1, borderColor: colors.brand },
  btnGhostText: { color: colors.brand, fontWeight: "700" },
  btnPrimary: { backgroundColor: colors.brand },
  btnPrimaryText: { color: colors.onBrandPrimary, fontWeight: "800" },
  removeBtn: { flexDirection: "row", gap: 6, alignItems: "center", justifyContent: "center", paddingVertical: spacing.md, marginTop: spacing.xs },
  removeText: { color: colors.error, fontWeight: "600" },
});
