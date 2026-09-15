// How much room the floating tab bar takes, and why anyone has to say so.
//
// Reported from TestFlight: on Today, "Nothing on the calendar today" and the THIS WEEK
// heading sat cut off behind the tab bar. Scrolling to the end of the list did not reveal
// them — the content simply ended underneath the bar.
//
// The assumption in the code was that iOS would handle it: HScreen sets
// `contentInsetAdjustmentBehavior="automatic"`, and a UITabBar normally contributes its own
// height to a scroll view's bottom inset. That holds when the scroll view belongs to a view
// controller the tab bar controller owns directly. Here it does not: every screen is a
// react-native-screens view inside a Stack inside a NativeTabs tab, and the floating iOS 26
// bar overlays the content rather than shortening it. The inset arrives as the safe-area
// inset alone — which is the home indicator, not the bar sitting above it.
//
// And expo-router's NativeTabs exposes no useBottomTabBarHeight(), so there is nothing to
// ask. A measured number would be better than a constant; in its absence a constant that is
// slightly generous is much better than content you cannot read. Over-clearing costs a few
// points of empty scroll at the bottom of a list. Under-clearing costs the last card.
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** The bar itself, above the home indicator. iOS 26's floating bar is ~49pt of control in a
 *  ~56pt capsule; this is the capsule, because the capsule is what draws over the content. */
export const FLOATING_TAB_BAR_HEIGHT = 56;

/**
 * Bottom clearance for anything that must stay out from under the tab bar: the bar plus the
 * safe-area inset it floats above.
 *
 * Use it as PADDING inside scrolling content, never as a contentInset — HScreen documents at
 * length why insets on these scroll views have exactly one owner (UIKit) and why a second
 * writer turns into a layout feedback loop. Padding is content; nothing contends for it.
 */
export function useTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return FLOATING_TAB_BAR_HEIGHT + insets.bottom;
}
