// Tactile Hearth, native — design tokens for the iOS client.
// Light mode mirrors the web system (warm paper & clay, ember accent); dark mode
// is "the hearth at night": warm charcoals, embers glowing slightly brighter.
// Every screen consumes these through useTheme(); no hardcoded colors in screens.
import { useColorScheme } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

export interface HearthColors {
  bg: string;            // page background (paper)
  surface: string;       // cards
  surfaceSunken: string; // wells, inputs
  rim: string;           // top highlight rim on cards
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  textFaint: string;
  ember: string;         // brand accent (use sparingly — one primary action per view)
  emberSoft: string;     // pressed / secondary ember
  emberBg: string;
  onEmber: string;
  sage: string; sageBg: string;      // success / done
  coral: string; coralBg: string;    // attention / destructive
  amber: string; amberBg: string;    // warning / pending
  sky: string; skyBg: string;        // info / synced
  lavender: string; lavenderBg: string; // care / sensitive
  tabInactive: string;
  shadow: string;        // boxShadow color component
}

export const lightColors: HearthColors = {
  bg: "#ece3d5",
  surface: "#fdfbf7",
  surfaceSunken: "#e6dccb",
  rim: "#ffffff",
  border: "rgba(23,27,38,0.08)",
  text: "#171b26",
  textSecondary: "#2b3346",
  textMuted: "#525d76",
  textFaint: "#7b8499",
  ember: "#d26420",
  emberSoft: "#ae4d18",
  emberBg: "#fdf1e7",
  onEmber: "#ffffff",
  sage: "#436e46", sageBg: "#eef5ee",
  coral: "#c4502f", coralBg: "#fdeeea",
  amber: "#b27c04", amberBg: "#fdf6e7",
  sky: "#3a8bc7", skyBg: "#ebf4fb",
  lavender: "#7d66c0", lavenderBg: "#f2effa",
  tabInactive: "#7b8499",
  shadow: "rgba(23,27,38,0.10)",
};

export const darkColors: HearthColors = {
  bg: "#17130e",
  surface: "#221c14",
  surfaceSunken: "#120e09",
  rim: "#2f281d",
  border: "rgba(236,227,213,0.10)",
  text: "#f3ecdf",
  textSecondary: "#ddd3c1",
  textMuted: "#a99d88",
  textFaint: "#7d735f",
  ember: "#e47f35",
  emberSoft: "#f0934d",
  emberBg: "rgba(228,127,53,0.14)",
  onEmber: "#1c1207",
  sage: "#8fbf93", sageBg: "rgba(85,138,89,0.16)",
  coral: "#ef8b6b", coralBg: "rgba(226,105,72,0.16)",
  amber: "#e5b544", amberBg: "rgba(217,154,6,0.16)",
  sky: "#74b3e0", skyBg: "rgba(58,139,199,0.16)",
  lavender: "#a893e0", lavenderBg: "rgba(125,102,192,0.18)",
  tabInactive: "#7d735f",
  shadow: "rgba(0,0,0,0.35)",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;
export const radii = { sm: 10, md: 14, lg: 20, xl: 26, pill: 999 } as const;

// Fraunces carries the hearth voice (headings, big numbers); Inter carries the UI.
export const fonts = {
  display: "Fraunces_600SemiBold",
  displayBold: "Fraunces_700Bold",
  regular: "Inter_400Regular",
  medium: "Inter_500Medium",
  semibold: "Inter_600SemiBold",
  bold: "Inter_700Bold",
} as const;

export const type = {
  h1: { fontFamily: fonts.displayBold, fontSize: 30, lineHeight: 36, letterSpacing: -0.5 },
  h2: { fontFamily: fonts.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  h3: { fontFamily: fonts.semibold, fontSize: 17, lineHeight: 22 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  bodyMedium: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22 },
  sub: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  subMedium: { fontFamily: fonts.medium, fontSize: 13, lineHeight: 19 },
  caption: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
  eyebrow: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, letterSpacing: 1.2, textTransform: "uppercase" as const },
} as const;

export interface Theme {
  dark: boolean;
  colors: HearthColors;
  spacing: typeof spacing;
  radii: typeof radii;
  type: typeof type;
  fonts: typeof fonts;
}

export function useTheme(): Theme {
  const scheme = useColorScheme();
  const dark = scheme === "dark";
  return { dark, colors: dark ? darkColors : lightColors, spacing, radii, type, fonts };
}

// Calm-by-default: reduced motion collapses entrance animations to nothing.
export function useCalmMotion(): boolean {
  return useReducedMotion();
}

// Map a risk / status class to its semantic color (meaning preserved from web:
// sage=done/low, amber=warning/medium, coral=attention/high, lavender=sensitive).
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
    case "done": case "completed": case "succeeded": case "verified": case "Active": case "healthy":
      return { fg: c.sage, bg: c.sageBg };
    case "running": case "in_progress": case "pending": case "waiting_approval":
      return { fg: c.amber, bg: c.amberBg };
    case "failed": case "error": case "denied": case "blocked":
      return { fg: c.coral, bg: c.coralBg };
    case "info": case "synced": case "linked":
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
