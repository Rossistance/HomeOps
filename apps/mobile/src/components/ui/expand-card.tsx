// The canonical card. The owner named the model himself, reviewing Playbooks at 24:36 of
// the 2026-07-25 walkthrough:
//
//   "This one looks better — the title is text wrapped and the full card is available.
//    This is almost how every single card should look, where they expand and a button down
//    at the bottom underneath like 'Use playbook' that would collapse as well.
//    That needs to be on like every single card throughout the application."
//
// Everywhere else failed the same way: agent titles unreadable, suggestion prompts cut
// mid-sentence ("why would I click on something if I don't know exactly what it says"),
// automation rows with no way to see what they use, member names clipped — "this happens
// throughout the application and needs to change."
//
// Three rules this primitive enforces so those can't come back one screen at a time:
//   1. A TITLE IS NEVER TRUNCATED. It wraps. A name you can't read is not a name.
//   2. Identifying facts (tools, connections, who it runs as) stay visible while COLLAPSED
//      — "it doesn't have to be big, but so there's a visual reference."
//   3. Expanding reveals the whole card, with its action at the BOTTOM, and the action
//      area collapses with it.
import { useState, type ReactNode } from "react";
import { View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useTheme } from "@/theme";
import { PressableCard } from "./card";
import { Badge } from "./badge";
import { Button } from "./button";
import { Sym } from "./symbol";
import { Expander, GoArrow } from "./expander";
import { T } from "./text";

/** A small always-visible fact: "3 tools", "Google Calendar", "Runs unattended". */
export interface CardChip {
  label: string;
  icon?: string;
  /** "muted" (default) | "info" | "warn" | "good" — semantic, not raw colour. */
  tone?: "muted" | "info" | "warn" | "good";
}

export interface ExpandCardProps {
  title: string;
  /** Leading tile. Omit for a text-only card. */
  icon?: string;
  iconColor?: string;
  iconBg?: string;
  /** One-line status shown to the right of the title (e.g. "Active"). */
  badge?: { label: string; fg?: string; bg?: string; icon?: string };
  /** Prose under the title. Clamped while collapsed, full when open. */
  summary?: string;
  /** Facts that stay readable COLLAPSED — the "what does this actually use" answer. */
  chips?: CardChip[];
  /** Revealed on expand. */
  children?: ReactNode;
  /** Primary action, rendered at the BOTTOM of the expanded card. */
  action?: { label: string; onPress: () => void; icon?: string; variant?: "ember" | "neutral" | "ghost" | "success" | "danger"; loading?: boolean; disabled?: boolean };
  /** Secondary action beside the primary one. */
  secondaryAction?: { label: string; onPress: () => void; icon?: string };
  /** Controlled mode — omit to let the card manage its own state. */
  expanded?: boolean;
  onToggle?: (next: boolean) => void;
  /** Tapping the card body when there is nothing to expand (pure navigation card). */
  onPress?: () => void;
  /** Lines of `summary` to show while collapsed. 0 hides it until expanded. */
  collapsedSummaryLines?: number;
  testID?: string;
}

const TONE_KEYS = {
  muted: ["textMuted", "surfaceSunken"],
  info: ["sky", "skyBg"],
  warn: ["amber", "amberBg"],
  good: ["sage", "sageBg"],
} as const;

