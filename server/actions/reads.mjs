// Declared READS (ADR-003): GET /api/events and GET /api/tasks.
//
// A read is the other half of a contract. The writers now put records through one helper
// that fills every default; this is the one place that says what the API RETURNS — the
// stored record plus the per-viewer decorations GET adds (editable, appendable, myNotes,
// staleSource) — as an `output` schema both clients' generated types are cut from and the
// contract tests validate against.
//
// HTTP-only (agent: false), on purpose. The model already has famili.list_events and
// famili.list_tasks: windowed, searchable, channel-scoped reads with a compact projection —
// the right shape for a model and the wrong one for a calendar screen that wants everything
// with its decorations. Making one run serve both would mean branching on the door, which is
// the drift this registry exists to remove. The native tools are declared too, as their own
// lane (./native/reads.mjs, ADR-004) — two declared reads over the same data, by design.
import { listEvents, listTasks, getViewerNote, canSeeEntity } from "../store.mjs";
import { accountStatusById } from "../accounts.mjs";
import { isEditableLinkedGoogle } from "../calendar.mjs";
import { privacyContext, presentEvents } from "../event-privacy.mjs";
import { defineAction } from "./define-action.mjs";
import { EVENT_RECORD } from "./schemas/event.mjs";
import { TASK_RECORD } from "./schemas/task.mjs";

const NO_INPUT = { type: "object", properties: {}, additionalProperties: false };
const STALE_ACCOUNT_STATUS = new Set(["needs_reconnect", "revoked", "expired"]);

export const readEvents = defineAction({
  id: "homeops.list_events",
  name: "List calendar events",
  description: "Every event the viewer can see, with the per-viewer decorations the calendar screens need: editable, appendable, myNotes and staleSource.",
  action: "Read",
  risk: "Low",
  agent: false,
  input: NO_INPUT,
  output: { type: "object", properties: { events: { type: "array", items: { $ref: "#/$defs/EventRecord" } } }, required: ["events"], additionalProperties: false },
  $defs: { EventRecord: EVENT_RECORD },
  errorCodes: ["invalid_input"],
  http: { method: "GET", path: "/api/events" },

  async run(ctx) {
    const viewer = { role: ctx.role, actorId: ctx.actorId };
    // Hidden events and Work calendars (ADR-005): the visibility gate, a Limited Member's
    // Owner-set scope and "only the owner sees through a hide" are ALL decided by
    // presentEvents — the one chokepoint every surface asks. What comes back is the owner's
    // own events in full (with a privacy decoration), everyone else's visible events as
    // stored, and "<Name> working/busy" blocks standing in for hidden time. Nothing below
    // may reach past it to the stored record.
    const pc = privacyContext(ctx.householdId);
    const visible = presentEvents(listEvents((e) => e.householdId === ctx.householdId), viewer, { channel: "personal", purpose: "app", pc });
    // Per-event edit affordance for the clients: a canonical (FamiliOS-owned) event is
    // editable by its owner; a linked Google event is editable ONLY by the member who
    // connected that Google account (edit-own-calendar-only). Everything else (ICS mirrors,
    // other members' synced events) is read-only.
    // ISS-121: an account that can no longer refresh must not go on contributing events
    // that LOOK current. Resolve each synced event's source account once per request and
    // flag the affected ones, so a disconnected calendar can never contribute SILENTLY.
    // Marked, not hidden: quietly removing a family's events would be a worse lie than
    // showing them with an honest "this calendar can't refresh" flag, and the clients pair
    // the flag with a reconnect action.
    const acctStatus = accountStatusById(ctx.householdId);
    const subToAccount = new Map();
    for (const s of pc.subsById.values()) {
      if (s.accountId) subToAccount.set(s.id, s.accountId);
    }
    const staleSourceOf = (e) => {
      const accountId = e.provenance?.googleAccountId ?? subToAccount.get(e.provenance?.subscriptionId) ?? null;
      if (!accountId) return null;
      const a = acctStatus.get(accountId);
      if (!a || !STALE_ACCOUNT_STATUS.has(a.status)) return null;
      return { accountId, status: a.status, provider: a.provider, connectedByActorId: a.connectedByActorId };
    };
    const events = visible.map((e) => {
      // A block is a stand-in, not an event: presentEvents already made it read-only
      // (editable/appendable false, myNotes null), and it names no calendar — a staleSource
      // on it would say which account the hidden time came from.
      if (e.block) return e;
      const staleSource = staleSourceOf(e);
      /* Cluster D — "This is his item and I should not be able to edit any of the
       * information." Editing an event belongs to the person whose event it IS, not to a
       * role. The household Owner was the one demonstrating the bug — logged in as Owner,
       * editing GPop's schedule — so isAdultRole is exactly the wrong test here. */
      const mine = e.ownerId === ctx.actorId || e.createdBy === ctx.actorId;
      return {
        ...e,
        editable: e.layer === "canonical" ? mine : isEditableLinkedGoogle(e, ctx.householdId, ctx.actorId),
        /* Anyone who can SEE an event can keep their own private margin on it — that is
         * what appendable means. The shared halves (attendees, driver, what to bring) sit
         * behind the owner + the request flow. */
        appendable: true,
        /* The viewer's own margin, theirs alone. The owner's shared notes stay on the event
         * record; this is everyone's private half — including the owner's. */
        myNotes: getViewerNote(e.id, ctx.actorId),
        ...(staleSource ? { staleSource } : {}),
      };
    });
    return { ok: true, result: { events } };
  },
});

export const readTasks = defineAction({
  id: "homeops.list_tasks",
  name: "List tasks and list items",
  description: "Every task, chore, bill and list item the viewer can see.",
  action: "Read",
  risk: "Low",
  agent: false,
  input: NO_INPUT,
  output: { type: "object", properties: { tasks: { type: "array", items: { $ref: "#/$defs/TaskRecord" } } }, required: ["tasks"], additionalProperties: false },
  $defs: { TaskRecord: TASK_RECORD },
  errorCodes: ["invalid_input"],
  http: { method: "GET", path: "/api/tasks" },

  async run(ctx) {
    const viewer = { role: ctx.role, actorId: ctx.actorId };
    const tasks = listTasks((t) => t.householdId === ctx.householdId).filter((t) => canSeeEntity(t, viewer));
    return { ok: true, result: { tasks } };
  },
});
