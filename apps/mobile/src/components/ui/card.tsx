// Material surfaces. Cards get a warm rim highlight + soft drop shadow (light)
// or a rim-only treatment (dark). PressableCard adds tactile scale + haptic.
import type { ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";
import { PressableScale, type PressableScaleProps } from "./pressable-scale";

export function cardStyle(colors: ReturnType<typeof useTheme>["colors"], dark: boolean): ViewStyle {
  return {
    backgroundColor: colors.surface,
    borderRadius: 20,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: dark ? colors.rim : colors.border,
    boxShadow: dark ? "none" : `0 1px 0 ${colors.rim} inset, 0 6px 18px ${colors.shadow}`,
  };
}

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const { colors, dark, spacing } = useTheme();
  return <View style={[cardStyle(colors, dark), padded && { padding: spacing.lg }, style]}>{children}</View>;
}

export function PressableCard({ children, style, padded = true, ...rest }: PressableScaleProps & { padded?: boolean }) {
  const { colors, dark, spacing } = useTheme();
  return (
    <PressableScale {...rest} style={[cardStyle(colors, dark), padded && { padding: spacing.lg }, style as object]}>
      {children}
    </PressableScale>
  );
}

/** Sunken surface for inputs / secondary info wells. */
export function Well({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors, spacing } = useTheme();
  return (
    <View style={[{ backgroundColor: colors.surfaceSunken, borderRadius: 14, borderCurve: "continuous", padding: spacing.md }, style]}>
      {children}
    </View>
  );
}
