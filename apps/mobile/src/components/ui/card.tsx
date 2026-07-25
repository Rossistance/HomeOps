// Material surfaces. Cards get a warm rim highlight + soft drop shadow (light)
// or a rim-only treatment (dark). PressableCard adds tactile scale + haptic.
import type { ReactNode } from "react";
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";
import { PressableScale, type PressableScaleProps } from "./pressable-scale";

// Handoff: cards are 22px radius, 1px cardBorder outline, very quiet resting
// shadow (0 1px 2px @ 4%). Dark mode is border-only.
export function cardStyle(colors: ReturnType<typeof useTheme>["colors"], dark: boolean): ViewStyle {
  return {
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: dark ? "none" : "0 1px 2px rgba(32,28,21,0.04)",
  };
}

export function Card({ children, style, padded = true, onLayout }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean; onLayout?: (e: LayoutChangeEvent) => void }) {
  const { colors, dark, spacing } = useTheme();
  return <View onLayout={onLayout} style={[cardStyle(colors, dark), padded && { padding: spacing.lg }, style]}>{children}</View>;
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
export function Well({ children, style, onLayout }: { children: ReactNode; style?: StyleProp<ViewStyle>; onLayout?: (e: LayoutChangeEvent) => void }) {
  const { colors, spacing } = useTheme();
  return (
    <View onLayout={onLayout} style={[{ backgroundColor: colors.surfaceSunken, borderRadius: 16, borderCurve: "continuous", padding: spacing.md }, style]}>
      {children}
    </View>
  );
}
