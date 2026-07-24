// WP-106 / ISS-112 — one canonical answer to "which tasks does this surface show, and
// where does a given task actually live?"
//
// The defect: household tasks are partitioned by `type`, and every surface filtered
// differently. The Dashboard's overdue count filtered by status+due date and NOTHING
// else, so a grocery item (type:"list") counted toward "Needs you" — while the Chore
// Board excludes type:"list" by design and the grocery view filters by listName. The
// count said items existed; no reachable list contained them, and the overdue rows
// weren't even clickable. "Dashboard implies pending groceries; Shared Grocery List
// shows none."
//
// So the rule this module encodes is not "one filter for everything" — the partitioning
// is deliberate — but: a count and the list it points at must come from the SAME query,
// and anything counted must name the surface that can show it.
import type { ScreenId, Task } from "@/types";

/** The Chore Board is the general task surface. Bills keep the Budget Snapshot and list
 *  items keep their grocery/packing views, so both are excluded to avoid duplicate homes.
 *  (Moved here from src/miniapps/index.tsx so the board's own definition and every count
 *  that claims to describe the board read the same set.) */
export const BOARD_TASK_TYPES: ReadonlySet<string> = new Set(["chore", "task", "reminder", "errand"]);

export const GROCERY_LIST_NAME = "Groceries";

type TaskLike = Pick<Task, "type" | "status"> & { listName?: string | null };

/** A list item with no explicit list belongs to Groceries — the same default the grocery
 *  view applies, kept in one place so the two can't disagree about what "unnamed" means. */
export const listNameOf = (t: TaskLike): string => t.listName ?? GROCERY_LIST_NAME;
export const isListItem = (t: TaskLike): boolean => t.type === "list";
export const isBoardTask = (t: TaskLike): boolean => BOARD_TASK_TYPES.has(t.type);

/** Every item on a named list, done or not — what the list VIEW renders. */
export function listItems<T extends TaskLike>(tasks: readonly T[], listName: string = GROCERY_LIST_NAME): T[] {
  return tasks.filter((t) => isListItem(t) && listNameOf(t) === listName);
}
/** The still-outstanding subset — what a COUNT of that list should report. */
export function openListItems<T extends TaskLike>(tasks: readonly T[], listName: string = GROCERY_LIST_NAME): T[] {
  return listItems(tasks, listName).filter((t) => t.status !== "done");
}
/** Everything the Chore Board renders. */
export function boardTasks<T extends TaskLike>(tasks: readonly T[]): T[] {
  return tasks.filter(isBoardTask);
}

/**
 * The surface that can actually show this task. A count spanning several types (the
 * Dashboard's overdue list is the live example) must route PER ITEM — sending a grocery
 * item to the Chore Board lands on a view that structurally cannot contain it.
 *
 * Returns null when nothing can display it, which is a real state worth surfacing rather
 * than papering over with a link that goes somewhere wrong.
 */
export function surfaceForTask(t: TaskLike): { screen: ScreenId; params?: Record<string, string> } | null {
  // Groceries render inline on the Meals screen (no tab param — checked, not assumed).
  if (isListItem(t)) return { screen: "meals" };
  // The Chore Board and Budget Snapshot are MINI-APPS, not screens of their own. The
  // specific mini-app id is per-household data, so a pure module can't name it; landing
  // on the surface that hosts them is honest, and callers holding the store may refine it.
  if (isBoardTask(t) || t.type === "bill") return { screen: "miniapps" };
  return null;
}
