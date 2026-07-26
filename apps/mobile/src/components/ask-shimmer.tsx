// The Ask Famili card's living surface.
//
// Asked for: "animate the Ask Famili background colours with something that gives it the
// feeling of shimmering, or like a flag waving in the wind, that calls attention to it from
// top left down to bottom right — like a gradient transition but from the blue down to
// orange, like rippling in a pond but more subtle. Is it possible to have it triggered on
// first load and then settle, but triggered again based on accelerometer movement, and match?"
//
// Three things had to be true at once, and they pull against each other:
//
//   IT CALLS ATTENTION. A sheen sweeps the diagonal, top-left to bottom-right, in the app's
//   own two colours — the ink-blue it already is, warming into ember as it crosses.
//
//   IT SETTLES. Attention you can't turn off is just noise, and this card sits on the first
//   screen after login. So the arrival sweeps twice and then stops. What's left is still, and
//   the card goes back to being a card.
//
//   IT ANSWERS THE PHONE. Tilt it and the sheen moves with the tilt — not a canned replay,
//   the ACTUAL angle. That's the difference between an animation that happens near you and a
//   surface that appears to be lit by something in the room. Below a real threshold it does
//   nothing at all, or a phone resting on a table would twitch forever.
//
// Two bands, not one, at different speeds and softness: a single sweep reads as a scanner
// going past, two overlapping ones read as light moving over cloth. That's the whole of the
// "flag in the wind" note.
//
// Reduced motion removes all of it — no arrival sweep, no sensor subscription at all. Someone
// who has asked their phone to stop moving things should not have the accelerometer read on
// their behalf either.
import { useEffect } from "react";
import { View, useWindowDimensions } from "react-native";
import { Accelerometer } from "expo-sensors";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  Easing, ReduceMotion, cancelAnimation, useAnimatedStyle, useSharedValue,
  withDelay, withRepeat, withSequence, withSpring, withTiming,
} from "react-native-reanimated";
import { useTheme, useCalmMotion } from "@/theme";
import { fade } from "@/lib/member-colors";

const AnimatedGradient = Animated.createAnimatedComponent(LinearGradient);

/** How hard you have to move the phone before the sheen answers. Tuned above the noise floor
 *  of a hand holding a phone still — a resting device must read as resting. */
const TILT_THRESHOLD = 0.22;

