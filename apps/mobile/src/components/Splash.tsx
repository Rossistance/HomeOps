// Animated FamiliOS splash (~2.4s): icon tile pops, the three huddle dots pop
// staggered, wordmark then tagline rise, whole splash fades out at 2.0s.
// Fixed ink-navy palette in both themes. Reduced motion skips straight through.
import { useEffect } from "react";
import { StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming,
} from "react-native-reanimated";
import { useCalmMotion } from "@/theme";
import { HuddleMark, SPLASH_BG, BRAND_EMBER, BRAND_PORCELAIN } from "@/components/brand";
import { fonts } from "@/theme";

const POP = Easing.bezier(0.22, 1, 0.36, 1);

function usePop(delayMs: number, skip: boolean) {
  const scale = useSharedValue(skip ? 1 : 0.4);
  const opacity = useSharedValue(skip ? 1 : 0);
  useEffect(() => {
    if (skip) return;
    scale.value = withDelay(delayMs, withSequence(
      withTiming(1.07, { duration: 360, easing: POP }),
      withTiming(1, { duration: 240, easing: POP }),
    ));
    opacity.value = withDelay(delayMs, withTiming(1, { duration: 300 }));
  }, [delayMs, skip, scale, opacity]);
  return useAnimatedStyle(() => ({ transform: [{ scale: scale.value }], opacity: opacity.value }));
}

function useRise(delayMs: number, skip: boolean) {
  const y = useSharedValue(skip ? 0 : 12);
  const opacity = useSharedValue(skip ? 1 : 0);
  useEffect(() => {
    if (skip) return;
    y.value = withDelay(delayMs, withTiming(0, { duration: 550, easing: POP }));
    opacity.value = withDelay(delayMs, withTiming(1, { duration: 550 }));
  }, [delayMs, skip, y, opacity]);
  return useAnimatedStyle(() => ({ transform: [{ translateY: y.value }], opacity: opacity.value }));
}

export function Splash({ onDone }: { onDone: () => void }) {
  const calm = useCalmMotion();
  const fade = useSharedValue(1);

  const tile = usePop(0, calm);
  const wordmark = useRise(550, calm);
  const tagline = useRise(780, calm);

  useEffect(() => {
    const fadeAt = calm ? 400 : 2000;
    const doneAt = calm ? 900 : 2600;
    const t1 = setTimeout(() => { fade.value = withTiming(0, { duration: 500 }); }, fadeAt);
    const t2 = setTimeout(onDone, doneAt);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [calm, fade, onDone]);

  const container = useAnimatedStyle(() => ({ opacity: fade.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, { zIndex: 100 }, container]} pointerEvents="none">
      <LinearGradient colors={SPLASH_BG} start={{ x: 0.1, y: 0 }} end={{ x: 0.7, y: 1 }} style={st.fill}>
        <View
          style={{
            position: "absolute", alignSelf: "center", bottom: -120,
            width: 260, height: 260, borderRadius: 260,
            backgroundColor: "rgba(224,102,44,0.22)",
            boxShadow: "0 0 80px 60px rgba(224,102,44,0.22)",
          }}
        />
        <Animated.View style={tile}>
          <HuddleMark size={96} />
        </Animated.View>
        <Animated.View style={wordmark}>
          <Text style={st.wordmark}>
            Famili<Text style={{ color: BRAND_EMBER }}>OS</Text>
          </Text>
        </Animated.View>
        <Animated.View style={tagline}>
          <Text style={st.tagline}>Your family's operating system.</Text>
        </Animated.View>
      </LinearGradient>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18 },
  wordmark: { fontFamily: fonts.display, fontSize: 34, letterSpacing: -0.4, color: BRAND_PORCELAIN },
  tagline: { fontSize: 14, color: "rgba(245,241,233,0.65)" },
});
