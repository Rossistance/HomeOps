// The walkthrough — the one decision measurement can't make for us.
//
// The engine's whole premise is that it points at real controls and skips whatever isn't there,
// so "scoped per user role" mostly needs no rules: a control an Adult Member can't see doesn't
// measure, and its step quietly isn't part of their tour.
//
// The exception is which LIST to walk. A child, grandparent or sitter gets a different screen —
// not the adult Today with pieces removed — so the spine's targets are absent rather than
// filtered. Hand them the spine and every step skips, the tour ends instantly, and "Show me
// around" is a button that does nothing. That's the failure this file exists to prevent.
import test from "node:test";
import assert from "node:assert/strict";
import { tourFor } from "./tour-steps.ts";

const targets = (mode) => tourFor(mode).map((s) => s.target);

test("an owner and an adult walk the full spine", () => {
  for (const mode of ["owner", "adult"]) {
    const t = targets(mode);
    assert.ok(t.includes("today.ask"), `${mode} should be shown the assistant`);
    assert.ok(t.includes("settings.household"), `${mode} should be shown the roster`);
    assert.ok(t.length >= 6, `${mode} tour is the long one`);
  }
});

test("a child, grandparent or sitter gets the SCOPED tour, not the spine", () => {
  for (const mode of ["child", "grandparent", "sitter"]) {
    const t = targets(mode);
    // The load-bearing assertion: not one target from the adult Today, because none of them
    // exist on these screens. If this ever passes with a today.* target in it, that role's
    // walkthrough is silently empty in production.
    assert.ok(!t.some((x) => x.startsWith("today.")), `${mode} must not be sent to adult Today targets`);
    assert.ok(t.includes("scoped.mine"), `${mode} needs at least one target that is on their screen`);
    assert.ok(t.length >= 1 && t.length <= 4, `${mode} tour stays short, like their screen`);
  }
});

test("an unknown view mode falls back to the scoped tour, not to nothing", () => {
  // Failing safe matters here: a role we don't recognise yet should get the small, always-there
  // tour rather than the spine, whose targets we can't promise exist for them.
  const t = targets("something-new");
  assert.ok(t.length > 0);
  assert.ok(!t.some((x) => x.startsWith("today.")));
});

test("every step names a target and says something", () => {
  for (const mode of ["owner", "child"]) {
    for (const s of tourFor(mode)) {
      assert.ok(s.target && s.target.length > 0, "a step with no target can never be shown");
      assert.ok(s.title && s.title.length > 0);
      // A bubble with a title and no body is a label, not an explanation.
      assert.ok(s.body && s.body.length > 20, `"${s.title}" needs a real explanation`);
      assert.ok(!s.place || s.place === "above" || s.place === "below");
    }
  }
});

test("both tours end where the tour can be restarted", () => {
  for (const mode of ["owner", "child"]) {
    const t = targets(mode);
    assert.equal(t[t.length - 1], "settings.tutorial",
      "the last thing you're shown should be how to see it again");
  }
});

test("no target is pointed at twice", () => {
  for (const mode of ["owner", "child"]) {
    const t = targets(mode);
    assert.equal(new Set(t).size, t.length, "a repeated target reads as the tour glitching");
  }
});
