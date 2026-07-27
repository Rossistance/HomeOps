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
    /* W1 — "the app crashed one time… I think it was from using a back-swipe gesture from the
     * Today screen", and then "it may be best just to get rid of all gesture movements".
     *
     * Today is the ROOT of its stack: there is nothing behind it to go back to. A full-screen
     * back gesture there asks react-native-screens to interactively dismiss a screen with no
     * predecessor, which is exactly the shape of thing that crashes rather than declining.
     *
     * I'm not deleting the gestures, because he asked for them two days ago and they work
     * everywhere they have somewhere to go. The narrow fix is the honest one: each stack turns
     * the gesture OFF on its own root screen (see the layouts), so a swipe on Today is handled
     * by the tab swipe — which is what he actually wanted from a horizontal drag there — and
     * never by a dismissal that has nowhere to land. If it crashes again after this, the
     * gestures come out; but removing a feature to fix a bug you can name is the wrong order. */
    headerTintColor: colors.ember,
    headerTitleStyle: { color: colors.text, fontFamily: fonts.semibold },
    headerLargeTitleStyle: { color: colors.text, fontFamily: fonts.displayBold },
    contentStyle: { backgroundColor: colors.bg },
  };
}
