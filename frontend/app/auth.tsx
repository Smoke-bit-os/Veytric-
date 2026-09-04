import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AIOrb from "@/src/components/AIOrb";
import { useAuth } from "@/src/auth";
import { colors, font, radius, spacing } from "@/src/theme";

export default function AuthScreen() {
  const router = useRouter();
  const { loginWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const signIn = async () => {
    setError("");
    setLoading(true);
    try {
      const ok = await loginWithGoogle();
      // Web redirects away and returns via the root gate; mobile returns here.
      if (ok) router.replace("/(tabs)");
    } catch {
      setError("Could not sign in with Google. Please try again.");
      if (Platform.OS !== "web") {
        Alert.alert("Sign-in failed", "Could not sign in with Google. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient colors={[colors.surface, "#0A1020", colors.surface]} style={styles.flex}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.orbWrap}>
          <AIOrb size={140} active />
        </View>
        <Text style={styles.brand}>VEYTRIC</Text>
        <Text style={styles.tagline}>AI VEHICLE INTELLIGENCE</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sign in to continue</Text>
          <Text style={styles.cardSub}>
            VEYTRIC uses Google to keep your garage, scans and reports private to you.
          </Text>

          {error ? (
            <Text style={styles.error} testID="auth-error">
              {error}
            </Text>
          ) : null}

          <Pressable
            testID="auth-google-button"
            style={styles.googleBtn}
            onPress={signIn}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.onSurface} />
            ) : (
              <>
                <MaterialCommunityIcons name="google" size={20} color={colors.onSurface} />
                <Text style={styles.googleText}>Continue with Google</Text>
              </>
            )}
          </Pressable>
        </View>

        <Text style={styles.legal}>
          By continuing you agree to VEYTRIC's Terms and acknowledge the Privacy Policy.
        </Text>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: "center", padding: spacing.xl },
  orbWrap: { alignItems: "center", marginBottom: spacing.md },
  brand: {
    fontFamily: font.display,
    fontSize: 46,
    color: colors.onSurface,
    textAlign: "center",
    letterSpacing: 4,
  },
  tagline: {
    color: colors.brand,
    fontSize: 11,
    letterSpacing: 3,
    textAlign: "center",
    marginTop: 4,
    marginBottom: spacing.xl,
  },
  card: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  cardTitle: {
    color: colors.onSurface,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  cardSub: {
    color: colors.onSurfaceSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  error: { color: colors.error, marginBottom: spacing.md, fontSize: 13, textAlign: "center" },
  googleBtn: {
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceTertiary,
  },
  googleText: { color: colors.onSurface, fontSize: 16, fontWeight: "700" },
  legal: {
    color: colors.onSurfaceSecondary,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: spacing.xl,
    paddingHorizontal: spacing.md,
  },
});
