// The FamiliOS mark.
//
// "The icon on the Ask Famili screen is not the FamiliOS icon — it needs to be the same thing."
//
// It was a generic SF sparkle, which is the icon a hundred apps use for "AI". This is the app's
// own: the ink-navy field the Ask hero is made of, with the ember spark on it — the same two
// things the hero card and the app icon are built from, so the header, the card on Today, and
// the icon on the home screen are recognisably one object.
//
// Drawn rather than shipped as a bitmap so it stays crisp at any size, tints with the theme,
// and doesn't add an asset to keep in sync with the real app icon.
import { View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@/theme";
import { Sym } from "./symbol";

export function FamiliMark({ size = 22 }: { size?: number }) {
  const { colors } = useTheme();
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <LinearGradient
        colors={[colors.hero1, colors.hero2]}
        start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
        style={{
          width: size, height: size,
          borderRadius: size * 0.28, borderCurve: "continuous",
          alignItems: "center", justifyContent: "center",
        }}
      >
        <Sym name="sparkle" size={Math.round(size * 0.62)} color={colors.ember} />
      </LinearGradient>
    </View>
  );
}
