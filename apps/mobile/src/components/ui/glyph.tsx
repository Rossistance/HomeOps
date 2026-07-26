// FamiliOS icons — drawn for this app, not borrowed from the system.
//
// "I believe the overall size and design for each icon used in the app should be custom. Each
//  should be a custom make and tailored to the current design. Each should be a little larger
//  and more noticeable and stand out."
//
// The app has been running on SF Symbols, which are excellent and completely generic: they're
// Apple's voice, tuned to sit quietly inside iOS chrome. Inside a soft-UI card with a warm
// porcelain palette they read as borrowed — thin, cool, and slightly too polite.
//
// THE RULES THESE ARE DRAWN TO, and they are the reason the set looks like a set:
//
//   One stroke weight, scaled with the icon (7.5% of the box), round caps and round joins.
//   Soft UI is pillowed; a mitred corner or a hairline stroke fights that everywhere it
//   appears.
//
//   A 24×24 box with a 2px margin, so every glyph occupies the same optical area. The single
//   most common icon-set failure is a house that looks twice the size of a clock because one
//   fills its box and the other doesn't.
//
//   Geometry over illustration. A circle, a rounded rectangle, an arc — shapes that stay
//   legible at 14px, where most of these live. Detail that disappears at small sizes is
//   detail that only ever helped the mockup.
//
//   Nothing drawn twice. `agents` and `sparkle` share a language; `home` and `library` share
//   a roofline. A set is recognisable because its members were drawn against each other.
//
// HONEST SCOPE. This is the working vocabulary — the icons that carry the tab bar, the Today
// screen, and the common rows — not all 83 symbol names in the app. Anything without a custom
// glyph falls through to SF Symbols and looks exactly as it did, so nothing breaks and the set
// can grow without a flag day. `hasGlyph` tells you which is which.
import { View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useTheme } from "@/theme";

