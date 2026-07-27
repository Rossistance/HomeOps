// List rows and section headers — the workhorse layout for every screen.
import type { ReactNode } from "react";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { PressableScale } from "./pressable-scale";
import { T } from "./text";
import { Sym, SymTile } from "./symbol";
import { GoArrow } from "./expander";

export function SectionHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  const { spacing } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.xl, marginBottom: spacing.sm }}>
      <T kind="eyebrow">{title}</T>
      {trailing}
    </View>
  );
}

export interface RowProps {
  title: string;
  subtitle?: string;
  icon?: string;          // SF symbol
  iconColor?: string;
  iconBg?: string;
  /** Custom leading element, used INSTEAD of `icon`. Exists so member rows can show a
   *  real profile photo: "each member here has just a generic person icon — they need
   *  their profile pictures here" (owner walkthrough, 25:15). */
  leading?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  last?: boolean;         // suppress divider
}

/** A row inside a Card (use with padded={false} and divide rows automatically). */
export function Row({ title, subtitle, icon, iconColor, iconBg, leading, trailing, chevron, onPress, onLongPress, last }: RowProps) {
  const { colors, spacing } = useTheme();
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 13, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.border }}>
      {leading ?? (icon ? <SymTile name={icon} color={iconColor ?? colors.textMuted} bg={iconBg ?? colors.surfaceSunken} /> : null)}
      <View style={{ flex: 1, gap: 2 }}>
        <T kind="bodyMedium" color={colors.text}>{title}</T>
        {/* A9 [19:43] — "the template descriptions need to be fully visible." Clamped at two
            lines, the longer ones stopped mid-sentence, which is A4's complaint again: "why
            would I click on something if I don't know exactly what it says." Unclamped HERE,
            in the shared primitive, so it's fixed for every list in the app at once rather
            than one screen at a time (A13). */}
        {subtitle ? <T kind="sub">{subtitle}</T> : null}
      </View>
      {trailing}
      {/* N1 [06:43] — "all of these little arrows need to be bigger and more prominent and
          pronounced… the user will try to click that tiny little arrow only, which is hard to
          hit." Bigger, darker, and in a tap target you can actually land on. The whole row is
          still pressable; this makes that look true. */}
      {chevron ? (
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
          <GoArrow tone={colors.textSecondary} size={26} />
        </View>
      ) : null}
    </View>
  );
  if (!onPress && !onLongPress) return body;
  return (
    <PressableScale onPress={onPress} onLongPress={onLongPress} scaleTo={0.99} haptic="select">
      {body}
    </PressableScale>
  );
}
