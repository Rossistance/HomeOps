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
//   One stroke weight, scaled with the icon (11% of the box — roughly SF Symbols' semibold),
//   round caps and round joins. Soft UI is pillowed; a mitred corner fights that everywhere.
//   The first pass ran at 7.5%, which is a documentation weight: correct for a dense settings
//   list, far too polite for a glyph meant to be the loudest thing in its well. Reported as
//   "not very bold or striking".
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
// SCOPE. Asked directly — "did you redesign every icon in the app?" — the first answer was no:
// about thirty glyphs covering the tab bar and Today, with everything else falling through to
// SF Symbols. It is yes now. Every icon name the app actually renders (120 of them, across 78
// drawn glyphs plus aliases pointing the SF names at them) is custom.
//
// The fallthrough to SF Symbols stays anyway, because a name that gets added tomorrow should
// render something rather than nothing. `hasGlyph` says which is which, and the coverage check
// is a one-liner: grep the icon names in use and diff them against GLYPHS + ALIAS.
import { View } from "react-native";
import Svg, { Circle, Path, Rect } from "react-native-svg";
import { useTheme } from "@/theme";

/** Path data on a 24×24 grid. Stroked, not filled, unless the name ends in `.fill`. */
const GLYPHS: Record<string, { d?: string[]; fill?: string[]; circles?: [number, number, number][] }> = {
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

  /* ---- second pass: "did you redesign every icon?" No — so here are the rest of the ones
     that actually appear often enough to be noticed. Same rules, drawn against the first set. */
  share: { d: ["M12 15.4V3.8", "M8 7.4 12 3.4l4 4", "M5.4 13v6.2a1.4 1.4 0 0 0 1.4 1.4h10.4a1.4 1.4 0 0 0 1.4-1.4V13"] },
  // Leaving: a door with an arrow going out of it. Reads at 13px, which "rectangle.portrait
  // .and.arrow.right" never did.
  leave: { d: ["M13.4 3.8H6.4A1.6 1.6 0 0 0 4.8 5.4v13.2a1.6 1.6 0 0 0 1.6 1.6h7", "M15.6 8.2 19.4 12l-3.8 3.8", "M19 12h-8.6"] },
  hourglass: { d: ["M6.8 3.8h10.4", "M6.8 20.2h10.4", "M7.6 3.8v3.1c0 1.8 1.5 3.3 3.3 4.2v1.8c-1.8.9-3.3 2.4-3.3 4.2v3.1", "M16.4 3.8v3.1c0 1.8-1.5 3.3-3.3 4.2v1.8c1.8.9 3.3 2.4 3.3 4.2v3.1"] },
  "arrow.up.right": { d: ["M6.6 17.4 17.4 6.6", "M8.8 6.6h8.6v8.6"] },
  refresh: { d: ["M19.6 12a7.6 7.6 0 1 1-2.4-5.5", "M19.6 4.4v4.4h-4.4"] },
  search: { d: ["M16.4 16.4 20.4 20.4"], circles: [[10.8, 10.8, 6.6]] },
  more: { circles: [[5.4, 12, 1.3], [12, 12, 1.3], [18.6, 12, 1.3]] },
  envelope: { d: ["M3.8 7.4a1.6 1.6 0 0 1 1.6-1.6h13.2a1.6 1.6 0 0 1 1.6 1.6v9.2a1.6 1.6 0 0 1-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6Z", "M4.4 7.2 12 12.6l7.6-5.4"] },
  photo: { d: ["M3.8 6.6a1.6 1.6 0 0 1 1.6-1.6h13.2a1.6 1.6 0 0 1 1.6 1.6v10.8a1.6 1.6 0 0 1-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6Z", "M4.2 16.6 9.2 11.4l4.2 4 2.6-2.4 3.8 3.4"], circles: [[8.6, 9, 1.5]] },
  doc: { d: ["M13.4 3.8H7a1.6 1.6 0 0 0-1.6 1.6v13.2A1.6 1.6 0 0 0 7 20.2h10a1.6 1.6 0 0 0 1.6-1.6V9Z", "M13.4 3.8V9h5.2", "M8.6 13.4h6.8M8.6 16.6h4.6"] },
  tag: { d: ["M3.8 10.6V5.4a1.6 1.6 0 0 1 1.6-1.6h5.2l9 9a1.6 1.6 0 0 1 0 2.3l-4.7 4.7a1.6 1.6 0 0 1-2.3 0Z"], circles: [[8, 8, 1.4]] },
  ticket: { d: ["M3.8 8.6V6.8a1.4 1.4 0 0 1 1.4-1.4h13.6a1.4 1.4 0 0 1 1.4 1.4v1.8a3.4 3.4 0 0 0 0 6.8v1.8a1.4 1.4 0 0 1-1.4 1.4H5.2a1.4 1.4 0 0 1-1.4-1.4v-1.8a3.4 3.4 0 0 0 0-6.8Z", "M13.4 8.4v7.2"] },
  sliders: { d: ["M4.4 7.6h4.2M13 7.6h6.6", "M4.4 16.4h6.6M15.4 16.4h4.2"], circles: [[10.8, 7.6, 2.2], [13.2, 16.4, 2.2]] },
  shield: { d: ["M12 3.6 5.2 6.2v5.4c0 4 2.8 7.4 6.8 8.8 4-1.4 6.8-4.8 6.8-8.8V6.2Z", "M9.2 11.8 11.4 14l3.6-3.8"] },
  chart: { d: ["M4.6 19.4V4.6", "M4.6 19.4h14.8", "M8.4 16.4v-4.2M12.4 16.4V7.8M16.4 16.4v-6.4"] },
  car: { d: ["M4.4 15.6V11l1.9-4.4a1.5 1.5 0 0 1 1.4-.9h8.6a1.5 1.5 0 0 1 1.4.9L19.6 11v4.6", "M4.4 11.2h15.2", "M5.6 15.6h12.8v2.2a1 1 0 0 1-1 1h-1.4a1 1 0 0 1-1-1v-.8H9v.8a1 1 0 0 1-1 1H6.6a1 1 0 0 1-1-1Z"] },
  bag: { d: ["M5.4 7.8h13.2l-1 11.2a1.5 1.5 0 0 1-1.5 1.4H7.9a1.5 1.5 0 0 1-1.5-1.4Z", "M8.8 10V7a3.2 3.2 0 0 1 6.4 0v3"] },
  bolt: { d: ["M13.4 3.4 5.8 13.4h5.2l-.4 7.2 7.6-10h-5.2Z"] },
  gift: { d: ["M4.2 11.4h15.6v2.2H4.2Z", "M5.6 13.6v5.2a1.4 1.4 0 0 0 1.4 1.4h10a1.4 1.4 0 0 0 1.4-1.4v-5.2", "M12 11.4v9", "M12 11.4S9.8 8.2 8 8.2a2.1 2.1 0 1 1 0-4.2c2.4 0 4 7.4 4 7.4Z", "M12 11.4S14.2 8.2 16 8.2a2.1 2.1 0 1 0 0-4.2c-2.4 0-4 7.4-4 7.4Z"] },
  heart: { d: ["M12 20c-.6 0-8.2-4.6-8.2-9.8A4.6 4.6 0 0 1 12 7.4a4.6 4.6 0 0 1 8.2 2.8C20.2 15.4 12.6 20 12 20Z"] },
  star: { d: ["M12 3.8 14.5 9l5.7.8-4.1 4 1 5.7L12 16.8l-5.1 2.7 1-5.7-4.1-4L9.5 9Z"] },
  eye: { d: ["M2.8 12S6.4 6 12 6s9.2 6 9.2 6-3.6 6-9.2 6-9.2-6-9.2-6Z"], circles: [[12, 12, 2.9]] },
  play: { d: ["M8.4 5.4 18.6 12 8.4 18.6Z"] },
  pause: { d: ["M9.2 5.6v12.8M14.8 5.6v12.8"] },
  minus: { d: ["M4.8 12h14.4"] },
  question: { d: ["M9.4 9.4a2.7 2.7 0 1 1 3.4 2.6c-.6.2-.8.7-.8 1.3v.9", "M12 17.4v.1"], circles: [[12, 12, 8.2]] },
  wifi: { d: ["M2.8 9.4a13 13 0 0 1 18.4 0", "M6.2 12.9a8.2 8.2 0 0 1 11.6 0", "M9.6 16.4a3.4 3.4 0 0 1 4.8 0", "M12 19.6v.1"] },
  pulse: { d: ["M3 12.4h3.6l2.2-5.6 3.6 10.4 2.4-6.2 1.6 3h4.6"] },

  /* ---- third pass: the tail. Drawn because they were still showing up. ---- */
  "chevron.down": { d: ["M5.4 9.4 12 16l6.6-6.6"] },
  "chevron.up": { d: ["M5.4 14.6 12 8l6.6 6.6"] },
  "arrow.right": { d: ["M4.4 12h15.2", "M14 6.4 19.6 12 14 17.6"] },
  "arrow.up": { d: ["M12 19.6V4.4", "M6.4 10 12 4.4 17.6 10"] },
  "arrow.down": { d: ["M12 4.4v15.2", "M6.4 14 12 19.6 17.6 14"] },
  circle: { circles: [[12, 12, 8.2]] },
  book: { d: ["M4.4 5.4a1.6 1.6 0 0 1 1.6-1.6h4.2A2.4 2.4 0 0 1 12 6.2v13a2 2 0 0 0-2-1.6H4.4Z", "M19.6 5.4A1.6 1.6 0 0 0 18 3.8h-4.2A2.4 2.4 0 0 0 12 6.2v13a2 2 0 0 1 2-1.6h5.6Z"] },
  camera: { d: ["M3.8 8.8a1.6 1.6 0 0 1 1.6-1.6h2.3l1.4-2.2h5.8l1.4 2.2h2.3a1.6 1.6 0 0 1 1.6 1.6v8.6a1.6 1.6 0 0 1-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6Z"], circles: [[12, 12.8, 3.5]] },
  globe: { d: ["M3.8 12h16.4", "M12 3.8c2.2 2.4 3.4 5.2 3.4 8.2S14.2 17.8 12 20.2c-2.2-2.4-3.4-5.2-3.4-8.2S9.8 6.2 12 3.8Z"], circles: [[12, 12, 8.2]] },
  list: { d: ["M8.4 6.6h11.2M8.4 12h11.2M8.4 17.4h11.2", "M4.6 6.6v.1M4.6 12v.1M4.6 17.4v.1"] },
  grid: { d: ["M4.4 5.8a1.4 1.4 0 0 1 1.4-1.4h2.8a1.4 1.4 0 0 1 1.4 1.4v2.8A1.4 1.4 0 0 1 8.6 10H5.8a1.4 1.4 0 0 1-1.4-1.4Z", "M14 5.8a1.4 1.4 0 0 1 1.4-1.4h2.8a1.4 1.4 0 0 1 1.4 1.4v2.8A1.4 1.4 0 0 1 18.2 10h-2.8A1.4 1.4 0 0 1 14 8.6Z", "M4.4 15.4A1.4 1.4 0 0 1 5.8 14h2.8a1.4 1.4 0 0 1 1.4 1.4v2.8a1.4 1.4 0 0 1-1.4 1.4H5.8a1.4 1.4 0 0 1-1.4-1.4Z", "M14 15.4a1.4 1.4 0 0 1 1.4-1.4h2.8a1.4 1.4 0 0 1 1.4 1.4v2.8a1.4 1.4 0 0 1-1.4 1.4h-2.8a1.4 1.4 0 0 1-1.4-1.4Z"] },
  tray: { d: ["M3.8 14.2h4.4a1 1 0 0 1 .9.6l.5 1a1 1 0 0 0 .9.6h3a1 1 0 0 0 .9-.6l.5-1a1 1 0 0 1 .9-.6h4.4", "M6.4 4.6h11.2l2.6 9.6v3.6a1.6 1.6 0 0 1-1.6 1.6H5.4a1.6 1.6 0 0 1-1.6-1.6v-3.6Z"] },
  map: { d: ["M3.8 6.6 9 4.4v13l-5.2 2.2Z", "M9 4.4l6 2.2v13l-6-2.2Z", "M15 6.6l5.2-2.2v13L15 19.6Z"] },
  // A seal: the "verified" mark. A scalloped ring would turn to fuzz at 14px, so it's a ring.
  seal: { d: ["M8.6 12.2 11 14.6l4.4-4.6"], circles: [[12, 12, 8.2]] },
  // Tools: one wrench, angled. A crossed pair is two shapes fighting inside 24px.
  tools: { d: ["M15.4 3.9a5 5 0 0 0-5.9 6.6L4 16a2.1 2.1 0 1 0 3 3l5.5-5.5a5 5 0 0 0 6.6-5.9l-3 3-2.7-2.7Z"] },
  idea: { d: ["M9.4 18.4h5.2", "M10 21h4", "M12 3.6a5.8 5.8 0 0 0-3.3 10.6c.5.4.8 1 .8 1.6v.6h5v-.6c0-.6.3-1.2.8-1.6A5.8 5.8 0 0 0 12 3.6Z"] },
  sun: { d: ["M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2", "M6.2 6.2 7.8 7.8M16.2 16.2l1.6 1.6M17.8 6.2l-1.6 1.6M7.8 16.2l-1.6 1.6"], circles: [[12, 12, 4]] },
  "person.3": { d: ["M2.2 19.6c0-2.5 2-4.2 4.6-4.2", "M9 19.8c0-2.8 2.4-4.6 5.4-4.6s5.4 1.8 5.4 4.6", "M21.8 19.6c0-2.5-2-4.2-4.6-4.2"], circles: [[14.4, 9.4, 3.4], [6.4, 10.6, 2.5], [17.6, 10.6, 2.5]] },
  paw: { d: ["M12 13.4c2.6 0 4.6 1.8 4.6 3.9 0 1.6-1.2 2.7-2.8 2.7-.7 0-1.2-.3-1.8-.3s-1.1.3-1.8.3c-1.6 0-2.8-1.1-2.8-2.7 0-2.1 2-3.9 4.6-3.9Z"], circles: [[7.4, 10.4, 1.9], [16.6, 10.4, 1.9], [10, 6.2, 1.7], [14, 6.2, 1.7]] },
  broadcast: { d: ["M6.6 6.6a7.6 7.6 0 0 0 0 10.8M17.4 6.6a7.6 7.6 0 0 1 0 10.8", "M9.4 9.4a3.7 3.7 0 0 0 0 5.2M14.6 9.4a3.7 3.7 0 0 1 0 5.2"], circles: [[12, 12, 1.5]] },
};

