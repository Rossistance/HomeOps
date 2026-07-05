// SF Symbols via expo-image ("sf:" source) — crisp, weight-aware native icons.
import { Image } from "expo-image";
import { View } from "react-native";
import { useTheme } from "@/theme";

export function Sym({ name, size = 20, color, style }: { name: string; size?: number; color?: string; style?: object }) {
  const { colors } = useTheme();
  const tint = color ?? colors.textMuted;
  if (process.env.EXPO_OS !== "ios") {
    return <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint, opacity: 0.35 }, style]} />;
  }
  return <Image source={`sf:${name}`} tintColor={tint as string} style={[{ width: size, height: size }, style]} contentFit="contain" />;
}

/** Icon in a soft rounded tile — the standard leading visual for rows/cards. */
export function SymTile({ name, color, bg, size = 34, iconSize }: { name: string; color: string; bg: string; size?: number; iconSize?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.32, borderCurve: "continuous", backgroundColor: bg, alignItems: "center", justifyContent: "center" }}>
      <Sym name={name} size={iconSize ?? Math.round(size * 0.55)} color={color} />
    </View>
  );
}
