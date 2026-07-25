// Standard screen scaffold: ScrollView with automatic safe-area insets,
// pull-to-refresh, and consistent content padding. First child of every route.
import type { ReactNode, RefObject } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { useTheme } from "@/theme";

export function HScreen({ children, refreshing, onRefresh, bottomPad = 40, scrollRef }: {
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  bottomPad?: number;
  /** For screens that must scroll a specific field into view themselves — a bottom-most
   *  input still lands under the pinned action bar, which the keyboard inset can't know
   *  about. See C3 in the event form ("what to bring"). */
  scrollRef?: RefObject<ScrollView | null>;
}) {
  const { colors, spacing } = useTheme();
  return (
    <ScrollView
      ref={scrollRef}
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: bottomPad, gap: spacing.md }}
      keyboardShouldPersistTaps="handled"
      // ISS-109: "None of it wraps, I can't read any of it… same for every single page."
      // The keyboard half of that was this scroll view: RN defaults
      // automaticallyAdjustKeyboardInsets to FALSE, so a focused input near the bottom of
      // any screen sat behind the keyboard with no way to scroll to it. HScreen is the
      // first child of every route, so enabling it here fixes every form at once — iOS
      // adjusts contentInset/scrollIndicatorInsets and keeps the focused field visible.
      automaticallyAdjustKeyboardInsets
      // Swipe the keyboard away over the content instead of hunting for a Done button.
      keyboardDismissMode="interactive"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.textFaint} /> : undefined}
    >
      {children}
    </ScrollView>
  );
}
