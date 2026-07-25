// Buttons. Ember is the ONE primary action per view; everything else is
// neutral/ghost. Built-in loading state so screens never hand-roll spinners.
import { ActivityIndicator, View } from "react-native";
import { useTheme } from "@/theme";
import { PressableScale } from "./pressable-scale";
import { T } from "./text";
import { Sym } from "./symbol";

/* `emberOutline` is the PEER of `ember`, not a lesser thing — filled and outlined read as two
 * halves of one choice. Added for "Offer help needs to have another colour. Right now it looks
 * like it's not available; it doesn't look like the opposite of Ask for Help… maybe orange
 * lettering, white background and an orange border." That is exactly this. */
type Variant = "ember" | "emberOutline" | "neutral" | "ghost" | "success" | "danger";

export interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  icon?: string;          // SF symbol name
  loading?: boolean;
  disabled?: boolean;
  small?: boolean;
  full?: boolean;
}

export function Button({ title, onPress, variant = "neutral", icon, loading, disabled, small, full }: ButtonProps) {
  const { colors, dark } = useTheme();
  const palette: Record<Variant, { bg: string; fg: string; border?: string }> = {
    ember: { bg: colors.ember, fg: colors.onEmber },
    success: { bg: colors.sage, fg: dark ? "#10160f" : "#ffffff" },
    danger: { bg: colors.coral, fg: dark ? "#1a0e08" : "#ffffff" },
    emberOutline: { bg: colors.surface, fg: colors.ember, border: colors.ember },
    neutral: { bg: colors.surface, fg: colors.textSecondary, border: dark ? colors.rim : colors.border },
    ghost: { bg: "transparent", fg: colors.textMuted },
  };
  const p = palette[variant];
  const inactive = disabled || loading;
  const haptic = variant === "danger" ? "warning" : variant === "ember" || variant === "emberOutline" || variant === "success" ? "light" : "select";
  return (
    <PressableScale
      onPress={onPress}
      disabled={inactive}
      haptic={inactive ? null : haptic}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={{
        minHeight: small ? 36 : 48,
        paddingHorizontal: small ? 14 : 20,
        borderRadius: small ? 12 : 14,
        borderCurve: "continuous",
        backgroundColor: p.bg,
        borderWidth: p.border ? (variant === "emberOutline" ? 1.5 : 1) : 0,
        borderColor: p.border,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "row",
        gap: 8,
        opacity: inactive ? 0.55 : 1,
        alignSelf: full ? "stretch" : "auto",
        boxShadow: variant === "ember" && !dark ? `0 4px 14px rgba(210,100,32,0.35)` : "none",
      }}
    >
      {loading ? (
        <ActivityIndicator size="small" color={p.fg} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {icon ? <Sym name={icon} size={small ? 14 : 17} color={p.fg} /> : null}
          <T kind={small ? "subMedium" : "bodyMedium"} color={p.fg} style={{ fontFamily: undefined }}>
            {title}
          </T>
        </View>
      )}
    </PressableScale>
  );
}
