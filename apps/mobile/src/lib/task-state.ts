// What counts as an open task.
//
// "After three days complete, they should drop into another category called archived. That
//  way the completed section will eventually entirely empty."
//
// Archiving added a fourth status to a codebase where three separate screens each spelled
// "open" as `status !== "done"`. Only one of them was taught the new word, so an archived
// task quietly reappeared in the OPEN lists — worse than not archiving at all, because the
// item comes back looking live. One predicate now, imported everywhere, so the next status
// has exactly one place to be handled.
import type { TaskRec } from "@/lib/api";

export const isDone = (t: Pick<TaskRec, "status">) => t.status === "done";
export const isArchived = (t: Pick<TaskRec, "status">) => t.status === "archived";
/** Live work: not finished, not filed away. */
export const isOpen = (t: Pick<TaskRec, "status">) => !isDone(t) && !isArchived(t);
