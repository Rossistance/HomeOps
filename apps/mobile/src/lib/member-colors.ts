// Per-member calendar colors, shared by the Today card and the Calendar screen.
// A member's server-set accent (or hex) wins; otherwise a deterministic accent is
// hashed from the display name — the SAME fallback the web app uses, so a member
// is the same color on iOS and web even before anyone picks one.
import type { MemberRec } from "@/lib/api";
import type { HearthColors } from "@/theme";

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
    default: return null;
  }
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

export function memberColor(colors: HearthColors, m: MemberRec | null | undefined): string | null {
  if (!m) return null;
  if (m.color) return memberAccent(colors, m.color);
  const i = [...m.displayName].reduce((a, c) => a + c.charCodeAt(0), 0) % FALLBACK_ACCENTS.length;
  return memberAccent(colors, FALLBACK_ACCENTS[i]);
}
