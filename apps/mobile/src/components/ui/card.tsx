// Material surfaces — soft UI (see theme/neumorph.ts).
//
// A card is molded from the page rather than placed on it: same material, raised out of it by
// two opposing shadows. A Well is the same material pressed IN. That pairing is what makes
// nesting read as real depth — a raised card containing an inset well containing a raised
// tile — and it's the whole reason the style is worth adopting rather than just decorating
// with.
//
// The 1px border stays, quietly, under the shadows. The reference sets `border: transparent`
// and relies on shadow alone for every edge; that leaves a card with no edge at all for anyone
// who can't perceive soft shadows, and a phone in sunlight is a version of that for everyone.
import type { ReactNode } from "react";
import { View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/theme";
import { depth, softSurface, softRadii } from "@/theme/neumorph";
import { PressableScale, type PressableScaleProps } from "./pressable-scale";

export function cardStyle(colors: ReturnType<typeof useTheme>["colors"], dark: boolean): ViewStyle {
  return {
    backgroundColor: softSurface(colors, dark),
    borderRadius: softRadii.card,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: colors.border,
    boxShadow: depth("raised", colors, dark),
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

/** The same material, pressed in. Inputs and secondary information sit in one of these. */
export function Well({ children, style, onLayout }: { children: ReactNode; style?: StyleProp<ViewStyle>; onLayout?: (e: LayoutChangeEvent) => void }) {
  const { colors, dark, spacing } = useTheme();
  return (
    <View
      onLayout={onLayout}
      style={[{
        backgroundColor: softSurface(colors, dark),
        borderRadius: softRadii.control,
        borderCurve: "continuous",
        boxShadow: depth("inset", colors, dark),
        padding: spacing.md,
      }, style]}
    >
      {children}
    </View>
  );
}
