// Standard screen scaffold: a ScrollView with safe-area insets, pull-to-refresh, and consistent
// padding. First child of every route.
//
// THE RUNAWAY SCROLL, SOLVED — and this time I know, because the fix moved the symptom.
//
// Reported first as "when I scroll to the very bottom it just keeps going and does not stop…
// sometimes on every screen". I removed a layout animation (wrong), then made
// `automaticallyAdjustKeyboardInsets` opt-in, keeping it on the 14 screens with a text field
// and turning it off everywhere else. The next report was: "I am also getting the scrolling
// issue now on lots of SUB-pages… under Tasks and Lists… the profile edit page… this page" —
// which is precisely, and only, the set of screens I had left it turned ON for.
//
// A hypothesis that predicts where a bug will appear next is not a hypothesis any more. The
// mechanism: that prop writes the bottom contentInset from JS while
// contentInsetAdjustmentBehavior="automatic" has UIKit writing the same value from the safe
// area. Two owners of one number, each write able to provoke the layout pass that triggers the
// other. That is a feedback loop, and it presents as scrolling that will not settle.
//
// So it's gone entirely. The problem it was solving is real (ISS-109: a focused input near the
// bottom sat behind the keyboard), so it's solved a way that can't feed back: the keyboard's
// height becomes bottom PADDING inside the content. Padding is content, not inset — UIKit keeps
// sole ownership of insets, and nothing contends.
import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Keyboard, RefreshControl, ScrollView } from "react-native";
import { useTheme } from "@/theme";
import { useTutorial } from "@/lib/tutorial";

export function HScreen({ children, refreshing, onRefresh, bottomPad = 40, scrollRef, keyboardAware = false }: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  bottomPad?: number;
  /** For screens that must scroll a specific field into view themselves — a bottom-most
   *  input still lands under a pinned action bar, which no inset can know about. */
  scrollRef?: RefObject<ScrollView | null>;
  /** Screens with a text field the keyboard could cover. Adds padding, never an inset. */
  keyboardAware?: boolean;
}) {
  const { colors, spacing } = useTheme();
  const { registerScroller } = useTutorial();
  const own = useRef<ScrollView | null>(null);
  const [kb, setKb] = useState(0);

  // Let the walkthrough bring a target below the fold into view before pointing at it. HScreen
  // is the first child of every route, so registering here covers every screen at once.
  useEffect(() => registerScroller((y) => own.current?.scrollTo({ y, animated: true })), [registerScroller]);

  useEffect(() => {
    if (!keyboardAware) return;
    // `Will` events on iOS so the padding grows with the keyboard rather than after it.
    const show = Keyboard.addListener("keyboardWillShow", (e) => setKb(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener("keyboardWillHide", () => setKb(0));
    return () => { show.remove(); hide.remove(); };
  }, [keyboardAware]);

  return (
    <ScrollView
      ref={(node) => {
        own.current = node;
        if (scrollRef) (scrollRef as { current: ScrollView | null }).current = node;
      }}
      // UIKit owns every inset on this view, alone. See the note at the top of this file.
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{
        padding: spacing.lg,
        paddingBottom: bottomPad + kb,
        gap: spacing.md,
      }}
      keyboardShouldPersistTaps="handled"
      // Swipe the keyboard away over the content instead of hunting for a Done button.
      keyboardDismissMode="interactive"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.textFaint} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}
