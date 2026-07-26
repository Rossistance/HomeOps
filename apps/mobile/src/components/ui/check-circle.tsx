// The check-off.
//
// This is the most-repeated gesture in the app — groceries, chores, packing lists — and it
// was two different things in two places: a real spring on the Tasks screen, and an instant
// colour flip on Groceries. One component now, so ticking something off feels the same
// wherever you do it.
//
// The motion is borrowed from the SwiftUI "on-off" idiom: the circle overshoots and settles,
// the checkmark arrives on its OWN spring a beat later (so it reads as landing in the circle
// rather than appearing with it), and a ring expands out once and fades. Three springs, not
// three timings — a timed pop looks mechanical at this size, and the difference is the whole
// reason to bother.
//
// Nothing here fires on mount: opening a list of forty ticked items should be still, not a
// firework. The first render just draws the state.
import { useEffect, useRef } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withSequence, withSpring, withTiming,
} from "react-native-reanimated";
import { useTheme } from "@/theme";
import { Sym } from "./symbol";

export function CheckCircle({
  done, onPress, disabled = false, size = 24, tone, label,
}: {
  done: boolean;
  onPress: () => void;
  disabled?: boolean;
  size?: number;
  /** Accent for the checked state. Defaults to sage (the app's "done" colour). */
  tone?: string;
  /** What this is checking off — read out instead of a bare "checkbox". */
  label?: string;
}) {
  const { colors } = useTheme();
  const accent = tone ?? colors.sage;
  const circle = useSharedValue(1);
  const mark = useSharedValue(done ? 1 : 0);
  const ring = useSharedValue(0);
  const first = useRef(true);

  useEffect(() => {
    // Skip the first pass — see the note above.
    if (first.current) { first.current = false; mark.value = done ? 1 : 0; return; }
    circle.value = withSequence(
      withSpring(1.18, { damping: 11, stiffness: 440, reduceMotion: ReduceMotion.System }),
      withSpring(1, { damping: 15, stiffness: 300, reduceMotion: ReduceMotion.System }),
    );
    // The mark lands a beat after the circle starts moving, and leaves immediately —
    // unchecking should feel like taking something back, not like a second celebration.
    mark.value = done
      ? withDelay(60, withSpring(1, { damping: 12, stiffness: 500, reduceMotion: ReduceMotion.System }))
      : withTiming(0, { duration: 110, reduceMotion: ReduceMotion.System });
    if (done) {
      ring.value = 0;
      ring.value = withTiming(1, { duration: 420, reduceMotion: ReduceMotion.System });
    }
  }, [done, circle, mark, ring]);

  const circleStyle = useAnimatedStyle(() => ({ transform: [{ scale: circle.value }] }));
  const markStyle = useAnimatedStyle(() => ({
    opacity: mark.value,
    // A touch of rotation on the way in: the mark settles into place rather than snapping.
    transform: [{ scale: mark.value }, { rotate: `${(1 - mark.value) * -25}deg` }],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: (1 - ring.value) * 0.5,
    transform: [{ scale: 1 + ring.value * 0.9 }],
  }));

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: done, disabled }}
      accessibilityLabel={label ?? (done ? "Mark as not done" : "Mark as done")}
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        {/* The ring lives behind and is purely decorative — pointerEvents none so it can
            never eat the tap it's celebrating. */}
        <Animated.View
          pointerEvents="none"
          style={[{
            position: "absolute", width: size, height: size, borderRadius: size / 2,
            borderWidth: 2, borderColor: accent,
          }, ringStyle]}
        />
        <Animated.View
          style={[{
            width: size, height: size, borderRadius: size / 2, borderWidth: 2,
            borderColor: done ? accent : colors.textFaint,
            backgroundColor: done ? accent : "transparent",
            alignItems: "center", justifyContent: "center",
          }, circleStyle]}
        >
          <Animated.View style={markStyle}>
            <Sym name="checkmark" size={Math.round(size * 0.55)} color={colors.surface} />
          </Animated.View>
        </Animated.View>
      </View>
    </Pressable>
  );
}
