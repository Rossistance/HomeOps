// Hearth (FamiliOS handoff) — design tokens for the iOS client.
// Light mode is warm porcelain with an ember accent and an ink-navy hero;
// dark mode is the same hearth at night. Every screen consumes these through
// useTheme(); no hardcoded colors in screens.
import { createContext, useContext } from "react";
import { Platform, useColorScheme } from "react-native";
import { Easing } from "react-native-reanimated";
import { useReducedMotion } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

// Appearance preference (Settings switch). "system" follows the OS.
export type ThemePref = "system" | "light" | "dark";
export const ThemePrefContext = createContext<{ pref: ThemePref; setPref: (p: ThemePref) => void }>({
  pref: "system",
  setPref: () => {},
});
export function useThemePref() { return useContext(ThemePrefContext); }

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

// Handoff spacing: screen gutter 20, row padding 13×16, card gaps 8–10, section gap 22.
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 22 } as const;
// Handoff radii: cards 22, rows/inner 16, buttons 15, sheet top 28, icon tiles 11–13.
export const radii = { tile: 12, sm: 11, row: 16, md: 16, btn: 15, lg: 22, xl: 28, pill: 999 } as const;

// Newsreader carries the display voice (screen titles, hero lines, agent names);
// the system font (SF Pro on iOS) carries body/UI per the handoff. Never set body
// copy in the serif. Inter stays loaded for legacy (pre-redesign) screens only.
export const fonts = {
  display: "Newsreader_600SemiBold",
  displayBold: "Newsreader_600SemiBold",
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

// System (SF Pro) body styles for redesigned screens: omit fontFamily, use weights.
const sys = Platform.select({ ios: undefined, default: undefined });

export const type = {
  // Screen titles 30px serif, tight tracking.
  h1: { fontFamily: fonts.display, fontSize: 30, lineHeight: 36, letterSpacing: -0.4 },
  // Sheet headlines 22px serif.
  h2: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  // Agent / detail names 21px serif.
  h2Serif: { fontFamily: fonts.display, fontSize: 21, lineHeight: 26, letterSpacing: -0.3 },
  // Hero lines 19–25px serif.
  hero: { fontFamily: fonts.display, fontSize: 21, lineHeight: 27, letterSpacing: -0.3 },
  h3: { fontFamily: sys, fontSize: 17, lineHeight: 22, fontWeight: "600" as const },
  // Row titles 15–15.5px / 600.
  rowTitle: { fontFamily: sys, fontSize: 15, lineHeight: 20, fontWeight: "600" as const },
  body: { fontFamily: sys, fontSize: 15, lineHeight: 22, fontWeight: "400" as const },
  bodyMedium: { fontFamily: sys, fontSize: 15, lineHeight: 22, fontWeight: "500" as const },
  sub: { fontFamily: sys, fontSize: 13, lineHeight: 19, fontWeight: "400" as const },
  subMedium: { fontFamily: sys, fontSize: 13, lineHeight: 19, fontWeight: "500" as const },
  // Row secondary 12–12.5px.
  detail: { fontFamily: sys, fontSize: 12.5, lineHeight: 17, fontWeight: "400" as const },
  caption: { fontFamily: sys, fontSize: 12, lineHeight: 16, fontWeight: "600" as const },
  // Section labels 12.5/700 uppercase +0.6 tracking (apply 72% opacity via color).
  eyebrow: { fontFamily: sys, fontSize: 12.5, lineHeight: 16, fontWeight: "700" as const, letterSpacing: 0.6, textTransform: "uppercase" as const },
  tab: { fontFamily: sys, fontSize: 10, lineHeight: 12, fontWeight: "600" as const },
} as const;

// Handoff motion: this easing everywhere; screen enter fade + 10px rise 0.32s;
// sheets translateY spring 0.38s; press compress 0.96–0.98.
export const motion = {
  easing: Easing.bezier(0.22, 1, 0.36, 1),
  enterMs: 320,
  sheetMs: 380,
  pressScale: 0.97,
} as const;

export interface Theme {
  dark: boolean;
  colors: HearthColors;
  spacing: typeof spacing;
  radii: typeof radii;
  type: typeof type;
  fonts: typeof fonts;
  motion: typeof motion;
}

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const { pref } = useThemePref();
  const dark = pref === "system" ? scheme === "dark" : pref === "dark";
  return { dark, colors: dark ? darkColors : lightColors, spacing, radii, type, fonts, motion };
}

// Calm-by-default: reduced motion collapses entrance animations to nothing.
export function useCalmMotion(): boolean {
  return useReducedMotion();
}

// Map a risk / status class to its semantic color (meaning is fixed:
// sage=success/low, amber=warn/medium, coral=danger/high, lavender=sensitive).
export function riskColor(c: HearthColors, risk: string): { fg: string; bg: string } {
  switch (risk) {
    case "Low": return { fg: c.sage, bg: c.sageBg };
    case "Medium": return { fg: c.amber, bg: c.amberBg };
    case "High": return { fg: c.coral, bg: c.coralBg };
    case "Sensitive": return { fg: c.lavender, bg: c.lavenderBg };
    default: return { fg: c.textMuted, bg: c.surfaceSunken };
  }
}

export function statusColor(c: HearthColors, status: string): { fg: string; bg: string } {
  switch (status) {
    case "done": case "completed": case "succeeded": case "verified": case "Active": case "healthy": case "connected":
      return { fg: c.sage, bg: c.sageBg };
    case "running": case "in_progress": case "pending": case "waiting_approval": case "attention": case "needs_attention":
      return { fg: c.amber, bg: c.amberBg };
    case "failed": case "error": case "denied": case "blocked":
      return { fg: c.coral, bg: c.coralBg };
    case "info": case "synced": case "linked": case "draft": case "Draft":
      return { fg: c.sky, bg: c.skyBg };
    default: return { fg: c.textMuted, bg: c.surfaceSunken };
  }
}

// Haptics: decisive actions only (approve, deny, send, delete, toggle).
// iOS-only per Expo guidance; silently a no-op elsewhere.
export function tapHaptic(kind: "light" | "success" | "warning" | "error" | "select" = "light"): void {
  if (process.env.EXPO_OS !== "ios") return;
  switch (kind) {
    case "success": void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); break;
    case "warning": void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning); break;
    case "error": void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error); break;
    case "select": void Haptics.selectionAsync(); break;
    default: void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }
}
