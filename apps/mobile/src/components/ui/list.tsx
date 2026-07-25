// List rows and section headers — the workhorse layout for every screen.
import type { ReactNode } from "react";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { PressableScale } from "./pressable-scale";
import { T } from "./text";
import { Sym, SymTile } from "./symbol";

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
        {subtitle ? <T kind="sub" numberOfLines={2}>{subtitle}</T> : null}
      </View>
      {trailing}
      {chevron ? <Sym name="chevron.right" size={13} color={colors.textFaint} /> : null}
    </View>
  );
  if (!onPress && !onLongPress) return body;
  return (
    <PressableScale onPress={onPress} onLongPress={onLongPress} scaleTo={0.99} haptic="select">
      {body}
    </PressableScale>
  );
}
