import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AIOrb from "@/src/components/AIOrb";
import { useAuth } from "@/src/auth";
import { colors, font, radius, spacing } from "@/src/theme";

export default function AuthScreen() {
  const router = useRouter();
  const { login, register, loginAsGuest } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!email || !password || (mode === "register" && !name)) {
      setError("Please fill in all fields");
      return;
    }
    setLoading(true);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await register(name.trim(), email.trim(), password);
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={[colors.surface, "#0A1020", colors.surface]} style={styles.flex}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.orbWrap}>
            <AIOrb size={130} active />
          </View>
          <Text style={styles.brand}>JARVIS AI</Text>
          <Text style={styles.tagline}>NEXT-GEN AUTOMOTIVE COMMAND CENTER</Text>

          <View style={styles.card}>
            <View style={styles.tabs}>
              {(["login", "register"] as const).map((m) => (
                <Pressable
                  key={m}
                  testID={`auth-tab-${m}`}
                  style={[styles.tab, mode === m && styles.tabActive]}
                  onPress={() => setMode(m)}
                >
                  <Text style={[styles.tabText, mode === m && styles.tabTextActive]}>
                    {m === "login" ? "Sign In" : "Register"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {mode === "register" && (
              <Input
                icon="account"
                placeholder="Full name"
                value={name}
                onChangeText={setName}
                testID="auth-name-input"
              />
            )}
            <Input
              icon="email"
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              testID="auth-email-input"
            />
            <Input
              icon="lock"
              placeholder="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              testID="auth-password-input"
            />

            {error ? (
              <Text style={styles.error} testID="auth-error">
                {error}
              </Text>
            ) : null}

            <Pressable
              testID="auth-submit-button"
              style={styles.button}
              onPress={submit}
              disabled={loading}
            >
              <LinearGradient
                colors={[colors.brand, colors.brandSecondary]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.buttonGrad}
              >
                {loading ? (
                  <ActivityIndicator color={colors.onBrandPrimary} />
                ) : (
                  <Text style={styles.buttonText}>
                    {mode === "login" ? "INITIALIZE SYSTEM" : "CREATE ACCOUNT"}
                  </Text>
                )}
              </LinearGradient>
            </Pressable>
          </View>

          <Pressable
            testID="auth-guest-button"
            style={styles.guestBtn}
            onPress={async () => {
              await loginAsGuest();
              router.replace("/(tabs)");
            }}
          >
            <MaterialCommunityIcons name="incognito" size={16} color={colors.onSurfaceSecondary} />
            <Text style={styles.guestText}>Continue as Guest</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

function Input(props: any) {
  const { icon, ...rest } = props;
  return (
    <View style={styles.inputWrap}>
      <MaterialCommunityIcons name={icon} size={18} color={colors.onSurfaceSecondary} />
      <TextInput
        placeholderTextColor={colors.onSurfaceSecondary}
        style={styles.input}
        autoCapitalize="none"
        {...rest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  orbWrap: { alignItems: "center", marginBottom: spacing.md },
  brand: {
    fontFamily: font.display,
    fontSize: 42,
    color: colors.onSurface,
    textAlign: "center",
    letterSpacing: 4,
  },
  tagline: {
    color: colors.brand,
    fontSize: 10,
    letterSpacing: 2,
    textAlign: "center",
    marginTop: 2,
    marginBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  tabs: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    padding: 4,
    marginBottom: spacing.lg,
  },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: radius.pill },
  tabActive: { backgroundColor: colors.surfaceTertiary },
  tabText: { color: colors.onSurfaceSecondary, fontWeight: "600" },
  tabTextActive: { color: colors.brand },
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  input: { flex: 1, color: colors.onSurface, paddingVertical: 14, marginLeft: 8, fontSize: 15 },
  error: { color: colors.error, marginBottom: spacing.sm, fontSize: 13 },
  button: { borderRadius: radius.md, overflow: "hidden", marginTop: spacing.xs },
  buttonGrad: { paddingVertical: 16, alignItems: "center" },
  buttonText: { color: colors.onBrandPrimary, fontWeight: "800", letterSpacing: 1.5, fontSize: 14 },
  guestBtn: { flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "center", marginTop: spacing.xl, padding: spacing.md },
  guestText: { color: colors.onSurfaceSecondary, fontSize: 14, fontWeight: "600" },
});
