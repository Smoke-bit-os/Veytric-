import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { LogBox } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";

import { useIconFonts } from "@/src/hooks/use-icon-fonts";
import { AuthProvider } from "@/src/auth";
import { TelemetryProvider } from "@/src/telemetry";
import { RecordingProvider } from "@/src/vehicle/recording/recordingContext";

LogBox.ignoreAllLogs(true);
SplashScreen.preventAutoHideAsync();

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
          <TelemetryProvider>
            <RecordingProvider>
              <StatusBar style="light" />
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
              </Stack>
            </RecordingProvider>
          </TelemetryProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
