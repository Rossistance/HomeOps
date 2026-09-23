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

export { lightColors, darkColors, type HearthColors } from "./colors-data";
import { lightColors, darkColors, type HearthColors } from "./colors-data";

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
    case "waiting_for_approval": case "waiting_for_connector": case "waiting_for_provider": // what the engine writes for a parked run (server/engine.mjs)
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
