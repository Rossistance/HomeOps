// Swipe from tab to tab.
//
// "I should be able to swipe from page to page left and right."
//
// The tab bar is a real UITabBar (expo-router's NativeTabs), which has no swipe of its own —
// UIKit doesn't page between tabs, and the usual workaround, wrapping everything in a pager,
// would fight the native bar and give up the thing that makes it feel like an iOS app. So the
// gesture is added on top: a decisive horizontal fling moves you to the neighbouring tab.
//
// THE HARD PART IS EVERYTHING IT MUST NOT BREAK. This app is full of horizontal scrollers — the
// member strip, the chat threads, the calendar's week — and a tab swipe that hijacks those would
// trade one nice gesture for several broken ones. Three rules keep them apart:
//
//   It only activates after 28pt of horizontal travel, so a scroll view (which claims a touch
//   within a few points) has already won by the time this would wake up.
//
//   It fails outright on 18pt of vertical travel, so reading a long screen never drifts sideways
//   into another tab.
//
//   It needs real intent to commit — 40% of the screen's width, or a genuine fling. A lazy drag
//   does nothing rather than teleporting you somewhere you didn't ask to go.
//
// And it stands down entirely on a pushed screen. There, a horizontal swipe already means
// something better: GO BACK. Both gestures were asked for in the same breath ("swipe from page
// to page… and when there's a menu that pops up, like on calendars looking at the detail, I
// should be able to swipe to go back"), and they'd have been fighting over the same drag —
// worst case leaving you a tab across AND a screen back from one flick.
//
// The order it walks is the order of the tabs THIS person has. A child with no Agents tab swipes
// from Today straight to whatever is actually next to it, because the list is derived from the
// same capabilities the tab bar is built from rather than hard-coded.
import { useMemo, type ReactNode } from "react";
import { Dimensions, View } from "react-native";
import { router } from "expo-router";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";
import { useSession } from "@/lib/session";
import { capabilitiesFor } from "@/lib/roles";
import { tapHaptic } from "@/theme";

/** Movement needed before this gesture is even in the running. */
const ACTIVATE_X = 28;
/** Vertical movement that disqualifies it — this is a scroll, not a page turn. */
const FAIL_Y = 18;
/** Commit thresholds: a long drag (a share of the screen's width), or a short fast one. */
const COMMIT_RATIO = 0.4;
const COMMIT_VELOCITY = 550;

export function TabSwipe({ current, children }: { current: string; children: ReactNode }) {
  const { session } = useSession();
  const caps = useMemo(() => capabilitiesFor(session ? { role: session.role } : null), [session]);

  // Mirrors TabsNav's trigger list. Derived from the same capabilities, so a role that has no
  // Agents tab has no Agents stop on the swipe either — the alternative is swiping into a screen
  // the tab bar says you don't have.
  const tabs = useMemo(() => {
    const t = ["/(home)"];
    if (caps.canUseAI) t.push("/(ask)");
    if (caps.viewMode === "owner" || caps.viewMode === "adult") t.push("/(agents)", "/(library)", "/(settings)");
    return t;
  }, [caps.canUseAI, caps.viewMode]);

  const goTo = (dir: -1 | 1) => {
    /* Deeper than the root of this tab? Then a horizontal swipe belongs to the back gesture,
     * and this one has no business firing. Checked at the moment of the swipe rather than
     * subscribed to, because navigation state changes far more often than anyone swipes. */
    if (router.canGoBack()) return;
    const i = tabs.indexOf(current);
    if (i === -1) return;
    const next = tabs[i + dir];
    // No wrap-around. Sliding off the end of the tab bar and reappearing at the other end is
    // disorienting, and the tab bar itself doesn't behave that way.
    if (!next) return;
    tapHaptic("select");
    router.navigate(next as never);
  };

  const pan = useMemo(
    () => Gesture.Pan()
      .activeOffsetX([-ACTIVATE_X, ACTIVATE_X])
      .failOffsetY([-FAIL_Y, FAIL_Y])
      .onEnd((e) => {
        // A share of the width, not a fixed number of points: the same drag should mean the
        // same thing on a mini and on a Pro Max.
        const far = Math.abs(e.translationX) > Dimensions.get("window").width * COMMIT_RATIO;
        const fast = Math.abs(e.velocityX) > COMMIT_VELOCITY && Math.abs(e.translationX) > 60;
        if (!far && !fast) return;
        runOnJS(goTo)(e.translationX < 0 ? 1 : -1);
      }),
    // goTo closes over `tabs` and `current`; rebuilding the gesture when either changes keeps
    // the swipe pointing at the right neighbour after a role or route change.
    [tabs, current], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <GestureDetector gesture={pan}>
      <View style={{ flex: 1 }} collapsable={false}>{children}</View>
    </GestureDetector>
  );
}
