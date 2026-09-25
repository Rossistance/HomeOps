// Hidden time, drawn calmly (ADR-005).
//
// Two faces share one card:
//  - block      someone else's hidden time ("Beannie working"). Frosted glass over soft
//               placeholder lines, their photo and the label drawn ABOVE the glass. It is not
//               an event: never tappable, never opened, never edited.
//  - ownHidden  the viewer's own hidden event. The real card sits UNDER the glass, the owner
//               can still tap it open, and an eye-slash on top shares it with the family.
// Plus EyeButton on its own: the small open eye a shared Work event wears so its owner can
// hide it again.
//
// The point of a Work calendar is calm, not secrecy: the glass should read as "busy, and
// that is all you need to know", never as something locked away. So the tint follows the
// light (thin material in both modes), the owner's colour washes faintly through, and the
// words above it are plain.
import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { BlurView } from "expo-blur";
import type { EventRec, MemberRec } from "@/lib/api";
import { eventFace } from "@/lib/event-face";
import { blockA11yLabel, hiddenCaption, timeRangeLabel } from "@/lib/event-eye";
import { fade, memberColor } from "@/lib/member-colors";
import { MemberAvatar } from "@/app/(home)/profile";
import { useTheme } from "@/theme";
import { cardStyle } from "@/components/ui/card";
import { PressableScale } from "@/components/ui/pressable-scale";
import { Sym } from "@/components/ui/symbol";
import { T } from "@/components/ui/text";

/** The eye on a card. `hidden` = the event is hidden now, so the button shows eye.slash and
 *  pressing it shares; otherwise it shows the open eye and pressing it hides. */
export function EyeButton({ hidden, onPress, busy, testID, accessibilityLabel, small }: {
  hidden: boolean;
  onPress: () => void;
  busy?: boolean;
  testID: string;
  accessibilityLabel: string;
  small?: boolean;
}) {
  const { colors } = useTheme();
  const size = small ? 26 : 32;
  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      disabled={busy}
      haptic="select"
      hitSlop={small ? 12 : 8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: !!busy, disabled: !!busy }}
      style={{
        width: size, height: size, borderRadius: size / 2,
        alignItems: "center", justifyContent: "center",
        backgroundColor: fade(colors.surface, 0.85),
        borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
      }}
    >
      {busy
        ? <ActivityIndicator size="small" color={colors.textMuted} />
        : <Sym name={hidden ? "eye.slash" : "eye"} size={small ? 13 : 15} color={colors.textSecondary} />}
    </PressableScale>
  );
}

/** Soft lines under the glass — the shape of an event without any of its words. */
function Placeholder({ tone, compact }: { tone: string; compact?: boolean }) {
  const h = compact ? 7 : 9;
  return (
    <View style={{ gap: compact ? 5 : 7, paddingVertical: compact ? 2 : 4 }}>
      <View style={{ width: "72%", height: h, borderRadius: h / 2, backgroundColor: fade(tone, 0.45) }} />
      <View style={{ width: "46%", height: h, borderRadius: h / 2, backgroundColor: fade(tone, 0.28) }} />
      {compact ? null : <View style={{ width: "58%", height: h, borderRadius: h / 2, backgroundColor: fade(tone, 0.2) }} />}
    </View>
  );
}

