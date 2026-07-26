// SF Symbols via expo-image ("sf:" source) — crisp, weight-aware native icons.
import { Image } from "expo-image";
import { View } from "react-native";
import { useTheme } from "@/theme";
import { depth } from "@/theme/neumorph";
import { Glyph, hasGlyph } from "./glyph";

/**
 * An icon.
 *
 * Custom FamiliOS glyphs where we've drawn one (see ui/glyph), SF Symbols everywhere else.
 * One call site, one name, so the set can grow a glyph at a time without a flag day and
 * without every screen having to know which kind it's getting.
 */
export function Sym({ name, size = 20, color, style }: { name: string; size?: number; color?: string; style?: object }) {
  const { colors } = useTheme();
  const tint = color ?? colors.textMuted;
  if (hasGlyph(name)) return <Glyph name={name} size={size} color={tint} style={style} />;
  if (process.env.EXPO_OS !== "ios") {
    return <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint, opacity: 0.35 }, style]} />;
  }
  return <Image source={`sf:${name}`} tintColor={tint as string} style={[{ width: size, height: size }, style]} contentFit="contain" />;
}

/**
 * Icon in a well — the standard leading visual for rows and cards.
 *
 * The reference is emphatic about this one: "Icon wells: always use Inset Deep or Inset
 * shadows for icon containers. This makes them look drilled into the card." It's the detail
 * that sells the whole style, because it's where you see BOTH directions of depth at once —
 * a raised card with a hole cut into it.
 *
 * The tinted background stays. The reference is strictly monochrome and lets shadow do
 * everything; here the tint is load-bearing information — ember for calendar, sage for done,
 * lavender for help — and giving that up for stylistic purity would cost more than it buys.
 * So: our colour, their depth.
 *
 * Icons run larger than they did (60% of the tile, up from 55%, and callers were bumped
 * alongside). "A little larger and more noticeable" was the note, and a 17px glyph in a 36px
 * well was reading as a decoration rather than a symbol.
 */
export function SymTile({ name, color, bg, size = 36, iconSize }: { name: string; color: string; bg: string; size?: number; iconSize?: number }) {
  const { colors, dark } = useTheme();
  return (
    <View style={{
      width: size, height: size, borderRadius: size * 0.32, borderCurve: "continuous",
      backgroundColor: bg, alignItems: "center", justifyContent: "center",
      boxShadow: depth(size >= 40 ? "insetDeep" : "inset", colors, dark),
    }}>
      <Sym name={name} size={iconSize ?? Math.round(size * 0.6)} color={color} />
    </View>
  );
}
