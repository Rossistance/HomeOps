// Bottom sheet per handoff: surface bg, 28px top radius, drag handle, header
// with accent Close/Cancel left + 15/650 centered title, 0.4 backdrop, springy
// translateY. ConfirmFlash: an 84px circle that pops center-screen for 0.8s
// after a decisive action (check=success, x=danger, everything else=accent).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, tapHaptic } from "@/theme";
import { T } from "./text";
import { Sym } from "./symbol";
import { PressableScale } from "./pressable-scale";
import { depth, rimColor } from "@/theme/neumorph";

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
/** How far down before a drag counts as "close this", and how fast before distance stops
 *  mattering. Generous enough that a brush springs back with your work still in it. */
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 800;
const SPRING = { damping: 20, stiffness: 240 } as const;

export function HSheet({ visible, onClose, title, leftLabel = "Close", heightPct = 0.84, children, footer }: {
  visible: boolean;
  onClose: () => void;
  title: string;
  leftLabel?: string;
  heightPct?: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { colors, dark, spacing } = useTheme();
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  /* Two stops, so the sheet can be EXPANDED and RETRACTED as well as dismissed. The base is
   * whatever the caller asked for; the taller one is everything short of the status bar. */
  const baseH = Math.round(winH * heightPct);
  const maxH = Math.round(winH - Math.max(insets.top, 20));
  const canExpand = maxH - baseH > 40; // a sheet already near full height has nothing to expand to

  const [mounted, setMounted] = useState(visible);
  const y = useSharedValue(baseH);
  const backdrop = useSharedValue(0);
  /* Height is animated rather than toggled so expanding reads as the sheet GROWING, which is
   * what the drag implies. Toggling would make the same gesture look like a screen swap. */
  const h = useSharedValue(baseH);
  const expanded = useSharedValue(0);

  const unmount = useCallback(() => setMounted(false), []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      y.value = withTiming(0, { duration: 380, easing: EASE });
      backdrop.value = withTiming(0.4, { duration: 300 });
    } else if (mounted) {
      backdrop.value = withTiming(0, { duration: 260 });
      /* Translate by the sheet's CURRENT height, not its base one. An expanded sheet is
       * taller than baseH, so animating to baseH would leave the difference still sitting on
       * screen — the sheet would appear to close and then stick. */
      y.value = withTiming(Math.max(h.value, baseH), { duration: 300, easing: EASE }, (done) => {
        if (done) runOnJS(unmount)();
      });
    }
  }, [visible, mounted, baseH, y, h, backdrop, unmount]);

  // A reopened sheet starts at its base height — inheriting the last drag would mean opening
  // full-screen for a reason nobody watching could remember.
  useEffect(() => { if (visible) { h.value = baseH; expanded.value = 0; } }, [visible, baseH, h, expanded]);

  /* Expand, retract, dismiss — the three things he asked a popup menu to do.
   *
   * "I want to just swipe across the screen to go from page to page, and swipe up and down on
   *  a pop up menu to expand, retract, or dismiss."
   *
   * The grabber has always been DRAWN and has never done anything, which is why the Close
   * button had to grow into a labelled pill to carry the whole job. Now:
   *
   *   drag up      → grow to full height (if there's anywhere to grow to)
   *   drag down    → retract to the base height first, and only then dismiss
   *   flick down   → dismiss from either height
   *
   * Retract-before-dismiss matters: from an expanded sheet a single long drag would otherwise
   * blow straight past the middle state and close something you were only trying to shrink.
   *
   * It starts from the grab area rather than the whole sheet, so it can never steal a scroll
   * from the content — the mistake that makes bottom sheets feel possessed. */
  const dragStartH = useSharedValue(0);
  const drag = useMemo(() => Gesture.Pan()
    .onBegin(() => { "worklet"; dragStartH.value = h.value; })
    .onUpdate((e) => {
      "worklet";
      if (e.translationY < 0) {
        // Upward: grow, capped at the tall stop. Never translate — a sheet lifting off the
        // bottom edge of the screen looks broken rather than big.
        h.value = Math.min(maxH, dragStartH.value - e.translationY);
        y.value = 0;
      } else if (dragStartH.value > baseH) {
        // Downward from expanded: shrink back toward base before any dismissal begins.
        const shrunk = Math.max(baseH, dragStartH.value - e.translationY);
        h.value = shrunk;
        y.value = shrunk > baseH ? 0 : e.translationY - (dragStartH.value - baseH);
      } else {
        y.value = Math.max(0, e.translationY);
      }
      // The backdrop fades with the drag, which is what makes it feel attached to the finger
      // rather than played back at it.
      backdrop.value = 0.4 * (1 - Math.min(1, Math.max(0, y.value) / baseH));
    })
    .onEnd((e) => {
      "worklet";
      const flickDown = e.velocityY > DISMISS_VELOCITY;
      const flickUp = e.velocityY < -DISMISS_VELOCITY;

      if (canExpand && (flickUp || h.value > baseH + (maxH - baseH) * 0.4)) {
        h.value = withSpring(maxH, SPRING); expanded.value = 1;
        y.value = withSpring(0, SPRING); backdrop.value = withTiming(0.4, { duration: 160 });
        return;
      }
      if (y.value > DISMISS_DISTANCE || (flickDown && y.value > 40)) {
        // Hand back to the same close path the button uses, so a dismissal is a dismissal
        // however it started — one owner of "this sheet is going away".
        runOnJS(onClose)();
        return;
      }
      h.value = withSpring(baseH, SPRING); expanded.value = 0;
      y.value = withSpring(0, SPRING);
      backdrop.value = withTiming(0.4, { duration: 160 });
    }), [onClose, y, h, expanded, dragStartH, baseH, maxH, canExpand, backdrop]);

  const heightStyle = useAnimatedStyle(() => ({ height: h.value }));

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));

  if (!mounted) return null;
  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose}>
      <View style={st.fill}>
        <Animated.View style={[st.fill, { backgroundColor: "#000" }, backdropStyle]} />
        <Pressable style={st.fill} onPress={onClose} accessibilityLabel="Dismiss" />
        <Animated.View
          style={[
            st.sheet, sheetStyle,
            heightStyle,
            { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          {/* The grabber is now a real one. It was decoration — a 4pt bar that looks exactly
              like the thing every other iOS sheet lets you drag, attached to nothing. */}
          <GestureDetector gesture={drag}>
            <View style={st.grabArea} accessible accessibilityRole="adjustable"
              accessibilityLabel="Drag down to close" accessibilityHint="Swipe down to dismiss this sheet">
              <View style={[st.handle, { backgroundColor: colors.textFaint }]} />
            </View>
          </GestureDetector>
          <View style={[st.header, { paddingHorizontal: spacing.xl }]}>
            {/* "I asked for the see all and close buttons to be made into real buttons, however
                that removes swipe down to dismiss a pop-up menu and doesn't really align with
                the rest of the features in the app… use the arrow buttons with circles that are
                used for expand and retract in other places in the app."
                
                Both halves of that were fair. The labelled pill was a shape this app doesn't
                use anywhere else, and putting a button where the eye expects a grabber taught
                people to reach for the button — so the drag nobody had implemented was never
                missed. Now the circle matches every other expander in the app, it points DOWN
                (the direction the sheet goes), and the drag it implies actually works. */}
            <PressableScale
              onPress={onClose} haptic="select" hitSlop={12}
              accessibilityRole="button" accessibilityLabel={leftLabel}
              style={[st.headerSide, { alignItems: "flex-start" }]}
            >
              <View style={{
                width: 30, height: 30, borderRadius: 15,
                alignItems: "center", justifyContent: "center",
                backgroundColor: dark ? colors.surfaceSunken : colors.bg,
                borderWidth: 1, borderColor: rimColor(colors, dark),
                boxShadow: depth("raisedSm", colors, dark),
              }}>
                <Sym name="chevron.down" size={15} color={colors.textSecondary} />
              </View>
            </PressableScale>
            <T style={{ fontSize: 15, fontWeight: "600" }} color={colors.text}>{title}</T>
            <View style={st.headerSide} />
          </View>
          <View style={{ flex: 1 }}>{children}</View>
          {footer ? <View style={{ paddingHorizontal: spacing.xl, paddingTop: spacing.md }}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

export type FlashKind = "approve" | "deny" | "run" | "helper" | "upload" | "send" | "connect" | "chore" | null;

const FLASH_ICON: Record<Exclude<FlashKind, null>, string> = {
  approve: "checkmark", deny: "xmark", run: "play.fill", helper: "wand.and.stars",
  upload: "square.and.arrow.up", send: "paperplane.fill", connect: "link", chore: "checkmark",
};

export function useConfirmFlash(): { flash: ReactNode; show: (kind: Exclude<FlashKind, null>, after?: () => void) => void } {
  const { colors } = useTheme();
  const [kind, setKind] = useState<FlashKind>(null);

  const show = useCallback((k: Exclude<FlashKind, null>, after?: () => void) => {
    tapHaptic(k === "deny" ? "warning" : "success");
    setKind(k);
    const ms = k === "run" ? 750 : 800;
    setTimeout(() => { setKind(null); after?.(); }, ms);
  }, []);

  const color = kind === "approve" || kind === "chore" || kind === "connect" ? colors.sage
    : kind === "deny" ? colors.coral
    : colors.ember;

  const flash = kind ? (
    <Modal transparent visible animationType="fade">
      <View style={st.flashWrap} pointerEvents="none">
        <FlashCircle color={color} icon={FLASH_ICON[kind]} />
      </View>
    </Modal>
  ) : null;

  return { flash, show };
}

function FlashCircle({ color, icon }: { color: string; icon: string }) {
  const scale = useSharedValue(0.4);
  useEffect(() => {
    scale.value = withTiming(1, { duration: 400, easing: EASE });
  }, [scale]);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[st.flashCircle, { backgroundColor: color }, a]}>
      <Sym name={icon} size={38} color="#FFFFFF" />
    </Animated.View>
  );
}

/** Full-width primary sheet CTA on the ink-navy hero gradient. */
export function SheetCTA({ title, onPress, disabled, danger }: { title: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const { colors } = useTheme();
  return (
    <PressableScale
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={{
        height: 52, borderRadius: 15, borderCurve: "continuous",
        alignItems: "center", justifyContent: "center",
        backgroundColor: danger ? colors.surfaceSunken : colors.hero2,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <T kind="bodyMedium" color={danger ? colors.coral : colors.heroText} style={{ fontWeight: "600" }}>{title}</T>
    </PressableScale>
  );
}

const st = StyleSheet.create({
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    borderTopLeftRadius: 28, borderTopRightRadius: 28, borderCurve: "continuous",
  },
  handle: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, opacity: 0.5 },
  /* A 5pt bar is not a drag target. The touchable area around it is, and it spans the full
   * width so the gesture is available from anywhere along the top edge — which is where a
   * thumb actually lands. */
  grabArea: { paddingTop: 8, paddingBottom: 6, alignItems: "center" },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 },
  headerSide: { width: 64 },
  flashWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  flashCircle: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" },
});
