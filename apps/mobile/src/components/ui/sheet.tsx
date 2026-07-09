// Bottom sheet per handoff: surface bg, 28px top radius, drag handle, header
// with accent Close/Cancel left + 15/650 centered title, 0.4 backdrop, springy
// translateY. ConfirmFlash: an 84px circle that pops center-screen for 0.8s
// after a decisive action (check=success, x=danger, everything else=accent).
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme, tapHaptic } from "@/theme";
import { T } from "./text";
import { Sym } from "./symbol";
import { PressableScale } from "./pressable-scale";

const EASE = Easing.bezier(0.22, 1, 0.36, 1);

export function HSheet({ visible, onClose, title, leftLabel = "Close", heightPct = 0.84, children, footer }: {
  visible: boolean;
  onClose: () => void;
  title: string;
  leftLabel?: string;
  heightPct?: number;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { colors, spacing } = useTheme();
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheetH = Math.round(winH * heightPct);

  const [mounted, setMounted] = useState(visible);
  const y = useSharedValue(sheetH);
  const backdrop = useSharedValue(0);

  const unmount = useCallback(() => setMounted(false), []);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      y.value = withTiming(0, { duration: 380, easing: EASE });
      backdrop.value = withTiming(0.4, { duration: 300 });
    } else if (mounted) {
      backdrop.value = withTiming(0, { duration: 260 });
      y.value = withTiming(sheetH, { duration: 300, easing: EASE }, (done) => {
        if (done) runOnJS(unmount)();
      });
    }
  }, [visible, mounted, sheetH, y, backdrop, unmount]);

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
            { height: sheetH, backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 12) },
          ]}
        >
          <View style={[st.handle, { backgroundColor: colors.textFaint }]} />
          <View style={[st.header, { paddingHorizontal: spacing.xl }]}>
            <Pressable onPress={onClose} hitSlop={10} style={st.headerSide}>
              <T kind="bodyMedium" color={colors.ember}>{leftLabel}</T>
            </Pressable>
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

export type FlashKind = "approve" | "deny" | "run" | "agent" | "upload" | "send" | "connect" | "chore" | null;

const FLASH_ICON: Record<Exclude<FlashKind, null>, string> = {
  approve: "checkmark", deny: "xmark", run: "play.fill", agent: "cpu",
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
  handle: { alignSelf: "center", width: 36, height: 5, borderRadius: 3, marginTop: 8, opacity: 0.5 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12 },
  headerSide: { width: 64 },
  flashWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  flashCircle: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center" },
});
