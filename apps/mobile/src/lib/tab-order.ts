// Which tab is next to this one.
//
// "I want to just swipe across the screen to go from page to page."
//
// Split from the gesture (components/TabSwipe) so it can be tested: the gesture itself needs a
// device, but WHERE a swipe lands is pure logic and it is role-dependent, which is exactly the
// kind of thing that looks right on the one account you happen to be testing with.
//
// The order is the order of the tabs THIS person has. A child with no Helpers tab must swipe
// from Today to whatever is actually next to it — deriving from the same capabilities the tab
// bar is built from is what stops a swipe landing on a screen the tab bar says you don't have.
import type { Capabilities } from "@/lib/roles";

export const HOME = "/(home)";

/** Mirrors TabsNav's trigger list. One derivation, so the bar and the swipe can't disagree. */
export function tabsFor(caps: Pick<Capabilities, "canUseAI" | "viewMode">): string[] {
  const t = [HOME];
  if (caps.canUseAI) t.push("/(ask)");
  if (caps.viewMode === "owner" || caps.viewMode === "adult") t.push("/(agents)", "/(library)", "/(settings)");
  return t;
}

/**
 * The tab a swipe should land on, or null if there isn't one.
 *
 * No wrap-around: sliding off the end of the tab bar and reappearing at the other end is
 * disorienting, and the tab bar itself doesn't behave that way. Null means "do nothing",
 * which is a better answer than teleporting someone somewhere they didn't ask to go.
 */
export function neighbourTab(tabs: string[], current: string, dir: -1 | 1): string | null {
  const i = tabs.indexOf(current);
  if (i === -1) return null; // a tab this role doesn't have — nothing sensible to move to
  return tabs[i + dir] ?? null;
}
