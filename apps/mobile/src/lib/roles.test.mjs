// Theme S — an adult grandparent is an adult.
//
// [v2 00:23] "On an adult member profile like my dad GPop… there is no calendar setup, no
//            settings for them, they can't get to connectors to add their email and calendar."
// [v2 00:37] "They can't see a proper calendar. All they see is this."
// [v2 01:11] "I do not see the tasks and lists centre here."
//
// None of that was a permission problem — the server already grants all of it. It was ROUTING:
// relationship outranked role, so an Adult Member who happens to be a grandparent was handed
// the reduced grandparent home, which has no Settings, Helpers or Library tab at all.
//
// The one thing relationship must STILL outrank is a child, and that case is here too.
import test from "node:test";
import assert from "node:assert/strict";
import { viewModeFor, capabilitiesFor } from "./roles.ts";

const gpop = { role: "Adult Member", relationship: "Grandparent" };
const beannie = { role: "Adult Member", relationship: "Grandmother / caregiving contact" };
const sitter = { role: "Guest/Helper", relationship: "Babysitter" };
const grandparentGuest = { role: "Guest/Helper", relationship: "Grandparent" };
const kid = { role: "Child View", relationship: "Child (age 9)" };
const kidOverGranted = { role: "Adult Member", relationship: "Child (age 9)" };

test("THE FIX: an Adult Member who is a grandparent gets the full adult app", () => {
  assert.equal(viewModeFor(gpop), "adult");
  assert.equal(viewModeFor(beannie), "adult");
});

test("…which is what unlocks the tabs he couldn't find", () => {
  // app/_layout.tsx: fullNav = viewMode === "adult" || viewMode === "owner". That single
  // boolean is Settings, Helpers and Library — i.e. connections, their calendar, their tasks.
  for (const m of [gpop, beannie]) {
    const mode = viewModeFor(m);
    assert.ok(mode === "adult" || mode === "owner", "must reach the full tab set");
  }
});

test("an adult member can create their OWN helper — the client gate matched the server", () => {
  // The server already allowed this (the silo). The app was hiding a screen that would work.
  assert.equal(capabilitiesFor(gpop).canCreateHelpers, true);
  assert.equal(capabilitiesFor(gpop).canConnect, true, "their own email and calendar");
  assert.equal(capabilitiesFor(gpop).canEditCalendar, true, "their own schedule");
});

test("the calm homes remain for people who genuinely have limited standing", () => {
  assert.equal(viewModeFor(sitter), "sitter");
  assert.equal(viewModeFor(grandparentGuest), "grandparent");
  assert.equal(capabilitiesFor(sitter).canCreateHelpers, false);
});

test("A CHILD IS STILL A CHILD — relationship outranks an over-generous role", () => {
  assert.equal(viewModeFor(kid), "child");
  assert.equal(viewModeFor(kidOverGranted), "child",
    "granting a nine-year-old Adult Member must not hand them the adult app");
  assert.equal(capabilitiesFor(kidOverGranted).canUseAI, false, "and AI still needs enabling");
});

test("the Owner is unchanged", () => {
  assert.equal(viewModeFor({ role: "Owner", relationship: "Parent" }), "owner");
  assert.equal(capabilitiesFor({ role: "Owner" }).canManage, true);
});
