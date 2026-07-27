// What colour is a thing, and what does it look like?
//
// "If you'll notice these agents — while one is Household, one is Meals, and another is a
//  Briefing category — they actually share the same colour, and they shouldn't. Each category
//  gets its own colour. To accomplish this we're going to need to expand the colour palette
//  across the app… Similarly here you've got Bills & Receipts, it's orange; Subscriptions,
//  it's orange; Medical, it's orange; Caregiving, it's orange… In Playbooks every category is
//  the same colour, and they actually share just this playbook icon, whereas the icon should
//  be more geared towards the title of these categories."
//
// One table, because the same category shows up on four screens under three spellings —
// "Bills" on an agent, "Bills & Receipts" in the Library, "bills-receipts" as a stored tag —
// and a per-screen colour map is how you end up with a green Bills chip filtering a yellow
// Bills card. Everything that needs to know a category's identity asks here.
//
// THE MATCHING IS DELIBERATELY FUZZY. Categories arrive from seeds, from the server, from an
// AI-authored agent, and from a user typing one in. A lookup that only understood exact keys
// would silently fall back to ember for anything new — which is precisely the "everything is
// orange" this exists to end. Normalise, then match on meaningful words, then fall back to a
// STABLE hash so even an unknown category is at least consistently itself.
import type { HearthColors } from "./index";

export interface CategoryLook {
  /** Theme colour name — resolved against the live palette so light/dark both work. */
  tone: keyof HearthColors;
  /** Its soft background pair. */
  toneBg: keyof HearthColors;
  /** An icon that means THIS category, not a generic one. */
  icon: string;
}

/* Ordered: the first entry whose pattern matches wins, so specific beats general. "School
 * supplies" must land on School rather than on Errands, which is why Errands sits lower. */
const CATEGORIES: { test: RegExp; look: CategoryLook }[] = [
  { test: /medic|health|doctor|dental|prescription|pharmac|\bids?\b|insurance/i,
    look: { tone: "rose", toneBg: "roseBg", icon: "heart" } },
  { test: /bill|receipt|invoice|money|budget|expense|payment|utilit|statement|subscription/i,
    look: { tone: "moss", toneBg: "mossBg", icon: "tag" } },
  { test: /meal|food|recipe|dinner|grocer|cook|kitchen|nutrition/i,
    look: { tone: "teal", toneBg: "tealBg", icon: "meals" } },
  { test: /school|homework|class|teacher|student|education|daycare|camp/i,
    look: { tone: "sky", toneBg: "skyBg", icon: "book" } },
  { test: /brief|report|summary|digest|document|paperwork|record|file|renewal/i,
    look: { tone: "indigo", toneBg: "indigoBg", icon: "doc" } },
  { test: /caregiv|elder|grandparent|sitter|childcare|pet|family|event|birthday|celebrat/i,
    look: { tone: "plum", toneBg: "plumBg", icon: "person.2" } },
  { test: /home|maintenance|repair|chore|clean|yard|garden|errand|shopping|store/i,
    look: { tone: "clay", toneBg: "clayBg", icon: "home" } },
  { test: /travel|trip|vacation|flight|hotel|holiday/i,
    look: { tone: "sky", toneBg: "skyBg", icon: "map" } },
  { test: /calendar|schedule|appointment|reminder|time/i,
    look: { tone: "ember", toneBg: "emberBg", icon: "calendar" } },
  { test: /task|todo|to-do|list|checklist/i,
    look: { tone: "lavender", toneBg: "lavenderBg", icon: "tasks" } },
  { test: /safe|secur|privacy|password|emergency/i,
    look: { tone: "coral", toneBg: "coralBg", icon: "shield" } },
  { test: /household|home ?ops|general|everything|assistant/i,
    look: { tone: "ember", toneBg: "emberBg", icon: "sparkle" } },
];

/* The fallback ring. An unrecognised category still gets a colour of its OWN — hashed from its
 * name so it's the same colour every time, on every screen, forever — rather than joining the
 * orange pile this file exists to break up. */
const FALLBACK: CategoryLook[] = [
  { tone: "teal", toneBg: "tealBg", icon: "sparkle" },
  { tone: "indigo", toneBg: "indigoBg", icon: "sparkle" },
  { tone: "plum", toneBg: "plumBg", icon: "sparkle" },
  { tone: "moss", toneBg: "mossBg", icon: "sparkle" },
  { tone: "clay", toneBg: "clayBg", icon: "sparkle" },
  { tone: "sky", toneBg: "skyBg", icon: "sparkle" },
  { tone: "rose", toneBg: "roseBg", icon: "sparkle" },
  { tone: "lavender", toneBg: "lavenderBg", icon: "sparkle" },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The look for a category name, however it happens to be spelled. */
export function categoryLook(name: string | null | undefined): CategoryLook {
  const n = String(name ?? "").trim();
  if (!n) return { tone: "ember", toneBg: "emberBg", icon: "sparkle" };
  for (const c of CATEGORIES) if (c.test.test(n)) return c.look;
  return FALLBACK[hash(n.toLowerCase()) % FALLBACK.length];
}

/** Resolved against the live palette: `{ fg, bg, icon }`, ready to hand to SymTile. */
export function categoryStyle(colors: HearthColors, name: string | null | undefined): { fg: string; bg: string; icon: string } {
  const look = categoryLook(name);
  return { fg: colors[look.tone] as string, bg: colors[look.toneBg] as string, icon: look.icon };
}

/**
 * Title Case for a category or tag.
 *
 * "These tags are titles — they need to be capitalised, both words." Small words stay lower
 * inside a phrase but never at the start, so "Bills & Receipts" and "Family and Events" read
 * as titles rather than as SHOUTING or as sentence fragments.
 */
const SMALL = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on", "or", "the", "to", "with"]);
export function titleCase(s: string | null | undefined): string {
  const raw = String(s ?? "").trim();
  const words = raw.split(/\s+/).filter(Boolean);
  /* A whole string in caps is SHOUTING and gets normalised. A single word in caps inside a
   * normal phrase is an acronym and gets left alone — otherwise "Medical & IDs" quietly
   * becomes "Medical & Ids", which is the kind of wrong that survives review because it looks
   * deliberate. Two different intentions, told apart by whether everything else is shouting too. */
  const shouting = raw === raw.toUpperCase() && /[A-Z]{2,}/.test(raw);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && i < words.length - 1 && SMALL.has(lower)) return lower;
      if (!shouting && /[A-Z]{2,}/.test(w)) return w;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}
