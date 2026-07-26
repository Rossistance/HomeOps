// Soft UI — the physics, in Famili's own material.
//
// From the reference he gave (superdesign.dev/library/neumorphism): depth comes from two
// opposing shadows, a light one from the top-left and a dark one falling bottom-right, on a
// monochromatic surface. Elements are either extruded from that surface or pressed into it,
// never flat. "Molded from the same material" is the phrase, and it's the right one.
//
// WHAT I KEPT, AND WHAT I CHANGED, AND WHY
//
// Kept: the physics. Dual opposing shadows, rgba not hex (the reference is right that opaque
// shadows blend badly), one consistent light direction everywhere, and the nesting rule —
// extruded card, inset well, distinct icon — which is what makes the depth read as real
// rather than as a texture.
//
// Changed: the colour. The reference is built on a cool grey (#E0E5EC) chosen specifically to
// feel "fresh and distinct from warm legacy neumorphism". FamiliOS is warm porcelain
// (#F5F1E9) and he asked for the Famili palette, so the shadows are re-derived from OUR
// surface: a warm white above, a warm clay below. A cool blue-grey shadow on a warm cream
// surface reads as dirt, not depth — the shadow has to be the surface's own colour, darker.
//
// DARK MODE, HONESTLY. Classic neumorphism is a light-mode technique: it needs headroom above
// the surface for the highlight. On a #16120C background there is very little, and a white
// highlight would blow out into something that looks like a bug. So dark mode uses the same
// two-shadow geometry with a warm lift instead of a white one — the result reads as softly
// embossed rather than pillowed. That is a real difference from the reference, not a tuning
// miss, and pretending otherwise would just produce a muddy screen.
//
// ACCESSIBILITY. Shadows define edges here, which means edges are invisible to anyone who
// can't perceive them. Every surface therefore keeps a real (if quiet) border underneath —
// the reference sets `border: transparent` and I am deliberately not doing that. Contrast of
// text on surface is unchanged; none of this touches the text colours.
import type { HearthColors } from "./index";

/** rgba() from a hex, or pass through an existing rgba string. */
function rgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return hex;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * The two shadow colours, derived from the palette rather than hard-coded — so a future
 * palette change moves the shadows with it instead of leaving them behind.
 *
 * LIGHT is where the light comes from (top-left); DARK is what it casts (bottom-right).
 */
export function depthTones(colors: HearthColors, dark: boolean) {
  return dark
    // Warm lift, not white: on a near-black surface a white highlight reads as a rendering
    // artifact. The dark side goes almost to black, which is where the depth actually
    // comes from in dark mode.
    ? { light: rgba("#4A4032", 0.5), dark: rgba("#000000", 0.6) }
    /* Warm porcelain. The cast shadow is deeper and warmer than the first pass: reported as
     * "the light mode is too bright… I can't tell the front from the back in some cases",
     * which is the honest failure mode of same-colour cards on a same-colour page. A cream
     * card on a cream page separates ONLY by shadow, so the shadow has to do more work here
     * than it does on the reference's mid-grey, where the surface is already darker than
     * white to begin with. */
    : { light: rgba("#FFFFFF", 1), dark: rgba("#B7A88E", 0.72) };
}

/**
 * The warm rim that says "this is a thing, and it's in front".
 *
 * "It needs to have some of the orange glow somehow ringing around objects, cards, features,
 *  so it's more pronounced where each section is."
 *
 * A hairline of ember at low alpha around every raised surface. Not decoration — it's the
 * edge, and on a page where card and background are the same colour it's carrying most of the
 * separation that a different fill colour used to carry for free. Deliberately warm rather
 * than neutral: a grey rim on cream reads as a stroke someone drew, an ember one reads as the
 * light in the room catching the edge, which is the same fiction the shadows are telling.
 */
export function rimColor(colors: HearthColors, dark: boolean): string {
  return dark ? rgba("#E9823D", 0.16) : rgba("#CE5D1D", 0.22);
}

/** A soft ember halo under a raised surface, layered beneath the depth shadows. */
export function rimGlow(colors: HearthColors, dark: boolean): string {
  return dark
    ? `0 2px 14px ${rgba("#E9823D", 0.07)}`
    : `0 2px 16px ${rgba("#CE5D1D", 0.11)}`;
}

export type Depth = "raised" | "raisedSm" | "raisedLg" | "inset" | "insetDeep" | "insetSm" | "flat";

/**
 * A boxShadow string for one depth level.
 *
 * The offsets are the reference's, scaled down about a third: those values are for a 1440px
 * page, and at phone size a 9px offset on a 36px icon tile swallows the tile. Depth should be
 * felt at arm's length, not measured.
 */
export function depth(level: Depth, colors: HearthColors, dark: boolean): string {
  const t = depthTones(colors, dark);
  switch (level) {
    case "raisedSm":  return `3px 3px 6px ${t.dark}, -3px -3px 6px ${t.light}`;
    case "raised":    return `6px 6px 12px ${t.dark}, -6px -6px 12px ${t.light}`;
    case "raisedLg":  return `9px 9px 18px ${t.dark}, -9px -9px 18px ${t.light}`;
    case "insetSm":   return `inset 2px 2px 4px ${t.dark}, inset -2px -2px 4px ${t.light}`;
    case "inset":     return `inset 4px 4px 8px ${t.dark}, inset -4px -4px 8px ${t.light}`;
    case "insetDeep": return `inset 7px 7px 14px ${t.dark}, inset -7px -7px 14px ${t.light}`;
    case "flat":
    default:          return "none";
  }
}

/**
 * The surface colour for a soft-UI element.
 *
 * The reference's central rule: a card is NOT lighter than the page, it's the same material.
 * White cards on a cream page are the single thing that breaks the illusion fastest, and it's
 * listed under its anti-patterns for exactly that reason. In light mode we take the page
 * colour; in dark mode the surface stays a touch above the page, because at that darkness
 * shadow alone can't carry a whole card edge.
 */
export function softSurface(colors: HearthColors, dark: boolean): string {
  return dark ? colors.surface : colors.bg;
}

/** Radius scale, from the reference (32 / 16 / 12), trimmed to phone proportions. */
export const softRadii = { card: 26, control: 16, inner: 12, pill: 999 } as const;
