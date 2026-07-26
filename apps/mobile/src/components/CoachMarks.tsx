// The spotlight.
//
// Four panels of scrim around a hole, rather than an SVG mask: the hole is a real gap, so the
// control underneath is genuinely the screen you were already looking at — same pixels, same
// colours, same data — instead of a copy drawn on top. It also means there is no z-order
// argument with the native tab bar, and nothing to re-render as the tour moves.
//
// The scrim panels swallow taps. That's on purpose and it's the one place this thing is
// deliberately modal: the walkthrough points at ONE control at a time, and letting a stray tap
// on a dimmed card navigate away mid-sentence would leave the tour pointing at a screen that
// isn't there any more. The hole itself does not swallow taps — the real control stays live
// underneath, so you can press the thing being described while it's being described.
import { useEffect } from "react";
import { Dimensions, View } from "react-native";
import Animated, {
  Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";
import { useTutorial } from "@/lib/tutorial";
import { depth, rimColor } from "@/theme/neumorph";
import { Button } from "./ui/button";
import { PressableScale } from "./ui/pressable-scale";
import { T } from "./ui/text";

const SCRIM = "rgba(12,9,5,0.72)";
const PAD = 8;      // breathing room between the control and the edge of the hole
const GAP = 14;     // between the hole and the bubble

export function CoachMarks() {
  const { running, step, rect, index, shown, onLast, empty, next, stop } = useTutorial();
  const { colors, dark, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const win = Dimensions.get("window");
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (!running) return;
    // A slow breath on the ring. The spotlight is already the loudest thing on screen; this is
    // only so a stationary highlight doesn't read as a rendering artifact.
    pulse.value = 0;
    pulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1100, easing: Easing.inOut(Easing.sin), reduceMotion: ReduceMotion.System }),
        withTiming(0, { duration: 1100, easing: Easing.inOut(Easing.sin), reduceMotion: ReduceMotion.System }),
      ), -1, false, undefined, ReduceMotion.System,
    );
  }, [running, index, pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    opacity: 0.45 + pulse.value * 0.55,
    transform: [{ scale: 1 + pulse.value * 0.02 }],
  }));

  /* Nothing to point at. Shown rather than swallowed: a "Show me around" that silently does
   * nothing is indistinguishable from a broken button, and the likeliest cause is a screen
   * nobody has given Coach targets yet — which is our problem, not the user's, so it says so
   * plainly instead of blaming their role. */
  if (empty) {
    return (
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: SCRIM }}>
        <View style={{
          position: "absolute", left: spacing.lg, right: spacing.lg, top: win.height / 2 - 90,
          backgroundColor: dark ? colors.surface : colors.bg,
          borderRadius: 20, borderCurve: "continuous",
          borderWidth: 1, borderColor: rimColor(colors, dark),
          boxShadow: depth("raisedLg", colors, dark),
          padding: spacing.lg, gap: 8,
        }}>
          <T kind="h3" color={colors.text}>Nothing to show you here yet</T>
          <T kind="sub">
            The walkthrough couldn&apos;t find anything to point at on this screen. That&apos;s a
            gap on our side, not something you did.
          </T>
          <View style={{ marginTop: 4 }}>
            <Button small full variant="ember" icon="checkmark" title="Close" onPress={stop} />
          </View>
        </View>
      </View>
    );
  }

  if (!running || !step || !rect) return null;

  const hole = {
    x: Math.max(0, rect.x - PAD),
    y: Math.max(0, rect.y - PAD),
    w: Math.min(win.width, rect.width + PAD * 2),
    h: rect.height + PAD * 2,
  };

  /* Which side the bubble goes on. The step states a preference, but space wins: a bubble
   * pushed off the bottom of the screen to honour `place: "below"` would be a worse tutorial
   * than one that quietly moved. ~190pt is the tallest this bubble gets with two lines of body
   * text and its controls. */
  const BUBBLE_H = 190;
  const roomBelow = win.height - (hole.y + hole.h) - insets.bottom - GAP;
  const below = step.place === "below" ? roomBelow > BUBBLE_H * 0.7 : roomBelow > BUBBLE_H;
  const bubbleTop = below ? hole.y + hole.h + GAP : undefined;
  const bubbleBottom = below ? undefined : win.height - hole.y + GAP;

  const last = onLast;

  return (
    // pointerEvents box-none: the panels below catch their own taps, the hole passes them
    // through to the real control.
    <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} pointerEvents="box-none">
      {/* The four panels. Each is its own pressable so a tap on the dimmed area advances the
          tour rather than doing nothing — a dead scrim invites people to tap harder. */}
      {([
        { left: 0, top: 0, width: win.width, height: hole.y },
        { left: 0, top: hole.y + hole.h, width: win.width, height: Math.max(0, win.height - hole.y - hole.h) },
        { left: 0, top: hole.y, width: hole.x, height: hole.h },
        { left: hole.x + hole.w, top: hole.y, width: Math.max(0, win.width - hole.x - hole.w), height: hole.h },
      ] as const).map((p, i) => (
        <PressableScale
          key={i} haptic={null} scaleTo={1} onPress={next}
          accessibilityLabel="Continue the walkthrough"
          style={{ position: "absolute", backgroundColor: SCRIM, ...p }}
        />
      ))}

      {/* The ring around the hole. Ember, like every other "this is the thing" in the app. */}
      <Animated.View
        pointerEvents="none"
        style={[{
          position: "absolute", left: hole.x, top: hole.y, width: hole.w, height: hole.h,
          borderRadius: 18, borderCurve: "continuous",
          borderWidth: 2, borderColor: colors.ember,
        }, ringStyle]}
      />

      <View
        style={{
          position: "absolute", left: spacing.lg, right: spacing.lg,
          ...(bubbleTop != null ? { top: bubbleTop } : { bottom: bubbleBottom }),
          backgroundColor: dark ? colors.surface : colors.bg,
          borderRadius: 20, borderCurve: "continuous",
          borderWidth: 1, borderColor: rimColor(colors, dark),
          boxShadow: depth("raisedLg", colors, dark),
          padding: spacing.lg, gap: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
          {/* No denominator: steps that aren't on this person's screen get skipped, so any
              total printed up front would eventually be wrong in front of the user. */}
          <T kind="eyebrow" color={colors.ember} style={{ flex: 1 }}>
            Step {shown}
          </T>
          <PressableScale onPress={stop} haptic="select" hitSlop={10} accessibilityRole="button" accessibilityLabel="End the walkthrough">
            <T kind="subMedium" color={colors.textMuted}>Skip</T>
          </PressableScale>
        </View>
        <T kind="h3" color={colors.text}>{step.title}</T>
        <T kind="sub">{step.body}</T>
        <View style={{ marginTop: 4 }}>
          <Button
            small full variant="ember"
            icon={last ? "checkmark" : "arrow.right"}
            title={last ? "Done" : "Next"}
            onPress={last ? stop : next}
          />
        </View>
      </View>
    </View>
  );
}
