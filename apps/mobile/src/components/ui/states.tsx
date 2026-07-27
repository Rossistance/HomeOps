// Honest UI states: empty, error (with retry), inline notice. No silent failures.
import { View } from "react-native";
import Animated, { FadeIn, FadeInDown, ReduceMotion } from "react-native-reanimated";
import { useTheme } from "@/theme";
import { Card } from "./card";
import { Button } from "./button";
import { T } from "./text";
import { Sym } from "./symbol";

export function EmptyState({ icon = "tray", title, hint, action }: { icon?: string; title: string; hint?: string; action?: { title: string; onPress: () => void } }) {
  const { colors, spacing } = useTheme();
  return (
    <Animated.View entering={FadeIn.duration(240).reduceMotion(ReduceMotion.System)}>
      <Card style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xxl }}>
        <View style={{ width: 52, height: 52, borderRadius: 17, borderCurve: "continuous", backgroundColor: colors.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
          <Sym name={icon} size={24} color={colors.textFaint} />
        </View>
        <T kind="h3" color={colors.text} center>{title}</T>
        {hint ? <T kind="sub" center style={{ maxWidth: 280 }}>{hint}</T> : null}
        {action ? <View style={{ marginTop: spacing.sm }}><Button title={action.title} variant="ember" onPress={action.onPress} /></View> : null}
      </Card>
    </Animated.View>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { colors, spacing } = useTheme();
  return (
    <Animated.View entering={FadeIn.duration(240).reduceMotion(ReduceMotion.System)}>
      <Card style={{ alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xl }}>
        <Sym name="wifi.exclamationmark" size={26} color={colors.coral} />
        <T kind="h3" color={colors.text} center>Couldn't reach FamiliOS</T>
        <T kind="sub" center selectable style={{ maxWidth: 300 }}>{message ?? "Check your connection and try again."}</T>
        {onRetry ? <View style={{ marginTop: spacing.sm }}><Button title="Try again" icon="arrow.clockwise" onPress={onRetry} /></View> : null}
      </Card>
    </Animated.View>
  );
}

/** Inline result notice (success or problem) — replaces ad-hoc toast text. */
/**
 * @param tone  A category colour to wear instead of the default green.
 *
 * "If something is indeed saved to School it should be blue — the toast shouldn't be green…
 *  It should go into Bills & Receipts, and therefore assume a yellow hue."
 *
 * Green means "that worked", which is true but is the least interesting thing the toast could
 * say. WHERE it went is the part you'd want to check, and a colour says it before you've
 * finished reading. Failures stay coral regardless: a red thing must never be given a
 * category's friendly colour just because it knows which category it failed in.
 */
export function Notice({ text, ok, tone }: { text: string; ok: boolean; tone?: { fg: string; bg: string } }) {
  const { colors, spacing } = useTheme();
  const fg = !ok ? colors.coral : (tone?.fg ?? colors.sage);
  const bg = !ok ? colors.coralBg : (tone?.bg ?? colors.sageBg);
  return (
    <Animated.View entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: bg, borderRadius: 12, borderCurve: "continuous", paddingHorizontal: spacing.md, paddingVertical: 10 }}>
        <Sym name={ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"} size={15} color={fg} />
        <T kind="subMedium" color={fg} selectable style={{ flex: 1 }}>{text}</T>
      </View>
    </Animated.View>
  );
}
