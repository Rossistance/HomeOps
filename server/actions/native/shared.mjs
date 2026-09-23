// What the native famili.* tools share (ADR-004 Stage 1). Moved here, verbatim, from
// assistant-agent.mjs when the sixteen tools became declared actions in this directory:
// the model's input hints, the compact projections a model reads, the range helpers, the
// read-only refusal, and the per-turn scope every body derives from its ctx.
//
// A LEAF, like the registry that imports these files: store, auth and nothing that reaches
// context.mjs, internal-functions.mjs or assistant-agent.mjs. assistant-agent.mjs imports
// KEY_HINTS and short() back from here.
import { listMembers, canSeeEntityInChannel } from "../../store.mjs";
import { roleAtLeast } from "../../auth.mjs";

/* The model's input hints by key name. The catalog's hand-written tools get their types and
 * meaning from this table (assistant-agent.mjs propFor), and the native schemas embed the
 * same entries by reference, so a hint changes in one place for both. */
export const KEY_HINTS = {
  title: { type: "string", description: "Short human title." },
  text: { type: "string", description: "The text." },
  body: { type: "string", description: "Full message body, ready to send." },
  subject: { type: "string", description: "Subject line." },
  notes: { type: "string", description: "Free-form notes." },
  detail: { type: "string" },
  startAt: { type: "string", description: "Start date-time, ISO 8601 with the household's UTC offset, e.g. 2026-09-14T17:00:00-04:00. For an all-day item use the date only (YYYY-MM-DD)." },
  endAt: { type: "string", description: "End date-time, same format as startAt. Omit if unknown." },
  dueAt: { type: "string", description: "Due date-time, ISO 8601 with the household's UTC offset (or YYYY-MM-DD)." },
  date: { type: "string", description: "Calendar date, YYYY-MM-DD." },
  time: { type: "string", description: "Time of day, 24-hour HH:MM." },
  slot: { type: "string", enum: ["breakfast", "lunch", "dinner", "snack"] },
  location: { type: "string" },
  eventId: { type: "string", description: "The event's id (starts with ev_). Look it up with famili__list_events first." },
  taskId: { type: "string", description: "The task's id (starts with tk_ or li_). Look it up with famili__list_tasks first." },
  agentId: { type: "string", description: "The helper's id (from famili context existingAgents or famili__list_helpers)." },
  fileId: { type: "string", description: "The attached file's id (context.attachedFileId)." },
  question: { type: "string" },
  assignedMemberId: { type: "string", description: "A member id from the household roster (famili__list_members)." },
  driverId: { type: "string", description: "A member id from the household roster." },
  participantIds: { type: "array", items: { type: "string" }, description: "Member ids from the household roster." },
  items: { type: "array", items: { type: "string" }, description: "One entry per item." },
  ingredients: { type: "array", items: { type: "string" }, description: "Full ingredient list, one entry per ingredient with quantity." },
  instructions: { type: "array", items: { type: "string" }, description: "Step-by-step cooking instructions, one step per entry." },
  whatToBring: { type: "array", items: { type: "string" } },
  recipeUrl: { type: "string", description: "Source recipe URL, if any." },
  servings: { type: "number", description: "Number of servings — size to the household." },
  replace: { type: "boolean", description: "true to replace whatever is already planned in that slot (only when the family said so)." },
  visibility: { type: "string", enum: ["household", "personal", "adults", "private"], description: "Who can see it. Default household." },
  priority: { type: "string", enum: ["low", "medium", "high"] },
  remindMinutesBefore: { type: "number", enum: [0, 5, 10, 15, 30, 60, 1440], description: "Reminder lead in minutes before the task's time: 0 (at the time), 5, 10, 15, 30, 60 or 1440 (the day before). Needs a dueAt to count back from. This is what actually sends a push — priority alone does not." },
  type: { type: "string", description: "Kind of task: task, chore, bill, errand… Default task." },
  listName: { type: "string", description: "Which list (Groceries, Shopping, Packing…)." },
  scope: { type: "string", enum: ["household", "personal"], description: "household = everyone can use it later; personal = only the person who said it." },
  kind: { type: "string" },
  to: { type: "string", description: "Recipient address or phone number, exactly as the family gave it." },
  methodId: { type: "string", description: "A verified contact-method id, when known." },
  channel: { type: "string" },
  query: { type: "string", description: "Plain-English search text." },
  url: { type: "string", description: "A full http(s) URL." },
  lat: { type: "number" },
  lng: { type: "number" },
  limit: { type: "number" },
  name: { type: "string" },
  purpose: { type: "string" },
  status: { type: "string" },
  runUnattended: { type: "boolean" },
  includeSendAndSpend: { type: "boolean" },
  note: { type: "string" },
  fileRef: { type: "string" },
  path: { type: "string" },
};

export const short =(v, n = 160) => { const s = typeof v === "string" ? v : JSON.stringify(v ?? ""); return s.length > n ? s.slice(0, n) + "…" : s; };

