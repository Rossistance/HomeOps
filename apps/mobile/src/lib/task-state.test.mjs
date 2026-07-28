// "Open" has to mean the same thing on every screen.
//
// Archiving added a fourth task status to a codebase where three screens each spelled open
// as `status !== "done"`. Only one learned the new word, so an archived task reappeared in
// the OPEN lists — worse than never archiving, because it comes back looking live. This
// pins the predicate; the screens import it rather than re-deriving it.
import test from "node:test";
import assert from "node:assert/strict";
import { isOpen, isDone, isArchived } from "./task-state.ts";

test("open means live work — not finished, not filed away", () => {
  assert.equal(isOpen({ status: "todo" }), true);
  assert.equal(isOpen({ status: "in_progress" }), true);
  assert.equal(isOpen({ status: "done" }), false);
  assert.equal(isOpen({ status: "archived" }), false, "THE BUG: archived used to read as open");
});

test("done and archived are distinct — the Completed drawer must still empty", () => {
  assert.equal(isDone({ status: "done" }), true);
  assert.equal(isDone({ status: "archived" }), false, "an archived task has LEFT Completed");
  assert.equal(isArchived({ status: "archived" }), true);
});

test("an unknown future status is treated as open, not silently hidden", () => {
  // Failing the other way would make a task vanish from every list at once — the worst
  // possible default for something a family is relying on.
  assert.equal(isOpen({ status: "snoozed" }), true);
});
