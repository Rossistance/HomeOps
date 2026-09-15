// Where a swipe lands.
//
// "I want to just swipe across the screen to go from page to page."
//
// The gesture needs a device; this doesn't. What's worth pinning is the part that varies by
// ROLE — the tab bar is role-scoped, so a swipe derived from a hard-coded list would walk into
// a screen the person doesn't have a tab for. That bug is invisible on an Owner account, which
// is the account it would be tested on.
import test from "node:test";
import assert from "node:assert/strict";
import { tabsFor, neighbourTab, HOME } from "./tab-order.ts";

const owner = { canUseAI: true, viewMode: "owner" };
const child = { canUseAI: false, viewMode: "kid" };
const childWithAI = { canUseAI: true, viewMode: "kid" };

test("an adult swipes through all five tabs, in bar order", () => {
  assert.deepEqual(tabsFor(owner), ["/(home)", "/(ask)", "/(agents)", "/(library)", "/(settings)"]);
});

test("THE ROLE TRAP: a child has one tab, so a swipe goes nowhere rather than somewhere forbidden", () => {
  assert.deepEqual(tabsFor(child), [HOME]);
  assert.equal(neighbourTab(tabsFor(child), HOME, 1), null);
  assert.equal(neighbourTab(tabsFor(child), HOME, -1), null);
});

test("a child with AI enabled gains Ask, and only Ask", () => {
  assert.deepEqual(tabsFor(childWithAI), ["/(home)", "/(ask)"]);
  assert.equal(neighbourTab(tabsFor(childWithAI), "/(ask)", 1), null, "no Helpers tab means no Helpers stop");
});

test("no wrap-around at either end", () => {
  // Sliding off the end and reappearing at the other is disorienting, and the tab bar itself
  // doesn't do it.
  const t = tabsFor(owner);
  assert.equal(neighbourTab(t, HOME, -1), null);
  assert.equal(neighbourTab(t, "/(settings)", 1), null);
});

test("left and right go the directions they look like", () => {
  const t = tabsFor(owner);
  assert.equal(neighbourTab(t, "/(agents)", 1), "/(library)");
  assert.equal(neighbourTab(t, "/(agents)", -1), "/(ask)");
});

test("a tab this role doesn't have is not a starting point", () => {
  // Defensive: if a route somehow renders for a role whose bar excludes it, a swipe must not
  // pick an arbitrary neighbour out of a list the person isn't standing in.
  assert.equal(neighbourTab(tabsFor(child), "/(settings)", 1), null);
});
