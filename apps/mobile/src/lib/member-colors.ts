// Per-member calendar colors, shared by the Today card and the Calendar screen.
// A member's server-set accent (or hex) wins; otherwise a deterministic accent is
// hashed from the display name — the SAME fallback the web app uses, so a member
// is the same color on iOS and web even before anyone picks one.
import type { MemberRec } from "@/lib/api";
import type { HearthColors } from "@/theme/colors-data";

export function memberAccent(colors: HearthColors, name?: string | null): string | null {
  if (!name) return null;
  if (name.startsWith("#")) return name;
  switch (name) {
    case "sage": return colors.sage;
    case "coral": return colors.coral;
    case "amber": return colors.amber;
    case "sky": return colors.sky;
    case "lavender": return colors.lavender;
    case "ember": return colors.ember;
    case "ink": return colors.textSecondary;
    /* BUG-01 — "the color options it gives me are all similar orange colors."
     *
     * These six were added to the theme and to the profile picker during the neumorphic
     * work — and never taught to this resolver. Each fell through to `default: null`, and
     * null renders as the ember fallback, so twelve swatches produced six oranges. The
     * regression test in member-colors.test.mjs walks the whole ACCENTS list against this
     * switch, so a thirteenth hue can never repeat the trick. */
    case "teal": return colors.teal;
    case "indigo": return colors.indigo;
    case "rose": return colors.rose;
    case "moss": return colors.moss;
    case "clay": return colors.clay;
    case "plum": return colors.plum;
    default: return null;
  }
}

/* THE list. Three screens each carried their own (12, 6, and a different 6) — which is how
 * the Settings editor could hand out colours the profile picker had reserved. One source. */
export const ACCENTS = ["ink", "sage", "coral", "amber", "sky", "lavender", "teal", "indigo", "rose", "moss", "clay", "plum"] as const;

/** Perceptual-enough distance between two resolved colours (0..~765, rgb manhattan).
 *  "If it's taken — or within two deviations — block it." The threshold below is tuned so
 *  the pairs he named (GPop's amber vs Beannie's coral) collide, and genuinely different
 *  hues don't. */
export function colorDistance(a: string, b: string): number {
  const rgb = (c: string): [number, number, number] | null => {
    const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(c);
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split("").map((x) => x + x).join("");
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return a === b ? 0 : Infinity; // non-hex: only exact match collides
  return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]);
}
export const TOO_CLOSE = 90;

/** Who holds a colour that would clash with `candidate` — or null if it's free.
 *
 * EXPLICIT choices only. A member who never picked renders from a hash of their id, and
 * reserving hashed colours would lock most of the palette on day one for people who never
 * chose anything — the hash moves out of the way the moment anyone claims its colour. */
export function heldBy(colors: HearthColors, candidate: string, others: MemberRec[]): MemberRec | null {
  const mine = memberAccent(colors, candidate) ?? candidate;
  for (const m of others) {
    if (!m.color) continue;
    const theirs = memberAccent(colors, m.color) ?? m.color;
    if (colorDistance(mine, theirs) < TOO_CLOSE) return m;
  }
  return null;
}

/** Apply an alpha to a #rgb/#rrggbb color (theme accents are hex). Non-hex
 * colors pass through unchanged. */
export function fade(color: string, alpha: number): string {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(color);
  if (!m) return color;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const FALLBACK_ACCENTS = ["ember", "sage", "sky", "lavender", "amber", "ink"];

/* L2 [04:37] — "The M is green, the R is like a bluish colour. Those don't match the colours
 * that are on the profile pictures… that colour for each person needs to exist throughout the
 * app, and when it's updated one place it needs to automatically carry over to every other
 * place inside the app."
 *
 * The cause wasn't a wrong palette, it was a SECOND one. Tasks carried its own AVATAR_TONES
 * list indexed by the member's POSITION IN THE ARRAY — so a person's colour was a function of
 * list order rather than of who they are. It disagreed with the avatar sitting next to it, and
 * it changed when the roster changed.
 *
 * Everything now resolves here. The identity fallback is hashed from the ACTOR ID, not the
 * display name: renaming yourself shouldn't change your colour, and two people who happen to
 * share a first name shouldn't collide. A member with a chosen colour always wins, which is
 * what makes "update it once" carry everywhere — there is nowhere else for it to be decided.
 */
export function memberColor(colors: HearthColors, m: MemberRec | null | undefined): string | null {
  if (!m) return null;
  if (m.color) return memberAccent(colors, m.color);
  const key = m.actorId || m.displayName || "";
  const i = [...key].reduce((a, c) => a + c.charCodeAt(0), 0) % FALLBACK_ACCENTS.length;
  return memberAccent(colors, FALLBACK_ACCENTS[i]);
}

/** The same colour as a fg/bg pair, for avatar tiles and chips. One resolution, two shapes —
 *  so a tile and the name beside it can never disagree. */
export function memberTone(colors: HearthColors, m: MemberRec | null | undefined): { fg: string; bg: string } {
  const fg = memberColor(colors, m) ?? colors.textMuted;
  return { fg, bg: fade(fg, 0.16) };
}
