import React, { useEffect } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { colors } from "@/src/theme";

type Props = { size?: number; active?: boolean };

export default function AIOrb({ size = 160, active = false }: Props) {
  const pulse = useSharedValue(0);
  const ring = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: active ? 900 : 2200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    ring.value = withRepeat(withTiming(1, { duration: active ? 1400 : 3000, easing: Easing.linear }), -1, false);
  }, [active]);

  const coreStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pulse.value, [0, 1], [0.92, active ? 1.08 : 1.02]) }],
    opacity: interpolate(pulse.value, [0, 1], [0.85, 1]),
  }));

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(ring.value, [0, 1], [1, 1.5]) }],
    opacity: interpolate(ring.value, [0, 1], [0.5, 0]),
  }));

  return (
    <View style={[styles.wrap, { width: size, height: size }]} testID="ai-orb">
      <Animated.View
        style={[
          styles.ring,
          { width: size, height: size, borderRadius: size / 2, borderColor: colors.brand },
          ringStyle,
        ]}
      />
      <Animated.View style={[{ width: size * 0.7, height: size * 0.7 }, coreStyle]}>
        <LinearGradient
          colors={[colors.brand, colors.brandSecondary, colors.brandTertiary]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={[styles.core, { borderRadius: (size * 0.7) / 2 }]}
        >
          <LinearGradient
            colors={["rgba(255,255,255,0.6)", "rgba(0,229,255,0)"]}
            style={[styles.inner, { borderRadius: (size * 0.5) / 2 }]}
          />
        </LinearGradient>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", justifyContent: "center" },
  ring: { position: "absolute", borderWidth: 1.5 },
  core: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: colors.brand,
    shadowOpacity: 0.9,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 20,
  },
  inner: { width: "72%", height: "72%", marginTop: "-6%", marginLeft: "-6%" },
});
