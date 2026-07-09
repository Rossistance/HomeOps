// FamiliOS brand pieces: the "huddle" app icon mark and the wordmark.
// Geometry from the handoff spec (96pt reference frame, scaled by size/96).
// The splash/hero palette is fixed ink-navy regardless of theme.
import { View, Text, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { fonts } from "@/theme";

export const SPLASH_BG: [string, string] = ["#232B3E", "#10141E"];
export const MARK_BG: [string, string] = ["#252D42", "#12161F"];
export const BRAND_EMBER = "#E0662C";
export const BRAND_GOLD = "#E8A34E";
export const BRAND_PORCELAIN = "#F5F1E9";

/** The three-circle family huddle on an ink gradient tile. */
export function HuddleMark({ size = 96, radius, style }: { size?: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  const s = size / 96;
  const r = radius ?? size * (25 / 96);
  return (
    <LinearGradient
      colors={MARK_BG}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.75, y: 1 }}
      style={[{ width: size, height: size, borderRadius: r, borderCurve: "continuous", overflow: "hidden" }, style]}
    >
      {/* soft ember glow, bottom-right */}
      <View
        style={{
          position: "absolute", right: -size * 0.18, bottom: -size * 0.18,
          width: size * 0.62, height: size * 0.62, borderRadius: size,
          backgroundColor: "rgba(224,102,44,0.28)",
          boxShadow: `0 0 ${28 * s}px ${22 * s}px rgba(224,102,44,0.28)`,
        }}
      />
      <View style={{ position: "absolute", left: 18 * s, top: 34 * s, width: 44 * s, height: 44 * s, borderRadius: 22 * s, backgroundColor: BRAND_EMBER }} />
      <View style={{ position: "absolute", left: 55 * s, top: 43 * s, width: 29 * s, height: 29 * s, borderRadius: 14.5 * s, backgroundColor: BRAND_PORCELAIN }} />
      <View style={{ position: "absolute", left: 40 * s, top: 17 * s, width: 20 * s, height: 20 * s, borderRadius: 10 * s, backgroundColor: BRAND_GOLD }} />
    </LinearGradient>
  );
}

/** "Famili" in ink + "OS" in ember, Newsreader 600. Pass light for dark grounds. */
export function Wordmark({ size = 28, light = false, ink }: { size?: number; light?: boolean; ink?: string }) {
  const inkColor = ink ?? (light ? BRAND_PORCELAIN : "#201C15");
  return (
    <Text style={{ fontFamily: fonts.display, fontSize: size, letterSpacing: -0.4, color: inkColor }}>
      Famili<Text style={{ color: BRAND_EMBER }}>OS</Text>
    </Text>
  );
}