export function ExpandCard({
  title, icon, iconColor, iconBg, badge, summary, chips, children, action, secondaryAction,
  expanded, onToggle, onPress, collapsedSummaryLines = 2, testID,
}: ExpandCardProps) {
  const { colors, spacing } = useTheme();
  const [internal, setInternal] = useState(false);
  const controlled = expanded !== undefined;
  const open = controlled ? !!expanded : internal;
  // Only offer expansion when there is genuinely more to see — a chevron that reveals
  // nothing is its own small lie.
  const expandable = !!children || (!!summary && collapsedSummaryLines > 0);

  const toggle = () => {
    if (!expandable) { onPress?.(); return; }
    const next = !open;
    if (!controlled) setInternal(next);
    onToggle?.(next);
  };

  const toneOf = (t: CardChip["tone"] = "muted") => {
    const [fg, bg] = TONE_KEYS[t] ?? TONE_KEYS.muted;
    return { fg: colors[fg as keyof typeof colors] as string, bg: colors[bg as keyof typeof colors] as string };
  };

  return (
    <PressableCard
      testID={testID}
      onPress={toggle}
      haptic="select"
      scaleTo={0.99}
      accessibilityRole="button"
      accessibilityState={expandable ? { expanded: open } : undefined}
      // The accessible name carries the full title — a screen reader must not inherit the
      // visual clipping this component exists to remove.
      accessibilityLabel={`${title}${summary ? `. ${summary}` : ""}${expandable ? (open ? ". Collapse" : ". Expand") : ""}`}
      style={{ gap: spacing.sm }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        {icon ? (
          <View style={{ width: 34, height: 34, borderRadius: 11, borderCurve: "continuous", backgroundColor: iconBg ?? colors.emberBg, alignItems: "center", justifyContent: "center" }}>
            <Sym name={icon} size={17} color={iconColor ?? colors.ember} />
          </View>
        ) : null}
        {/* RULE 1: no numberOfLines. The title wraps, always. */}
        <View style={{ flex: 1, gap: 2 }}>
          <T kind="h3" color={colors.text}>{title}</T>
        </View>
        {badge ? <Badge label={badge.label} icon={badge.icon} fg={badge.fg ?? colors.textMuted} bg={badge.bg ?? colors.surfaceSunken} /> : null}
        {/* N1 — the affordance has to look like one. A 13pt grey glyph reads as decoration;
            people were tapping it instead of the card and missing. */}
        {expandable || onPress ? (
          <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceSunken, alignItems: "center", justifyContent: "center", marginTop: 2 }}>
            {/* One expander for the whole app (ui/expander) — the sizes used to be picked
                per screen, which is why they drifted and why some came out scaled down. */}
            {expandable
              ? <Expander open={open} kind="chevron" tone={iconColor} />
              : <GoArrow tone={colors.textSecondary} />}
          </View>
        ) : null}
      </View>

      {summary ? (
        <T kind="sub" numberOfLines={open ? undefined : (collapsedSummaryLines || undefined)}>{summary}</T>
      ) : null}

      {/* RULE 2: the identifying facts survive collapse. */}
      {chips?.length ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {chips.map((c, i) => {
            const { fg, bg } = toneOf(c.tone);
            return <Badge key={`${c.label}-${i}`} label={c.label} icon={c.icon} fg={fg} bg={bg} />;
          })}
        </View>
      ) : null}

      {open ? (
        <Animated.View entering={FadeIn.duration(180).reduceMotion(ReduceMotion.System)} style={{ gap: spacing.lg, marginTop: spacing.xs }}>
          {children}
          {/* RULE 3: the action lives at the bottom and goes away with the card. */}
          {/* RULE 3, refined by N2 [07:15]: "those need to swap places — Open helper should be
              on the RIGHT and the More should be small and down to the left of each one of
              these cards."

              The primary action now sits on the right where a thumb ends up, and takes the
              width. The secondary is small and left — present, clearly not the main thing.
              Changed HERE rather than at one call site, so every card in the app agrees. */}
          {action || secondaryAction ? (
            <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "center" }}>
              {secondaryAction ? (
                <View style={{ flexShrink: 0 }}>
                  <Button title={secondaryAction.label} icon={secondaryAction.icon} variant="ghost" small onPress={secondaryAction.onPress} />
                </View>
              ) : null}
              <View style={{ flex: 1 }} />
              {action ? (
                <View style={{ flexGrow: 1, flexBasis: "58%" }}>
                  <Button title={action.label} icon={action.icon} variant={action.variant ?? "ember"} full small
                    loading={action.loading} disabled={action.disabled} onPress={action.onPress} />
                </View>
              ) : null}
            </View>
          ) : null}
        </Animated.View>
      ) : null}
    </PressableCard>
  );
}
