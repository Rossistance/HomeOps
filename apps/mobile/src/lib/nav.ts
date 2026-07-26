// Shared native-stack styling: large titles on warm paper, Fraunces headers.
import { useTheme, fonts } from "@/theme";
import type { ComponentProps } from "react";
import type { Stack } from "expo-router/stack";

type StackOptions = ComponentProps<typeof Stack>["screenOptions"];

export function useHearthStackOptions(): StackOptions {
  const { colors } = useTheme();
  return {
    headerLargeTitle: true,
    headerTransparent: true,
    headerShadowVisible: false,
    headerLargeTitleShadowVisible: false,
    headerLargeStyle: { backgroundColor: "transparent" },
    headerBlurEffect: "none",
    headerBackButtonDisplayMode: "minimal",
    /* Swipe back from ANYWHERE on the screen, not just the left edge.
     *
     * "When there's a menu that pops up, like on calendars looking at the detail, I should be
     * able to swipe to go back to the previous screen." iOS gives you a ~20pt edge strip by
     * default, which is easy to miss on a large phone and impossible to find one-handed on the
     * wrong side. `fullScreenGestureEnabled` makes the whole screen draggable.
     *
     * Set here rather than per-screen because "can I get back out of this" should never depend
     * on which screen you happen to be on — that inconsistency is worse than not having it. */
    gestureEnabled: true,
    fullScreenGestureEnabled: true,
    headerTintColor: colors.ember,
    headerTitleStyle: { color: colors.text, fontFamily: fonts.semibold },
    headerLargeTitleStyle: { color: colors.text, fontFamily: fonts.displayBold },
    contentStyle: { backgroundColor: colors.bg },
  };
}
