// The expand control. One of them, everywhere.
//
// "The expand button on nearly all cards is still very small, and in some cases it is scaled
//  down. These are not the same size. They need to be the same size, and they need to be
//  consistent throughout the application. They should be larger, filled in, and look like
//  arrows that I can see… On Playbooks it has no circle around it, no definition to it,
//  whereas if we look at the New Agent screen, that expand card has some definition — it has a
//  circle that's a different shade that offsets it and makes it look like an actual arrow.
//  That needs to exist throughout the application."
//
// Everything about the old state came from the same root: there was no component. Each screen
// reached for a bare `<Sym name="chevron.right" size={13}>` and picked its own size, so the
// sizes drifted (11, 12, 13, and one at 60% of a scaled parent), and the ones inside a scaled
// container came out smaller still. Consistency wasn't lost — it was never possible.
//
// So: a real control, with the New Agent screen's treatment as the standard because that's the
// one he pointed at as right. A filled disc a shade off the surface, a bold arrow on it, and a
// 44pt touch target regardless of how big the disc is drawn — the visual can be quiet, the
// hit area can't.
//
// It rotates rather than swapping glyphs. Down means "this opens", up means "this closes", and
// the turn between them tells you which just happened, which a chevron that teleports doesn't.
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useTheme } from "@/theme";
import { depth, rimColor } from "@/theme/neumorph";
import { PressableScale } from "./pressable-scale";
import { Sym } from "./symbol";

export type ExpanderKind = "chevron" | "more";

export function Expander({
  open = false, onPress, kind = "chevron", tone, size = 30, label,
}: {
  /** Rotates the arrow. Ignored for `more`. */
  open?: boolean;
  onPress?: () => void;
  /** "The card needs to contain either an expansion arrow, or a three-dot menu." */
  kind?: ExpanderKind;
  /** Accent for the glyph. Defaults to the card's own quiet ink. */
  tone?: string;
  size?: number;
  label?: string;
}) {
  const { colors, dark } = useTheme();
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.value = withSpring(open ? 1 : 0, { damping: 15, stiffness: 210, reduceMotion: ReduceMotion.System });
  }, [open, turn]);
  const arrow = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * -180}deg` }] }));

  const fg = tone ?? colors.textSecondary;
  const disc = (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2,
        // The circle he described: a different shade that offsets it, so the arrow reads as a
        // control rather than as punctuation at the end of a row.
        backgroundColor: dark ? colors.surfaceSunken : colors.bg,
        borderWidth: 1, borderColor: rimColor(colors, dark),
        boxShadow: depth("raisedSm", colors, dark),
        alignItems: "center", justifyContent: "center",
      }}
    >
      {kind === "more" ? (
        <Sym name="more" size={Math.round(size * 0.5)} color={fg} />
      ) : (
        <Animated.View style={arrow}>
          {/* Down, not right: this opens something in place. `size * 0.52` keeps the arrow
              visually large inside the disc — the old 13px glyph in a 34px row was the
              "very small" being reported. */}
          <Sym name="chevron.down" size={Math.round(size * 0.52)} color={fg} />
        </Animated.View>
      )}
    </View>
  );

  if (!onPress) return disc;
  return (
    <PressableScale
      onPress={onPress}
      haptic="select"
      // 44pt minimum however small the disc is drawn — Apple's floor, and the difference
      // between "small" and "unhittable" on a moving bus.
      hitSlop={Math.max(0, Math.round((44 - size) / 2))}
      accessibilityRole="button"
      accessibilityState={{ expanded: kind === "chevron" ? open : undefined }}
      accessibilityLabel={label ?? (kind === "more" ? "More options" : open ? "Collapse" : "Expand")}
    >
      {disc}
    </PressableScale>
  );
}

/**
 * A row's trailing "go there" arrow — the navigational cousin.
 *
 * Same disc, same weight, pointing right instead of down, because "this opens in place" and
 * "this takes you somewhere" are different promises and were being made by the same 13px
 * chevron.
 */
export function GoArrow({ tone, size = 28, label }: { tone?: string; size?: number; label?: string }) {
  const { colors, dark } = useTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      accessibilityLabel={label}
      style={{
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: dark ? colors.surfaceSunken : colors.bg,
        borderWidth: 1, borderColor: rimColor(colors, dark),
        boxShadow: depth("raisedSm", colors, dark),
        alignItems: "center", justifyContent: "center",
      }}
    >
      <Sym name="chevron.right" size={Math.round(size * 0.5)} color={tone ?? colors.textSecondary} />
    </View>
  );
}
