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
export function Notice({ text, ok }: { text: string; ok: boolean }) {
  const { colors, spacing } = useTheme();
  return (
    <Animated.View entering={FadeInDown.duration(220).reduceMotion(ReduceMotion.System)}>
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center", backgroundColor: ok ? colors.sageBg : colors.coralBg, borderRadius: 12, borderCurve: "continuous", paddingHorizontal: spacing.md, paddingVertical: 10 }}>
        <Sym name={ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill"} size={15} color={ok ? colors.sage : colors.coral} />
        <T kind="subMedium" color={ok ? colors.sage : colors.coral} selectable style={{ flex: 1 }}>{text}</T>
      </View>
    </Animated.View>
  );
}
