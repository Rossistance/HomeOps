// Standard screen scaffold: ScrollView with automatic safe-area insets,
// pull-to-refresh, and consistent content padding. First child of every route.
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { useTheme } from "@/theme";
import { useTutorial } from "@/lib/tutorial";

export function HScreen({ children, refreshing, onRefresh, bottomPad = 40, scrollRef, keyboardAware = false }: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  bottomPad?: number;
  /** Set on screens with a text input the keyboard could cover. See the note below — it is
   *  deliberately NOT the default. */
  keyboardAware?: boolean;
  /** For screens that must scroll a specific field into view themselves — a bottom-most
   *  input still lands under the pinned action bar, which the keyboard inset can't know
   *  about. See C3 in the event form ("what to bring"). */
  scrollRef?: RefObject<ScrollView | null>;
}) {
  const { colors, spacing } = useTheme();
  const { registerScroller } = useTutorial();
  const own = useRef<ScrollView | null>(null);
  // Let the walkthrough bring a target below the fold into view before it points at it. HScreen
  // is the first child of every route, so registering here covers every screen at once.
  useEffect(() => registerScroller((y) => own.current?.scrollTo({ y, animated: true })), [registerScroller]);
  return (
    <ScrollView
      ref={(node) => {
        own.current = node;
        if (scrollRef) (scrollRef as { current: ScrollView | null }).current = node;
      }}
      // UIKit owns the top/nav inset — it's the only thing that knows whether this screen sits
      // under a navigation header, and getting that wrong pushes every screen down by 50pt.
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomPad, gap: spacing.md }}
      keyboardShouldPersistTaps="handled"
      /* SECOND ATTEMPT at the runaway scroll — "when I scroll to the very bottom, sometimes it
       * just keeps going and it does not stop… on every screen." Removing Rise's layout
       * animation didn't fix it, so this is the next structural suspect.
       *
       * This was on unconditionally. It writes the bottom contentInset from JS while
       * contentInsetAdjustmentBehavior="automatic" has UIKit writing the same value from the
       * safe area — two owners of one number, where each write can provoke the layout pass that
       * triggers the other. That is the shape of a loop that presents as scrolling which won't
       * settle, and it was on EVERY screen, which matches what he described.
       *
       * It stays where it was actually needed (ISS-109: a focused input near the bottom of a
       * form sat behind the keyboard), but as something a screen asks for. A list with no text
       * input never needed it and now doesn't have it.
       *
       * Honest: still not reproduced on demand. This is a second suspect removed from the
       * screens where it can't be doing any good, not a fix I have watched work. */
      automaticallyAdjustKeyboardInsets={keyboardAware}
      // Swipe the keyboard away over the content instead of hunting for a Done button.
      keyboardDismissMode="interactive"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.textFaint} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}