export type ObscuredCardProps = {
  mode: "block" | "ownHidden";
  /** Whose time this is — a block's block.ownerId, or the viewer themself. */
  owner: MemberRec | null | undefined;
  /** Drawn above the glass: "Beannie working", or the owner's own caption. */
  label: string;
  /** A second line above the glass — usually the time range. */
  sublabel?: string | null;
  /** Small rows and chips (Today, the family day lists). */
  compact?: boolean;
  /** ownHidden only: the real card, drawn under the glass. Blocks get placeholder lines. */
  children?: ReactNode;
  /** ownHidden only: tapping the body opens the owner's event form. */
  onPress?: () => void;
  /** ownHidden only: the eye-slash shares the event. Leave out for a static eye-slash icon
   *  (compact chips where the toggle would be too small a target). */
  onToggle?: () => void;
  toggling?: boolean;
  eyeTestID?: string;
  eyeLabel?: string;
  testID?: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

export function ObscuredCard({
  mode, owner, label, sublabel, compact, children, onPress, onToggle, toggling,
  eyeTestID, eyeLabel, testID, accessibilityLabel, accessibilityHint, style,
}: ObscuredCardProps) {
  const { colors, dark, spacing } = useTheme();
  const tone = memberColor(colors, owner) ?? colors.textFaint;
  const own = mode === "ownHidden";
  const pad = compact ? 10 : spacing.lg;
  const avatar = compact ? 20 : 30;
  // Real words under the glass need a thicker pane than placeholder lines do.
  const intensity = own ? (dark ? 70 : 60) : (dark ? 45 : 35);
  const hasEye = own && !!onToggle;

  const shell: ViewStyle = compact
    ? {
      borderRadius: 12, borderCurve: "continuous", overflow: "hidden",
      backgroundColor: colors.surfaceSunken,
      borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    }
    : { ...cardStyle(colors, dark), overflow: "hidden" };

  const under = (
    <View style={{ padding: pad, minHeight: compact ? 40 : 64, justifyContent: "center" }}>
      {own && children ? children : <Placeholder tone={tone} compact={compact} />}
    </View>
  );

  const above = (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, {
        flexDirection: "row", alignItems: "center", gap: compact ? 8 : spacing.md,
        paddingHorizontal: pad,
        // Room for the eye, which sits beside this layer rather than inside it.
        paddingRight: hasEye ? pad + (compact ? 30 : 40) : pad,
      }]}
    >
      <MemberAvatar member={owner} size={avatar} ringWidth={compact ? 1.5 : 2} />
      <View style={{ flex: 1, gap: 1 }}>
        <T kind={compact ? "subMedium" : "bodyMedium"} color={colors.text} numberOfLines={1}>{label}</T>
        {sublabel ? <T kind="caption" color={colors.textSecondary} numberOfLines={1}>{sublabel}</T> : null}
      </View>
      {own && !onToggle ? <Sym name="eye.slash" size={compact ? 13 : 15} color={colors.textSecondary} /> : null}
    </View>
  );

  const glass = (
    <>
      {under}
      <BlurView
        pointerEvents="none"
        intensity={intensity}
        tint={dark ? "systemThinMaterialDark" : "systemThinMaterialLight"}
        style={StyleSheet.absoluteFill}
      />
      {/* The owner's colour, breathed through the glass — whose time it is, at a glance. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: fade(tone, dark ? 0.1 : 0.08) }]} />
      <View pointerEvents="none" style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: compact ? 3 : 4, backgroundColor: fade(tone, 0.7) }} />
      {above}
    </>
  );

  // A block is a statement, not a control: one accessible element, nothing to press.
  if (!own) {
    return (
      <View testID={testID} accessible accessibilityLabel={accessibilityLabel} style={[shell, style]}>
        {glass}
      </View>
    );
  }

  // The owner's own: the body opens the event, the eye is its own control beside it (a
  // sibling, so VoiceOver and Maestro can reach it separately from the body).
  return (
    <View style={style}>
      {onPress ? (
        <PressableScale
          testID={testID}
          haptic="light"
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          style={shell}
        >
          {glass}
        </PressableScale>
      ) : (
        <View testID={testID} accessible accessibilityLabel={accessibilityLabel} style={shell}>{glass}</View>
      )}
      {hasEye ? (
        <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { alignItems: "flex-end", justifyContent: "center", paddingRight: pad }]}>
          <EyeButton
            hidden
            small={compact}
            busy={toggling}
            onPress={onToggle!}
            testID={eyeTestID ?? "eye-toggle"}
            accessibilityLabel={eyeLabel ?? "Share with family"}
          />
        </View>
      ) : null}
    </View>
  );
}

/** A hidden event as a compact frosted row body, for the simple family-day lists (kid,
 *  grandparent, sitter). Returns null for an ordinary event so the caller draws its own row.
 *  A block never opens; the owner's own hidden event opens only when `onOpen` is given. */
export function CompactHiddenEvent({ event, members, sublabel, onOpen }: {
  event: EventRec;
  members: MemberRec[];
  /** Defaults to the time range. */
  sublabel?: string | null;
  onOpen?: () => void;
}) {
  const face = eventFace(event);
  if (face.mode === "full") return null;
  const ownerId = face.mode === "block" ? face.ownerId : event.ownerId;
  const owner = members.find((m) => m.actorId === ownerId) ?? null;
  const sub = sublabel === undefined ? timeRangeLabel(event) : sublabel;
  if (face.mode === "block") {
    return (
      <ObscuredCard compact mode="block" owner={owner} label={face.label} sublabel={sub}
        testID="event-block" accessibilityLabel={blockA11yLabel(face.label, event)} />
    );
  }
  return (
    <ObscuredCard compact mode="ownHidden" owner={owner} label={hiddenCaption(face)} sublabel={sub}
      testID={`event-card-${event.id}`} onPress={onOpen}
      accessibilityLabel={`${event.title}, ${timeRangeLabel(event)}. Hidden from the family`}>
      <T kind="subMedium" numberOfLines={1}>{event.title}</T>
    </ObscuredCard>
  );
}
