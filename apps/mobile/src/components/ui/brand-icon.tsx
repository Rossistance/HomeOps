// Real brand logos for OAuth providers — instant visual identification on
// provider cards and account rows. Bundled PNGs (no network); unknown ids fall
// back to a neutral SF-symbol tile.
import { Image } from "expo-image";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { Sym } from "./symbol";

const BRAND_LOGOS: Record<string, number> = {
  google: require("../../../assets/brands/google.png"),
  microsoft: require("../../../assets/brands/microsoft.png"),
  slack: require("../../../assets/brands/slack.png"),
  dropbox: require("../../../assets/brands/dropbox.png"),
  notion: require("../../../assets/brands/notion.png"),
  todoist: require("../../../assets/brands/todoist.png"),
  ticktick: require("../../../assets/brands/ticktick.png"),
};

/** Brand logo in a soft white tile (logos need a neutral backdrop in dark mode). */
export function BrandIcon({ provider, size = 34 }: { provider: string; size?: number }) {
  const { colors, dark } = useTheme();
  const source = BRAND_LOGOS[provider.toLowerCase()];
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size * 0.32, borderCurve: "continuous",
        backgroundColor: dark ? "#f3ecdf" : "#ffffff",
        borderWidth: 1, borderColor: colors.border,
        alignItems: "center", justifyContent: "center",
      }}
    >
      {source ? (
        <Image source={source} style={{ width: size * 0.62, height: size * 0.62 }} contentFit="contain" />
      ) : (
        <Sym name="link" size={size * 0.5} color={colors.textMuted} />
      )}
    </View>
  );
}
