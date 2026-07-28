// Raw colour data, split from theme/index.ts so PURE code (member-colors, node tests) can
// import the palettes without dragging React Native along. index.ts re-exports everything,
// so every existing `from "@/theme"` import is unchanged.
export interface HearthColors {
  bg: string;            // screen background (warm porcelain)
  surface: string;       // cards, sheets
  surfaceSunken: string; // inputs, wells, segmented tracks
  rim: string;           // top highlight rim on cards (legacy)
  border: string;        // 1px card outline
  separator: string;     // hairline row dividers
  text: string;          // primary ink
  textSecondary: string; // 60–62% ink
  textMuted: string;     // tertiary
  textFaint: string;     // disabled
  ember: string;         // accent — primary accent, active tab, links, CTAs
  emberSoft: string;     // pressed / secondary ember
  emberBg: string;       // accentSoft tinted chips / icon tiles
  onEmber: string;       // text on accent
  hero1: string;         // ink-navy hero gradient start
  hero2: string;         // ink-navy hero gradient end
  heroText: string;      // text on hero
  support: string;       // brand secondary (huddle gold)
  tabBg: string;         // tab bar wash (blurred)
  sage: string; sageBg: string;         // success / done
  coral: string; coralBg: string;       // danger / attention
  amber: string; amberBg: string;       // warn / pending
  sky: string; skyBg: string;           // info / synced
  lavender: string; lavenderBg: string; // sensitive (caregiving / private docs)
  /* EXPANDED PALETTE (2026-07-27). "Each category gets its own colour… to accomplish this
   * we're going to need to expand the colour palette across the app."
   *
   * Six accents could not carry fourteen categories, so everything collapsed to ember and the
   * colour stopped meaning anything — every agent orange, every playbook orange, Bills and
   * Medical and Caregiving indistinguishable. Six more hues, chosen to stay legible against
   * both the porcelain and the near-black, and to stay apart from EACH OTHER at a 20pt icon
   * (adjacent hues are the failure mode here, not clashing ones).
   *
   * Semantic accents above keep their meaning — sage is still "done", coral still "danger".
   * These are for identity, not status, which is why they're named as colours rather than as
   * roles: a category owns its hue, and the hue means that category and nothing else. */
  teal: string; tealBg: string;         // meals, food, groceries
  indigo: string; indigoBg: string;     // briefing, documents, records
  rose: string; roseBg: string;         // medical, health
  moss: string; mossBg: string;         // bills, money, subscriptions
  clay: string; clayBg: string;         // home, maintenance, errands
  plum: string; plumBg: string;         // caregiving, family, pets
  tabInactive: string;
  shadow: string;        // boxShadow color component
}

export const lightColors: HearthColors = {
  bg: "#F5F1E9",
  surface: "#FFFFFF",
  surfaceSunken: "#EDE7D9",
  rim: "#FFFFFF",
  border: "rgba(32,28,21,0.07)",
  separator: "rgba(32,28,21,0.08)",
  text: "#201C15",
  textSecondary: "rgba(32,28,21,0.6)",
  textMuted: "rgba(32,28,21,0.45)",
  textFaint: "rgba(32,28,21,0.35)",
  ember: "#CE5D1D",
  emberSoft: "#B14F17",
  emberBg: "rgba(206,93,29,0.11)",
  onEmber: "#FFFFFF",
  hero1: "#232B3E",
  hero2: "#151A26",
  heroText: "#F5F1E9",
  support: "#E8A34E",
  tabBg: "rgba(252,249,243,0.9)",
  sage: "#3F7A4F", sageBg: "rgba(63,122,79,0.13)",
  coral: "#C6482E", coralBg: "rgba(198,72,46,0.12)",
  amber: "#B4791E", amberBg: "rgba(180,121,30,0.13)",
  sky: "#2E6FA3", skyBg: "rgba(46,111,163,0.12)",
  lavender: "#7C5CA8", lavenderBg: "rgba(124,92,168,0.12)",
  teal: "#1F7A72", tealBg: "rgba(31,122,114,0.12)",
  indigo: "#3C4E9E", indigoBg: "rgba(60,78,158,0.12)",
  rose: "#B03A55", roseBg: "rgba(176,58,85,0.12)",
  moss: "#5A7A2E", mossBg: "rgba(90,122,46,0.13)",
  clay: "#9A5A2B", clayBg: "rgba(154,90,43,0.12)",
  plum: "#7A3E7E", plumBg: "rgba(122,62,126,0.12)",
  tabInactive: "rgba(32,28,21,0.45)",
  shadow: "rgba(32,28,21,0.10)",
};

export const darkColors: HearthColors = {
  bg: "#16120C",
  surface: "#211B12",
  surfaceSunken: "#2A2318",
  rim: "#2F281D",
  border: "rgba(243,237,225,0.08)",
  separator: "rgba(243,237,225,0.09)",
  text: "#F3EDE1",
  textSecondary: "rgba(243,237,225,0.62)",
  textMuted: "rgba(243,237,225,0.48)",
  textFaint: "rgba(243,237,225,0.36)",
  ember: "#E9823D",
  emberSoft: "#F09355",
  emberBg: "rgba(233,130,61,0.16)",
  onEmber: "#1A1006",
  hero1: "#2A3147",
  hero2: "#151A28",
  heroText: "#F5F1E9",
  support: "#E8A34E",
  tabBg: "rgba(24,19,12,0.9)",
  sage: "#6FAE7C", sageBg: "rgba(111,174,124,0.16)",
  coral: "#E2694B", coralBg: "rgba(226,105,75,0.16)",
  amber: "#D9A24B", amberBg: "rgba(217,162,75,0.16)",
  sky: "#6FA6D6", skyBg: "rgba(111,166,214,0.16)",
  lavender: "#B096D6", lavenderBg: "rgba(176,150,214,0.18)",
  teal: "#5FBDB2", tealBg: "rgba(95,189,178,0.16)",
  indigo: "#8494E4", indigoBg: "rgba(132,148,228,0.16)",
  rose: "#E0788F", roseBg: "rgba(224,120,143,0.16)",
  moss: "#9FC168", mossBg: "rgba(159,193,104,0.16)",
  clay: "#D18E5A", clayBg: "rgba(209,142,90,0.16)",
  plum: "#C083C4", plumBg: "rgba(192,131,196,0.18)",
  tabInactive: "rgba(243,237,225,0.36)",
  shadow: "rgba(0,0,0,0.35)",
};
