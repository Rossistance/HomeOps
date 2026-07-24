// Selector parity suite for WP-106 / ISS-112 — run with:
//   node --test src/lib/taskSurfaces.test.mjs
// (node strips types from the imported .ts natively; this module has no browser imports)
//
// The defect: household tasks are partitioned by `type`, and each surface filtered
// differently. The Dashboard's overdue count filtered on status + due date and nothing
// else, so a grocery item (type:"list") counted toward "Needs you" — while the Chore
// Board excludes type:"list" by design and the grocery view filters by listName. The
// count insisted items existed; no reachable list contained them.
//
// These lock the contract: a count and the list it points at come from the SAME query,
// and anything counted names a surface that can actually show it.
import test from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_TASK_TYPES, GROCERY_LIST_NAME, listNameOf, isListItem, isBoardTask,
  listItems, openListItems, boardTasks, surfaceForTask,
} from "./taskSurfaces.ts";

const t = (over = {}) => ({ id: "t1", type: "task", status: "todo", ...over });

const HOUSEHOLD = [
  t({ id: "chore", type: "chore" }),
  t({ id: "task", type: "task" }),
  t({ id: "reminder", type: "reminder" }),
  t({ id: "errand", type: "errand" }),
  t({ id: "bill", type: "bill" }),
  t({ id: "milk", type: "list" }),                                  // unnamed ⇒ Groceries
  t({ id: "eggs", type: "list", listName: "Groceries" }),
  t({ id: "eggs-done", type: "list", listName: "Groceries", status: "done" }),
  t({ id: "sunscreen", type: "list", listName: "Packing" }),
];

test("an unnamed list item defaults to Groceries — one definition, not one per surface", () => {
  assert.equal(listNameOf(t({ type: "list" })), GROCERY_LIST_NAME);
  assert.equal(listNameOf(t({ type: "list", listName: "Packing" })), "Packing");
  assert.ok(listItems(HOUSEHOLD).some((x) => x.id === "milk"), "the unnamed item lands on Groceries");
});

test("the board and the lists partition the household — no task has two homes, none has none", () => {
  const board = new Set(boardTasks(HOUSEHOLD).map((x) => x.id));
  const lists = new Set(HOUSEHOLD.filter(isListItem).map((x) => x.id));
  for (const id of board) assert.ok(!lists.has(id), `${id} cannot be on the board AND a list`);
  assert.ok(!board.has("bill"), "bills keep the Budget Snapshot, not the board");
  assert.ok(!board.has("milk"), "list items keep their grocery view — the ISS-112 exclusion");
  assert.deepEqual([...board].sort(), ["chore", "errand", "reminder", "task"]);
});

test("PARITY: the grocery count and the grocery list come from the same query", () => {
  // The reported symptom in one assertion: a count that reports items a list can't show.
  const listed = listItems(HOUSEHOLD);                  // what the view renders
  const counted = openListItems(HOUSEHOLD);             // what a badge reports
  assert.ok(counted.every((c) => listed.some((l) => l.id === c.id)),
    "every counted item is present in the list it points at");
  assert.equal(listed.length, 3, "milk + eggs + the done one");
  assert.equal(counted.length, 2, "the count reports only what's outstanding");
});

test("PARITY: a named list never borrows another list's items", () => {
  assert.deepEqual(listItems(HOUSEHOLD, "Packing").map((x) => x.id), ["sunscreen"]);
  assert.ok(!listItems(HOUSEHOLD, "Packing").some((x) => x.id === "milk"));
});

test("ISS-112: every task type names a surface that can actually show it", () => {
  // The core rule. A count spanning types must route PER ITEM — sending a grocery item
  // to the Chore Board lands on a view that structurally cannot contain it.
  assert.deepEqual(surfaceForTask(t({ type: "list" })), { screen: "meals" });
  assert.deepEqual(surfaceForTask(t({ type: "chore" })), { screen: "miniapps" });
  assert.deepEqual(surfaceForTask(t({ type: "bill" })), { screen: "miniapps" });
  for (const task of HOUSEHOLD) {
    assert.ok(surfaceForTask(task), `${task.id} (${task.type}) must have somewhere to be seen`);
  }
});

test("ISS-112: a grocery item is NEVER routed to the board that excludes it", () => {
  const grocery = t({ type: "list" });
  assert.ok(!isBoardTask(grocery), "the board excludes it…");
  assert.notEqual(surfaceForTask(grocery).screen, "miniapps", "…so it must not be sent there");
});

test("an unknown type reports NO surface rather than a link that goes somewhere wrong", () => {
  assert.equal(surfaceForTask(t({ type: "wat" })), null);
  assert.ok(!BOARD_TASK_TYPES.has("wat"));
});
