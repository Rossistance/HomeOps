// Bloom — the greeting's arrival.
//
// "On first open of the app the 'Good evening, …' text should use an attention-grabbing
//  motion animation like bloom."
//
// A bloom opens: it starts small and slightly low, then expands past its size and settles
// back. Three things carried on one spring — scale, lift, and opacity — so it arrives as one
// gesture rather than as three effects that happen to overlap.
//
// FIRST OPEN, literally. This runs on a cold start, not on every return to the tab. A greeting
// that re-blooms each time you tap Today is a tic; the first time you see your own name after
// opening the app is a moment worth marking, and the fifth time in a minute isn't. The flag
// lives in module scope, so it resets when the app process does — which is the same lifetime
// as "opening the app".
import { useEffect, useRef, type ReactNode } from "react";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { useCalmMotion } from "@/theme";

let bloomedThisLaunch = false;

export function Bloom({ children, delay = 120, style }: { children: ReactNode; delay?: number; style?: object }) {
  const calm = useCalmMotion();
  // Decided once, on mount, before the effect can flip the flag — so a remount inside the same
  // launch reads `false` and starts at rest instead of replaying.
  const shouldBloom = useRef(!calm && !bloomedThisLaunch).current;
  const scale = useSharedValue(shouldBloom ? 0.9 : 1);
  const lift = useSharedValue(shouldBloom ? 14 : 0);
  const fade = useSharedValue(shouldBloom ? 0 : 1);

  useEffect(() => {
    if (!shouldBloom) return;
    bloomedThisLaunch = true;
    // Low damping on the scale is what makes it a bloom rather than a fade-up: it overshoots
    // to about 1.03 and comes back. The lift is damped harder so the text doesn't bob.
    scale.value = withDelay(delay, withSpring(1, { damping: 9, stiffness: 130, mass: 0.9, reduceMotion: ReduceMotion.System }));
    lift.value = withDelay(delay, withSpring(0, { damping: 16, stiffness: 150, reduceMotion: ReduceMotion.System }));
    fade.value = withDelay(delay, withTiming(1, { duration: 420, reduceMotion: ReduceMotion.System }));
  }, [shouldBloom, delay, scale, lift, fade]);

  const a = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateY: lift.value }, { scale: scale.value }],
  }));

  return (
    <Animated.View
      // Growing from the left edge, not the centre — the greeting is left-aligned text, and a
      // centre-origin scale would slide the first letter sideways as it settles.
      style={[{ transformOrigin: "left center" }, a, style]}
    >
      {children}
    </Animated.View>
  );
}
