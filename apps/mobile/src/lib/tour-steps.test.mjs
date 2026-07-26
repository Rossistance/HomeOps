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
import { CHAPTERS, chapterFor, tourFor } from "./tour-steps.ts";

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

/* ------------------------------ per-screen chapters ------------------------------ */

test("a chapter exists only for routes that have one, and never guesses", () => {
  assert.equal(chapterFor("/(ask)")?.label, "Asking Famili");
  // The button renders off this answer, so a false positive is a control that does nothing.
  assert.equal(chapterFor("/nowhere"), null);
  assert.equal(chapterFor(""), null);
});

test("a chapter never navigates — it describes the screen you're already on", () => {
  for (const [route, c] of Object.entries(CHAPTERS)) {
    for (const s of c.steps) {
      assert.equal(s.route, undefined,
        `${route}: a chapter step with a route would walk you off the screen it's explaining`);
    }
  }
});

test("every chapter step points at a target on its own screen", () => {
  // The prefix convention is what keeps a chapter honest: /(ask) steps target ask.*, so a
  // copy-paste from another chapter is visible here rather than at runtime as a skipped step.
  const prefix = { "/(ask)": "ask.", "/calendar": "calendar.", "/tasks": "tasks." };
  for (const [route, c] of Object.entries(CHAPTERS)) {
    for (const s of c.steps) {
      assert.ok(s.target.startsWith(prefix[route]), `${route}: "${s.target}" belongs to another screen`);
    }
  }
});

test("every chapter is short, labelled, and says something real", () => {
  for (const [route, c] of Object.entries(CHAPTERS)) {
    assert.ok(c.label && c.label.length > 0, `${route} needs a label`);
    assert.ok(c.steps.length >= 1 && c.steps.length <= 5, `${route}: a chapter is a look around, not a manual`);
    for (const s of c.steps) {
      assert.ok(s.title && s.body && s.body.length > 20, `${route}: "${s.title}" needs a real explanation`);
    }
    assert.equal(new Set(c.steps.map((s) => s.target)).size, c.steps.length, `${route}: repeated target`);
  }
});