/** Path data on a 24×24 grid. Stroked, not filled, unless the name ends in `.fill`. */
const GLYPHS: Record<string, { d: string[]; fill?: string[]; circles?: [number, number, number][] }> = {
  /* ---- the tab bar: five icons that have to work as a family, at 22px, side by side ---- */
  // A home with a hearth in it — the app is called FamiliOS and the room is the point.
  home: { d: ["M3.5 10.6 12 3.8l8.5 6.8", "M5.6 9.4V19a1.4 1.4 0 0 0 1.4 1.4h10a1.4 1.4 0 0 0 1.4-1.4V9.4"], circles: [[12, 15.2, 2.4]] },
  // Ask: a speech bubble whose tail is also the stem of a spark.
  ask: { d: ["M20 12.6a7.4 7.4 0 0 1-7.4 7.4H8.2L4 22.2l1.1-3.6A7.4 7.4 0 1 1 20 12.6Z", "M12 8.4v3.4M10.3 10.1h3.4"] },
  // Agents: a rounded core with three antennae — a helper, not a microchip.
  agents: { d: ["M12 3.2v2.4", "M6.6 6.9 8.3 8.6", "M17.4 6.9 15.7 8.6", "M8.2 17.6v1.9a1.5 1.5 0 0 0 1.5 1.5h4.6a1.5 1.5 0 0 0 1.5-1.5v-1.9"], circles: [[12, 12.4, 5.2]] },
  // Library: a folder whose tab is a shelf line, so it reads as "kept" rather than "storage".
  library: { d: ["M3.6 7.6a1.6 1.6 0 0 1 1.6-1.6h3.4l1.9 2.2h6.7a1.6 1.6 0 0 1 1.6 1.6v8.6a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6Z", "M7.4 13.6h9.2"] },
  // Settings: a dial, not a cog. Cogs promise machinery; this promises adjustment.
  settings: { d: ["M12 3.6v3.1", "M12 17.3v3.1", "M4.4 12h3.1", "M16.5 12h3.1", "M6.6 6.6 8.8 8.8", "M15.2 15.2l2.2 2.2", "M17.4 6.6 15.2 8.8", "M8.8 15.2l-2.2 2.2"], circles: [[12, 12, 3.4]] },

  /* ---- the vocabulary of the Today screen and the common rows ---- */
  calendar: { d: ["M4.4 8.6h15.2", "M8.2 3.6v3", "M15.8 3.6v3", "M4.4 7.4a1.8 1.8 0 0 1 1.8-1.8h11.6a1.8 1.8 0 0 1 1.8 1.8v11a1.8 1.8 0 0 1-1.8 1.8H6.2a1.8 1.8 0 0 1-1.8-1.8Z", "M8.6 12.4h2M8.6 16h2M13.4 12.4h2"] },
  checkmark: { d: ["M4.6 12.8 9.4 17.6 19.4 6.8"] },
  plus: { d: ["M12 4.8v14.4", "M4.8 12h14.4"] },
  xmark: { d: ["M6.2 6.2 17.8 17.8", "M17.8 6.2 6.2 17.8"] },
  "chevron.right": { d: ["M9.4 5.4 16 12l-6.6 6.6"] },
  "chevron.left": { d: ["M14.6 5.4 8 12l6.6 6.6"] },
  clock: { d: ["M12 7.4V12l3 1.8"], circles: [[12, 12, 8.2]] },
  // A person as a shape, not a portrait — it stands in for someone rather than depicting them.
  person: { d: ["M4.8 20.2c0-3.5 3.2-5.8 7.2-5.8s7.2 2.3 7.2 5.8"], circles: [[12, 8, 4]] },
  "person.2": { d: ["M2.6 19.8c0-3 2.6-5 5.9-5s5.9 2 5.9 5", "M16 15.2c2.9.3 5 2.2 5 4.6"], circles: [[8.5, 8.6, 3.5], [16.6, 9, 2.7]] },
  cart: { d: ["M3.4 4.6h2.2l2.4 10.2h8.9l2.3-7.4H7.1"], circles: [[9.4, 19, 1.4], [16.4, 19, 1.4]] },
  // A leaf on a fork — meals here are planning, not cutlery.
  meals: { d: ["M7 3.8v7.4M9.6 3.8v7.4M8.3 11.2v9", "M16.8 20.2v-6.4c2.2-.6 3.4-2.6 3.4-5.2 0-2.6-1.4-4.8-3.4-4.8s-3.4 2.2-3.4 4.8c0 2.6 1.2 4.6 3.4 5.2Z"] },
  tasks: { d: ["M4.4 7.6 6 9.2l2.8-2.8", "M4.4 16.4 6 18l2.8-2.8", "M12 8h7.6", "M12 16.8h7.6"] },
  // An open hand, the help card's icon. Fingers as one arc: five strokes at 14px is mud.
  hand: { d: ["M8.4 12.4V6.2a1.5 1.5 0 0 1 3 0v5.2", "M11.4 11V4.9a1.5 1.5 0 0 1 3 0v6.3", "M14.4 11.4V6.6a1.5 1.5 0 0 1 3 0v7.6c0 3.6-2.3 6.2-5.6 6.2-3 0-5-1.7-6.2-4.4l-1.4-3a1.4 1.4 0 0 1 2.3-1.5l1.9 2.3"] },
  bell: { d: ["M6.4 10.6a5.6 5.6 0 0 1 11.2 0c0 4 1.6 5.4 1.6 5.4H4.8s1.6-1.4 1.6-5.4Z", "M10.2 19a2 2 0 0 0 3.6 0"] },
  // A spark: the app's "this was the assistant" mark. Four-point, so it never reads as a star
  // rating.
  sparkle: { d: ["M12 3.6c0 4 1.6 5.6 5.6 5.6-4 0-5.6 1.6-5.6 5.6 0-4-1.6-5.6-5.6-5.6 4 0 5.6-1.6 5.6-5.6Z", "M18.4 15.2c0 2 .8 2.8 2.8 2.8-2 0-2.8.8-2.8 2.8 0-2-.8-2.8-2.8-2.8 2 0 2.8-.8 2.8-2.8Z"] },
  paperplane: { d: ["M20.6 3.8 3.6 10.4l6.8 2.9M20.6 3.8l-3 15.8-4.4-5.2M20.6 3.8 10.4 13.3v5.1l2.8-4.6"] },
  pencil: { d: ["M4.2 19.8h3.6L19.3 8.3a1.9 1.9 0 0 0 0-2.7l-.9-.9a1.9 1.9 0 0 0-2.7 0L4.2 16.2Z", "M14.6 6.4l3 3"] },
  trash: { d: ["M4.8 6.8h14.4", "M9.6 6.8V4.9a1.2 1.2 0 0 1 1.2-1.2h2.4a1.2 1.2 0 0 1 1.2 1.2v1.9", "M6.6 6.8l.9 12.1a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l.9-12.1"] },
  lock: { d: ["M7.4 10.4V7.8a4.6 4.6 0 0 1 9.2 0v2.6", "M5.6 11.8a1.4 1.4 0 0 1 1.4-1.4h10a1.4 1.4 0 0 1 1.4 1.4v7a1.4 1.4 0 0 1-1.4 1.4H7a1.4 1.4 0 0 1-1.4-1.4Z"] },
  link: { d: ["M10.2 13.8a3.8 3.8 0 0 0 5.4 0l2.8-2.8a3.8 3.8 0 0 0-5.4-5.4l-1.4 1.4", "M13.8 10.2a3.8 3.8 0 0 0-5.4 0l-2.8 2.8a3.8 3.8 0 0 0 5.4 5.4l1.4-1.4"] },
  // A pin as a teardrop — location, and it survives being 12px in a row.
  pin: { d: ["M12 21c4-4.4 6.2-7.6 6.2-10.6A6.2 6.2 0 0 0 5.8 10.4C5.8 13.4 8 16.6 12 21Z"], circles: [[12, 10.3, 2.3]] },
  folder: { d: ["M3.6 7.6a1.6 1.6 0 0 1 1.6-1.6h3.4l1.9 2.2h6.7a1.6 1.6 0 0 1 1.6 1.6v8.6a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6Z"] },
  paperclip: { d: ["M17.6 11.4 10 19a4.2 4.2 0 0 1-6-6l8.4-8.4a2.8 2.8 0 0 1 4 4l-8.2 8.2a1.4 1.4 0 0 1-2-2l7.6-7.6"] },
  warning: { d: ["M12 4.6 21 19.6H3Z", "M12 10.4v3.8", "M12 16.8v.1"] },
  info: { d: ["M12 11.2v5.2", "M12 8v.1"], circles: [[12, 12, 8.2]] },
};

