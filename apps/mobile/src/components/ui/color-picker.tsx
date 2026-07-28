// One colour picker, everywhere a colour is picked.
//
// There were three (Profile, Settings' member editor, Onboarding), each with its own accent
// list, and only Profile checked collisions — "in the settings page you do have the ability
// to select a color that someone else is already on… boots them off." A family app whose
// primary identity signal can be silently stolen in one screen and defended in another isn't
// strict, it's decorative. This component is the strictness: one list (lib/member-colors
// ACCENTS), one closeness rule (colorDistance/TOO_CLOSE — "if it's taken, or within two
// deviations, block it"), and one spectrum ("this really should turn into a palette and a
// spectrum selector, so colors that are not currently offered can be created").
//
// Taken swatches render dimmed with the holder named on tap, never silently ignored — a
// control that eats a tap teaches people it's broken. The server enforces the same rule
// again on write, because a picker is advice and an API is law.
import { useMemo, useState } from "react";
import { View } from "react-native";
import { useTheme, tapHaptic } from "@/theme";
import { ACCENTS, colorDistance, heldBy, memberAccent, memberColor, TOO_CLOSE } from "@/lib/member-colors";
import type { MemberRec } from "@/lib/api";
import { PressableScale } from "./pressable-scale";
import { T } from "./text";

/* The spectrum: 12 hues × 3 lightness bands, generated rather than curated so "colors that
 * are not currently offered" genuinely exist. HSL→hex at fixed saturation keeps every cell
 * family-friendly rather than neon. */
function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
const SPECTRUM: string[] = [];
for (const l of [0.66, 0.52, 0.38]) for (let h = 0; h < 360; h += 30) SPECTRUM.push(hsl(h, 0.52, l));

export function ColorPicker({ value, onChange, others, compact = false }: {
  value: string | null;
  onChange: (color: string) => void;
  /** Everyone WHOSE colour must be respected — i.e. the household minus the person picking. */
  others: MemberRec[];
  /** Hide the spectrum (onboarding keeps its first run simple). */
  compact?: boolean;
}) {
  const { colors, spacing } = useTheme();
  const [blocked, setBlocked] = useState<string | null>(null);

  const pick = (c: string) => {
    const holder = heldBy(colors, c, others);
    if (holder) {
      tapHaptic("warning");
      setBlocked(`${holder.displayName.split(" ")[0]} has that colour (or one too close to it). Pick one further away.`);
      return;
    }
    setBlocked(null);
    tapHaptic("select");
    onChange(c);
  };

  const selectedHex = value ? (memberAccent(colors, value) ?? value) : null;
  const Swatch = ({ c, resolved }: { c: string; resolved: string }) => {
    const holder = heldBy(colors, c, others);
    const selected = !!selectedHex && colorDistance(selectedHex, resolved) === 0;
    return (
      <PressableScale
        key={c}
        onPress={() => pick(c)}
        haptic={null}
        accessibilityRole="button"
        accessibilityLabel={holder ? `${resolved}, taken by ${holder.displayName}` : resolved}
        accessibilityState={{ selected, disabled: !!holder }}
        style={{
          width: 38, height: 38, borderRadius: 19,
          alignItems: "center", justifyContent: "center",
          borderWidth: selected ? 3 : 0, borderColor: colors.text,
        }}
      >
        <View style={{ width: selected ? 26 : 32, height: selected ? 26 : 32, borderRadius: 16, backgroundColor: resolved, opacity: holder ? 0.25 : 1 }} />
      </PressableScale>
    );
  };

  const named = useMemo(() => ACCENTS.map((a) => ({ c: a as string, resolved: memberAccent(colors, a) ?? colors.ember })), [colors]);

  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
        {named.map((s) => <Swatch key={s.c} c={s.c} resolved={s.resolved} />)}
      </View>
      {!compact ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {SPECTRUM.map((c) => <Swatch key={c} c={c} resolved={c} />)}
        </View>
      ) : null}
      {blocked ? <T kind="caption" color={colors.coral}>{blocked}</T> : null}
      {/* The rule, said once, so a dimmed swatch reads as policy rather than a glitch. */}
      <T kind="caption" color={colors.textFaint}>One colour per person — it&apos;s how everyone tells whose things are whose.</T>
    </View>
  );
}