export const startOfLocalDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export function withinRange(stamp, from, to) {
  if (!stamp) return true;
  const t = +new Date(stamp);
  if (Number.isNaN(t)) return true;
  return (!from || t >= +from) && (!to || t <= +to);
}
export function parseRange(input, defaultDays) {
  const from = input?.from ? new Date(input.from) : startOfLocalDay();
  const to = input?.to ? new Date(input.to) : new Date(+from + defaultDays * 86_400_000);
  if (input?.to && /^\d{4}-\d{2}-\d{2}$/.test(String(input.to))) to.setHours(23, 59, 59, 999);
  return { from: Number.isNaN(+from) ? startOfLocalDay() : from, to: Number.isNaN(+to) ? null : to };
}
export const matches = (q, ...fields) => !q || fields.some((f) => String(f ?? "").toLowerCase().includes(String(q).toLowerCase()));
export const memberName = (hh, id) => (id ? listMembers({ householdId: hh }).find((m) => m.actorId === id)?.displayName ?? id : null);

export function publicEvent(hh, e) {
  return {
    id: e.id, title: e.title, startAt: e.startAt ?? null, endAt: e.endAt ?? null, allDay: e.allDay === true,
    location: e.location || undefined, status: e.status ?? undefined, category: e.category ?? undefined,
    source: e.layer === "canonical" ? "FamiliOS" : (e.source ?? e.layer ?? "external"), editable: e.layer === "canonical" || e.layer === "linked",
    owner: memberName(hh, e.ownerId), driver: memberName(hh, e.driverId),
    participants: (e.participantIds ?? []).map((id) => memberName(hh, id)).filter(Boolean),
    notes: e.notes ? short(e.notes, 300) : undefined,
    checklist: (e.checklist ?? []).length ? e.checklist.map((c) => `${c.done ? "[x]" : "[ ]"} ${c.text}`) : undefined,
    visibility: e.visibility ?? "household",
  };
}
export function publicTask(hh, t) {
  return {
    id: t.id, title: t.title, type: t.type ?? "task", status: t.status ?? "todo", listName: t.listName ?? undefined,
    dueAt: t.dueAt ?? null, startAt: t.startAt ?? undefined, priority: t.priority ?? undefined,
    assignedTo: memberName(hh, t.assignedMemberId), notes: t.notes ? short(t.notes, 200) : undefined, visibility: t.visibility ?? "household",
    /* The reminder, echoed back. Without it neither the model nor the person could tell
     * whether a nudge was attached (2026-09-22: "the task record doesn't echo
     * remindMinutesBefore, so this took two tests instead of one glance"). remindersSent is
     * the receipt: the sweep stamps it BEFORE pushing, so its presence proves the reminder
     * was attempted even when nothing arrived — and the audit then says why. */
    ...(t.remindMinutesBefore != null ? { remindMinutesBefore: t.remindMinutesBefore } : {}),
    ...(Array.isArray(t.remindOffsets) && t.remindOffsets.length ? { remindOffsets: t.remindOffsets } : {}),
    ...(Array.isArray(t.remindersSent) && t.remindersSent.length ? { remindersSent: t.remindersSent } : {}),
  };
}

export const readOnly = () => ({ ok: false, error: "read_only_profile", message: "This profile can look things up but not change them. Ask a parent or an adult member to do it." });

/* THE CHANNEL GATE HAS TO LIVE HERE TOO, NOT ONLY IN buildServerContext.
 *
 * Every read goes back to the store on its own. Scoping the context blob and stopping
 * there would narrow the model's opening briefing and then hand it the asker's private
 * calendar on its very first tool call — the filter has to be where the data is read, not
 * where it is summarised. `seeable` is that one place for the native lane.
 *
 * The native ctx is { householdId, actorId, role, channel, session, via, runId, agentId,
 * asHelper } (engine.mjs runNativeAction). The bodies read the session, as they always did:
 * listHelpers / publicHelper / runHelper take it whole. */
export function nativeScope(ctx) {
  const { session } = ctx;
  const hh = session.householdId;
  const channel = ctx.channel ?? "personal";
  const seeable = (e) => canSeeEntityInChannel(e, session, channel);
  const canWrite = roleAtLeast(session.role, "Limited Member");
  return { session, hh, channel, seeable, canWrite };
}

/* Who gets which tool on a turn's menu — reproducing what nativeTools did inline. Reads and
 * writes are always offered (a write refuses a read-only profile inside run, with a sentence
 * the model can repeat). The helper-management tools need an adult who is not a helper run,
 * and — the one boundary the prompt stated and nothing enforced — never in the group
 * thread: a standing autonomous actor is not created from a text a neighbour can read. */
export const always = () => true;
export const managesHelpers = ({ session, channel, asHelper }) =>
  roleAtLeast(session?.role, "Adult Member") && !asHelper && channel !== "group";

/** A result that embeds a projection (publicEvent / publicTask / a helper view). */
export const PROJECTION = { type: "object", additionalProperties: true };
