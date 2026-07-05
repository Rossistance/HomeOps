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
    headerTintColor: colors.ember,
    headerTitleStyle: { color: colors.text, fontFamily: fonts.semibold },
    headerLargeTitleStyle: { color: colors.text, fontFamily: fonts.displayBold },
    contentStyle: { backgroundColor: colors.bg },
  };
}
