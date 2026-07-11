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

const FALLBACK_ACCENTS = ["ember", "sage", "sky", "lavender", "amber", "ink"];

export function memberColor(colors: HearthColors, m: MemberRec | null | undefined): string | null {
  if (!m) return null;
  if (m.color) return memberAccent(colors, m.color);
  const i = [...m.displayName].reduce((a, c) => a + c.charCodeAt(0), 0) % FALLBACK_ACCENTS.length;
  return memberAccent(colors, FALLBACK_ACCENTS[i]);
}
