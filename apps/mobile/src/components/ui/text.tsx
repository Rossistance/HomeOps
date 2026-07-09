// Typography primitives. Newsreader = display voice (screen titles, hero lines,
// agent names); system SF Pro = body/UI voice. Never set fontFamily in screens,
// and never set body copy in the serif.
import { Text, type TextProps } from "react-native";
import { useTheme } from "@/theme";

type Kind = "h1" | "h2" | "h2Serif" | "hero" | "h3" | "rowTitle" | "body" | "bodyMedium" | "sub" | "subMedium" | "detail" | "caption" | "eyebrow" | "tab";

interface TProps extends TextProps {
  kind?: Kind;
  color?: string;
  center?: boolean;
}

export function T({ kind = "body", color, center, style, ...rest }: TProps) {
  const { colors, type } = useTheme();
  const base = type[kind];
  const fallback =
    kind === "h1" || kind === "h2" || kind === "h2Serif" || kind === "hero" || kind === "rowTitle" || kind === "h3" ? colors.text :
    kind === "eyebrow" || kind === "caption" || kind === "tab" ? colors.textFaint :
    kind === "sub" || kind === "subMedium" || kind === "detail" ? colors.textMuted :
    colors.textSecondary;
  return (
    <Text
      {...rest}
      style={[base, { color: color ?? fallback }, center && { textAlign: "center" }, style]}
    />
  );
}
