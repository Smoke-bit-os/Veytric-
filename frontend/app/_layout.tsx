import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect, useRef } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Purchases from "react-native-purchases";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider, useAuth } from "@/src/auth";
import { initializeRevenueCat, SubscriptionProvider, rcEnabled } from "@/src/revenuecat";
import { LicenseProvider } from "@/src/licensing/LicenseProvider";
import TrialReminder from "@/src/licensing/TrialReminder";
import { PurchasesProvider } from "@/src/subscriptions/PurchasesProvider";
import { AIEngineProvider } from "@/src/ai/aiContext";
import { TelemetryProvider } from "@/src/telemetry";
import { RecordingProvider } from "@/src/vehicle/recording/recordingContext";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();
try {
  initializeRevenueCat(); // module scope, once per launch, before any component mounts
} catch (err) {
  console.warn("RevenueCat unavailable:", err);
}

// Bind RevenueCat identity to the app's stable backend user id on every auth path.
function RCIdentityBinder() {
  const { user } = useAuth();
  const bound = useRef<string | null>(null);
  useEffect(() => {
    if (!rcEnabled) return;
    (async () => {
      try {
        if (user?.id && bound.current !== user.id) {
          await Purchases.logIn(user.id);
          bound.current = user.id;
        } else if (!user?.id && bound.current) {
          await Purchases.logOut();
          bound.current = null;
        }
      } catch (e) {
        console.warn("[RevenueCat] identity bind failed:", String(e));
      }
    })();
  }, [user?.id]);
  return null;
}

export default function RootLayout() {
  const [iconsLoaded, iconsError] = useIconFonts();
  const [fontsLoaded, fontsError] = useFonts({
    "Rajdhani-Bold": "https://cdn.jsdelivr.net/fontsource/fonts/rajdhani@latest/latin-700-normal.ttf",
    "Rajdhani-SemiBold": "https://cdn.jsdelivr.net/fontsource/fonts/rajdhani@latest/latin-600-normal.ttf",
  });

  const ready = (iconsLoaded || iconsError) && (fontsLoaded || fontsError);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <QueryClientProvider client={queryClient}>
          <SubscriptionProvider>
          <RCIdentityBinder />
          <PurchasesProvider>
            <LicenseProvider>
              <AIEngineProvider>
                <TelemetryProvider>
                  <RecordingProvider>
                  <StatusBar style="light" />
                  <TrialReminder />
                  <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#06080D" } }}>
                    <Stack.Screen name="index" />
                    <Stack.Screen name="auth" />
                    <Stack.Screen name="(tabs)" />
                    <Stack.Screen name="connect" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
                    <Stack.Screen name="reports" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="ble-diagnostics" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="vehicle-profile" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="record" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
                    <Stack.Screen name="recordings" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="playback" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="compare" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="timeline" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="predictions" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="trends" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="repair-log" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="health-report" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="ecu-modules" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="system-monitor" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="codes" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="how-to-connect" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="guided-repair" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="advanced-scan" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="scan-report" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="upgrade" options={{ presentation: "modal", animation: "slide_from_bottom" }} />
                    <Stack.Screen name="about" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="developer" options={{ presentation: "card", animation: "slide_from_right" }} />
                    <Stack.Screen name="ai-settings" options={{ presentation: "card", animation: "slide_from_right" }} />
                  </Stack>
                </RecordingProvider>
                </TelemetryProvider>
              </AIEngineProvider>
            </LicenseProvider>
          </PurchasesProvider>
          </SubscriptionProvider>
          </QueryClientProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