/** Aliases: the SF Symbol names already used across the app, pointed at our glyphs. */
const ALIAS: Record<string, string> = {
  "house.fill": "home", house: "home", "checkmark.circle": "checkmark", "checkmark.circle.fill": "checkmark",
  "checkmark.shield": "checkmark", "plus.circle": "plus", "plus.circle.fill": "plus",
  "xmark.circle.fill": "xmark", "person.fill": "person", "person.2.fill": "person.2",
  "person.crop.circle": "person", "hand.raised.fill": "hand", "hand.raised": "hand",
  "hand.thumbsup": "hand", "fork.knife": "meals", "cart.fill": "cart",
  sparkles: "sparkle", "wand.and.stars": "sparkle", cpu: "agents", "paperplane.fill": "paperplane",
  "square.and.pencil": "pencil", "mappin.and.ellipse": "pin", mappin: "pin",
  "exclamationmark.triangle": "warning", "exclamationmark.triangle.fill": "warning",
  "info.circle": "info", "lock.fill": "lock", "lock.open": "lock",
  "calendar.badge.plus": "calendar", checklist: "tasks", "gearshape.fill": "settings", gearshape: "settings",
  "bell.fill": "bell", "text.bubble": "ask", "bubble.left": "ask", "folder.fill": "folder",
};

export function resolveGlyph(name: string): string | null {
  if (GLYPHS[name]) return name;
  const a = ALIAS[name];
  return a && GLYPHS[a] ? a : null;
}
export const hasGlyph = (name: string) => resolveGlyph(name) !== null;

/**
 * One FamiliOS icon.
 *
 * Stroke width scales with size so a 14px glyph and a 28px glyph read as the same weight —
 * a fixed stroke makes small icons look bold and large ones look spindly.
 */
export function Glyph({ name, size = 20, color, style }: { name: string; size?: number; color?: string; style?: object }) {
  const { colors } = useTheme();
  const key = resolveGlyph(name);
  const g = key ? GLYPHS[key] : null;
  const tint = color ?? colors.textMuted;
  if (!g) return <View style={[{ width: size, height: size }, style]} />;
  const stroke = Math.max(1.35, size * 0.075);
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {g.d.map((d, i) => (
          <Path key={i} d={d} stroke={tint} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {(g.circles ?? []).map(([cx, cy, r], i) => (
          <Circle key={`c${i}`} cx={cx} cy={cy} r={r} stroke={tint} strokeWidth={stroke} />
        ))}
        {(g.fill ?? []).map((d, i) => (
          <Path key={`f${i}`} d={d} fill={tint} />
        ))}
      </Svg>
    </View>
  );
}

/** Kept for the odd place that wants a plain filled square placeholder. */
export { Rect };
