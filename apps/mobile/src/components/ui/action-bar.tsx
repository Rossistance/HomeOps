// The control that commits your work never hides behind the keyboard.
//
// Theme C of the 2026-07-25 walkthrough is one complaint, sighted six times. The sharpest is
// [15:03], adding an event: "Save is not visible at all — you can't even see it. That's
// crucial." And [13:48], editing one: "Save changes should be closer to the text entry."
//
// HScreen adds the keyboard's height as bottom PADDING (never an inset — see screen.tsx),
// which keeps the focused FIELD
// visible. It does nothing for a Save button that lives at the bottom of the scrolled
// content — that button just scrolls with everything else, behind the keyboard, and the
// family has to dismiss the keyboard to find out whether the form can even be submitted.
//
// So the commit control stops being content. It sits in a bar pinned to the bottom of the
// screen that rides the keyboard up, which also answers "closer to the text entry": when the
// keyboard is up, Save is directly above it.
import { useEffect, useState, type ReactNode } from "react";
import { Keyboard, Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/theme";

/** Height to reserve at the bottom of the scrolling content so the bar never covers it. */
export const ACTION_BAR_HEIGHT = 76;

/**
 * Live keyboard height. `keyboardWillShow` on iOS so the bar moves WITH the keyboard rather
 * than snapping after it; `keyboardDidShow` elsewhere, which is the only event Android sends.
 */
export function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const showEv = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEv = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const s = Keyboard.addListener(showEv, (e) => setH(e.endCoordinates?.height ?? 0));
    const hi = Keyboard.addListener(hideEv, () => setH(0));
    return () => { s.remove(); hi.remove(); };
  }, []);
  return h;
}

export function ActionBar({ children }: { children: ReactNode }) {
  const { colors, spacing } = useTheme();
  const insets = useSafeAreaInsets();
  const kb = useKeyboardHeight();
  return (
    <View
      style={{
        position: "absolute", left: 0, right: 0,
        // With the keyboard up the home indicator is covered by it, so the safe-area inset
        // would double-count as a gap between the bar and the keys.
        bottom: kb > 0 ? kb : 0,
        paddingBottom: kb > 0 ? spacing.sm : Math.max(insets.bottom, spacing.sm),
        paddingTop: spacing.sm,
        paddingHorizontal: spacing.lg,
        gap: 6,
        backgroundColor: colors.bg,
        borderTopWidth: StyleSheet.hairlineWidth,
        borderTopColor: colors.border,
      }}
    >
      {children}
    </View>
  );
}