export function AskShimmer({ height }: { height: number }) {
  const { colors } = useTheme();
  const calm = useCalmMotion();
  const { width } = useWindowDimensions();
  // The band travels a diagonal, so it has to cover the card's diagonal plus its own width.
  const travel = width + height;

  // 0 → 1 walks one band across the card. Two bands share it with a phase offset.
  const sweep = useSharedValue(0);
  const sweep2 = useSharedValue(0);
  // Brightness. The arrival is bright; what's left afterwards is a whisper. Tilt pushes this
  // back up briefly, which is what makes the motion read as caused by YOU.
  const glow = useSharedValue(0);

  useEffect(() => {
    if (calm) return;
    /* The arrival: two passes, then it stops. `withRepeat(…, 2)` rather than -1 — this is a
     * greeting, not a loading state, and a card that shimmers forever is a card you learn to
     * ignore. */
    /* Reported: "too fast — more of a ripple across." Roughly two and a half times slower,
     * and the easing changed with it. `inOut` accelerated into the middle of the card and
     * braked at the far edge, which is what made it read as a sweep going somewhere; a ripple
     * doesn't do that. Linear on the leading band and a gentle `out` on the trailing one
     * means the two drift apart as they cross, the way one ring outruns the next on water. */
    sweep.value = 0;
    sweep.value = withRepeat(withTiming(1, { duration: 6800, easing: Easing.linear, reduceMotion: ReduceMotion.System }), 2, false);
    sweep2.value = 0;
    sweep2.value = withDelay(1600, withRepeat(withTiming(1, { duration: 8600, easing: Easing.out(Easing.sin), reduceMotion: ReduceMotion.System }), 2, false));
    glow.value = withSequence(
      withTiming(1, { duration: 1400, reduceMotion: ReduceMotion.System }),
      withDelay(11000, withTiming(0.16, { duration: 2600, reduceMotion: ReduceMotion.System })),
    );
    return () => { cancelAnimation(sweep); cancelAnimation(sweep2); cancelAnimation(glow); };
  }, [calm, sweep, sweep2, glow]);

  useEffect(() => {
    if (calm) return;
    let live = true;
    // Where the phone was last time we looked. The sheen answers CHANGE, not orientation —
    // holding a phone at an angle shouldn't pin the highlight to one side forever.
    let last = { x: 0, y: 0 };
    let primed = false;
    Accelerometer.setUpdateInterval(120);
    const sub = Accelerometer.addListener(({ x, y }) => {
      if (!live) return;
      if (!primed) { last = { x, y }; primed = true; return; }
      const dx = x - last.x;
      const dy = y - last.y;
      last = { x, y };
      const force = Math.hypot(dx, dy);
      if (force < TILT_THRESHOLD) return;
      /* Matched to the movement, which was the actual ask. The distance travelled and the
       * brightness both scale with how hard you moved it, and a tilt one way runs the sheen
       * that way — the card behaves like a surface catching light, rather than replaying a
       * clip whenever it's jostled. */
      const strength = Math.min(1, force / 1.1);
      const forward = dx + dy >= 0;
      // Slower here too, to match: heavier damping and a softer spring, so a tilt sends a
      // swell across the card rather than snapping the highlight to the other side.
      sweep.value = withSpring(forward ? 1 : 0, {
        damping: 22, stiffness: 12 + strength * 20, mass: 1.4, reduceMotion: ReduceMotion.System,
      });
      sweep2.value = withSpring(forward ? 0.85 : 0.15, {
        damping: 26, stiffness: 9 + strength * 14, mass: 1.6, reduceMotion: ReduceMotion.System,
      });
      glow.value = withSequence(
        withTiming(0.3 + strength * 0.55, { duration: 420, reduceMotion: ReduceMotion.System }),
        withTiming(0.16, { duration: 2200, reduceMotion: ReduceMotion.System }),
      );
    });
    return () => { live = false; sub.remove(); };
  }, [calm, sweep, sweep2, glow]);

  // Diagonal travel: the band moves right AND down together, which is the "top left down to
  // bottom right" of the note. Rotated 35°, so it crosses as a slanted bar rather than a wall.
  const bandA = useAnimatedStyle(() => ({
    opacity: glow.value * 0.9,
    transform: [
      { translateX: -travel * 0.6 + sweep.value * travel * 1.2 },
      { translateY: -height * 0.5 + sweep.value * height },
      { rotate: "35deg" },
    ],
  }));
  const bandB = useAnimatedStyle(() => ({
    opacity: glow.value * 0.55,
    transform: [
      { translateX: -travel * 0.75 + sweep2.value * travel * 1.3 },
      { translateY: -height * 0.7 + sweep2.value * height * 1.4 },
      { rotate: "48deg" }, // a different angle from A: two bands at one angle look like one band
    ],
  }));

  if (calm) return null;
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, overflow: "hidden" }} accessible={false}>
      {/* Blue at the leading edge warming to ember behind it — the card's own two colours,
          not a white gloss. A white sheen would read as glass; this reads as Famili. */}
      <AnimatedGradient
        colors={[fade(colors.sky, 0), fade(colors.sky, 0.35), fade(colors.ember, 0.30), fade(colors.ember, 0)]}
        locations={[0, 0.42, 0.58, 1]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={[{ position: "absolute", width: travel * 0.85, height: height * 2.4, top: 0, left: 0 }, bandA]}
      />
      <AnimatedGradient
        colors={[fade(colors.ember, 0), fade(colors.ember, 0.22), fade(colors.sky, 0.18), fade(colors.sky, 0)]}
        locations={[0, 0.42, 0.58, 1]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={[{ position: "absolute", width: travel * 1.15, height: height * 2.6, top: 0, left: 0 }, bandB]}
      />
    </View>
  );
}