/** Aliases: the SF Symbol names already used across the app, pointed at our glyphs. */
const ALIAS: Record<string, string> = {
  "house.fill": "home", house: "home", "checkmark.circle": "checkmark", "checkmark.circle.fill": "checkmark",
  "checkmark.shield": "shield", "plus.circle": "plus", "plus.circle.fill": "plus",
  "xmark.circle.fill": "xmark", "person.fill": "person", "person.2.fill": "person.2",
  "person.crop.circle": "person", "hand.raised.fill": "hand", "hand.raised": "hand",
  "hand.thumbsup": "hand", "fork.knife": "meals", "cart.fill": "cart",
  sparkles: "sparkle", "wand.and.stars": "sparkle", cpu: "agents", "paperplane.fill": "paperplane",
  "square.and.pencil": "pencil", "mappin.and.ellipse": "pin", mappin: "pin",
  "exclamationmark.triangle": "warning", "exclamationmark.triangle.fill": "warning",
  "info.circle": "info", "lock.fill": "lock", "lock.open": "lock",
  "calendar.badge.plus": "calendar", checklist: "tasks", "gearshape.fill": "settings", gearshape: "settings",
  "bell.fill": "bell", "text.bubble": "ask", "bubble.left": "ask", "folder.fill": "folder",
  "square.and.arrow.up": "share", "square.and.arrow.down": "share",
  "rectangle.portrait.and.arrow.right": "leave", "arrow.right.square": "leave",
  "arrow.clockwise": "refresh", "arrow.triangle.2.circlepath": "refresh",
  magnifyingglass: "search", ellipsis: "more", "ellipsis.circle": "more",
  "envelope.fill": "envelope", mail: "envelope",
  "photo.fill": "photo", "doc.fill": "doc", "doc.text": "doc", "tag.fill": "tag",
  "slider.horizontal.3": "sliders", "gearshape.2": "sliders",
  "checkmark.shield.fill": "shield", "chart.bar": "chart", "chart.line.uptrend.xyaxis": "chart",
  "car.fill": "car", "bag.fill": "bag", "bolt.fill": "bolt", "gift.fill": "gift",
  "heart.fill": "heart", "star.fill": "star", "eye.fill": "eye",
  "play.fill": "play", "play.circle.fill": "play", "pause.fill": "pause", "pause.circle.fill": "pause",
  "questionmark.circle": "question", "questionmark.circle.fill": "question",
  "wifi.exclamationmark": "wifi", "waveform.path.ecg": "pulse",
  "person.badge.clock": "person", "person.crop.circle.badge.plus": "person",
  "calendar.badge.clock": "calendar", "cart.badge.plus": "cart",
  "calendar.badge.checkmark": "calendar", "calendar.badge.exclamationmark": "calendar",
  "calendar.badge.plus.fill": "calendar",
  "arrow.up.circle": "arrow.up", "arrow.down.circle": "arrow.down",
  "arrow.up.forward.app": "arrow.up.right", "arrow.right.circle": "arrow.right",
  "forward.circle.fill": "arrow.right", "chevron.up.chevron.down": "chevron.down",
  "books.vertical": "book", "graduationcap": "book",
  "checkmark.seal": "seal", "checkmark.seal.fill": "seal",
  "exclamationmark.circle.fill": "warning", "minus.circle.fill": "minus",
  "clock.arrow.circlepath": "refresh", "clock.badge.exclamationmark.fill": "clock",
  "bolt.badge.clock": "bolt", "bolt.slash": "bolt",
  "envelope.badge.exclamationmark": "envelope", "app.badge": "bell", "bell.badge": "bell",
  "bubble.left.and.bubble.right": "ask", brain: "agents",
  "puzzlepiece.extension": "grid", "circle.grid.2x2": "grid", "square.grid.2x2": "grid",
  "list.bullet": "list", checklist2: "list",
  "tray.full": "tray", "location.fill": "pin", safari: "globe",
  hammer: "tools", "hammer.fill": "tools", "wrench.and.screwdriver": "tools",
  "lightbulb.fill": "idea", lightbulb: "idea",
  "sun.max": "sun", sunrise: "sun", "circle.lefthalf.filled": "circle",
  "eye.slash": "eye", "play.circle": "play", "hand.tap": "hand",
  pawprint: "paw", "antenna.radiowaves.left.and.right": "broadcast",
  number: "tag",
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
  /* Reported: "not very bold or striking." The first pass used 7.5% of the box with a 1.35
   * floor, which is a documentation-icon weight — correct for a dense settings list, far too
   * polite for a glyph that's meant to be the loudest thing in its well. 11% with a 1.9 floor
   * is roughly SF Symbols' `semibold`, and it holds up at 14px where a hairline dissolves. */
  const stroke = Math.max(1.9, size * 0.11);
  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {(g.d ?? []).map((d, i) => (
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
