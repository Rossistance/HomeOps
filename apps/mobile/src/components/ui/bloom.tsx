// Bloom — the greeting's arrival.
//
// "On first open of the app the 'Good evening, …' text should use an attention-grabbing
//  motion animation like bloom… the good morning should bloom and the user's name should use
//  the big effect."
//
// So it's two beats, not one. The greeting opens first — scale, lift and opacity on a single
// spring, so it arrives as one gesture rather than three effects that overlap. Then the NAME
// lands: later, larger, and springier, because that's the word you're actually being shown.
// Same motion, more of it, a quarter-second behind — a delay that small doesn't read as
// sequence, it reads as emphasis.
//
// WHY IT DIDN'T RUN THE FIRST TIME. The original kept a module-scope "only once per launch"
// flag. It was right about the intent and wrong about the mechanism: the root layout does a
// `router.replace("/(home)")` on mount to anchor the Today tab, and the screen also mounts
// behind the splash and the lock screen. Any one of those consumed the flag before a human
// could see anything, and the mount that was finally visible read `true` and started at rest.
// Reported exactly that way: "I did not see the bloom effect at all."
//
// The flag is gone. This just animates when it mounts. That lands in the same place for the
// behaviour we wanted — native tabs keep screens mounted, so switching to Ask and back does
// not replay it — and it can't be silently defeated by a remount nobody watched.
import { useEffect, type ReactNode } from "react";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { useCalmMotion } from "@/theme";

export function Bloom({
  children, delay = 120, big = false, style,
}: {
  children: ReactNode;
  delay?: number;
  /** The bigger version — more overshoot, more travel. For the one word that matters most. */
  big?: boolean;
  style?: object;
}) {
  const calm = useCalmMotion();
  const from = big ? 0.72 : 0.9;
  const scale = useSharedValue(calm ? 1 : from);
  const lift = useSharedValue(calm ? 0 : big ? 20 : 12);
  const fade = useSharedValue(calm ? 1 : 0);

  useEffect(() => {
    if (calm) return;
    // Low damping on the scale is what makes it a bloom rather than a fade-up: it overshoots
    // and comes back. `big` overshoots harder and settles slower. The lift is damped more in
    // both, so the text rises into place without bobbing.
    scale.value = withDelay(delay, withSpring(1, {
      damping: big ? 7.5 : 9, stiffness: big ? 110 : 130, mass: big ? 1 : 0.9, reduceMotion: ReduceMotion.System,
    }));
    lift.value = withDelay(delay, withSpring(0, { damping: 15, stiffness: 140, reduceMotion: ReduceMotion.System }));
    fade.value = withDelay(delay, withTiming(1, { duration: big ? 520 : 420, reduceMotion: ReduceMotion.System }));
  }, [calm, big, delay, scale, lift, fade]);

  const a = useAnimatedStyle(() => ({
    opacity: fade.value,
    transform: [{ translateY: lift.value }, { scale: scale.value }],
  }));

  return (
    // Growing from the left edge, not the centre — this is left-aligned text, and a
    // centre-origin scale would slide the first letter sideways as it settles.
    <Animated.View style={[{ transformOrigin: "left center" }, a, style]}>
      {children}
    </Animated.View>
  );
}
