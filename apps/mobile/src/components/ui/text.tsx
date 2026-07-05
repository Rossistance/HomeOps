// Typography primitives. Fraunces = hearth voice (headings, hero numbers);
// Inter = UI voice (everything else). Never set fontFamily in screens.
import { Text, type TextProps } from "react-native";
import { useTheme } from "@/theme";

type Kind = "h1" | "h2" | "h3" | "body" | "bodyMedium" | "sub" | "subMedium" | "caption" | "eyebrow";

interface TProps extends TextProps {
  kind?: Kind;
  color?: string;
  center?: boolean;
}

export function T({ kind = "body", color, center, style, ...rest }: TProps) {
  const { colors, type } = useTheme();
  const base = type[kind];
  const fallback =
    kind === "h1" || kind === "h2" ? colors.text :
    kind === "eyebrow" || kind === "caption" ? colors.textFaint :
    kind === "sub" || kind === "subMedium" ? colors.textMuted :
    colors.textSecondary;
  return (
    <Text
      {...rest}
      style={[base, { color: color ?? fallback }, center && { textAlign: "center" }, style]}
    />
  );
}
