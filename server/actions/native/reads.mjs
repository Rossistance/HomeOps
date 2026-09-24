// The native READS (ADR-004 Stage 1): famili.list_events, list_tasks, list_meals,
// list_members, search_memory and list_approvals — the model's own windowed, searchable,
// channel-scoped reads of the household, with a compact projection a model can use.
//
// Declared, not re-designed: the names, descriptions and input schemas are the ones the
// model has always been sent (byte for byte), and each `run` is the body that used to live
// inline in assistant-agent.mjs nativeTools(). What declaring buys is the rest of the
// contract — a risk, an output shape, generated types — and a place in the registry the
// chat loop's shared gate (engine.mjs runNativeAction) reads. These are not the HTTP reads
// in ../reads.mjs: those serve a calendar screen everything with its decorations, and
// making one run serve both would mean branching on the door.
import { listEvents, listTasks, listMeals, listMembers, listApprovals, listMemory, getMemoryEntry, listRuns } from "../../store.mjs";
import { canSeeMemory } from "../../nests.mjs";
import { memoryProvider } from "../../memory-provider.mjs";
import { defineAction } from "../define-action.mjs";
import { parseRange, withinRange, matches, publicEvent, publicTask, nativeScope, presentForAsker, always, PROJECTION } from "./shared.mjs";

const READ = { action: "Read", risk: "Low", requiresApproval: false, delivers: false, lane: "native", timeoutMs: 60_000, available: always };
const strOrNull = { type: ["string", "null"] };

export const familiListEvents = defineAction({
  id: "famili.list_events",
  name: "List calendar events",
  description: "List the household's calendar events the asker can see. Defaults to today through the next 30 days. Use it before answering any question about what is scheduled, before moving or deleting an event, and to check for conflicts before adding one.",
  ...READ,
  input: { type: "object", properties: { from: { type: "string", description: "Range start (ISO or YYYY-MM-DD). Default: start of today." }, to: { type: "string", description: "Range end (ISO or YYYY-MM-DD). Default: 30 days after from." }, query: { type: "string", description: "Only events whose title or location contains this." }, limit: { type: "number" } }, additionalProperties: false },
  output: {
    type: "object",
    properties: {
      events: { type: "array", items: PROJECTION },
      count: { type: "number" },
      range: { type: "object", properties: { from: { type: "string" }, to: strOrNull }, required: ["from", "to"], additionalProperties: false },
    },
    required: ["events", "count", "range"], additionalProperties: false,
  },
  errorCodes: ["invalid_input"],
  async run(ctx, input) {
    const { hh } = nativeScope(ctx);
    const { from, to } = parseRange(input, 30);
    const limit = Math.min(200, Math.max(1, Number(input?.limit) || 60));
    /* Through event-privacy.mjs BEFORE the text search (ADR-005): presentEvents applies the
     * channel gate itself, turns someone else's hidden time into "<Name> working" blocks and
     * withholds the asker's own surprise where others may be listening. The search then runs
     * on what the asker may read — searching the stored titles first would let "haircut?"
     * find a hidden event and answer with a block at exactly its time. */
    const inRange = listEvents((e) => e.householdId === hh)
      .filter((e) => withinRange(e.startAt, from, to) || (e.endAt && withinRange(e.endAt, from, to)));
    const rows = presentForAsker(ctx, inRange)
      .filter((e) => matches(input?.query, e.title, e.location))
      .sort((a, b) => String(a.startAt ?? "").localeCompare(String(b.startAt ?? "")));
    return { ok: true, result: { events: rows.slice(0, limit).map((e) => publicEvent(hh, e)), count: rows.length, range: { from: from.toISOString(), to: to?.toISOString() ?? null } } };
  },
});

export const familiListTasks = defineAction({
  id: "famili.list_tasks",
  name: "List tasks and list items",
  description: "List the household's tasks, chores and list items (groceries, shopping, packing) the asker can see. Use it before answering about what is due or to find a task's id before completing, changing or deleting it.",
  ...READ,
  input: { type: "object", properties: { status: { type: "string", enum: ["open", "done", "all"], description: "Default open." }, listName: { type: "string", description: "Only items on this list (e.g. Groceries)." }, assignedMemberId: { type: "string" }, query: { type: "string", description: "Only tasks whose title contains this." }, limit: { type: "number" } }, additionalProperties: false },
  output: {
    type: "object",
    properties: { tasks: { type: "array", items: PROJECTION }, count: { type: "number" } },
    required: ["tasks", "count"], additionalProperties: false,
  },
  errorCodes: ["invalid_input"],
  async run(ctx, input) {
    const { hh, seeable } = nativeScope(ctx);
    const status = input?.status ?? "open";
    const limit = Math.min(200, Math.max(1, Number(input?.limit) || 80));
    const rows = listTasks((t) => t.householdId === hh).filter(seeable)
      .filter((t) => status === "all" ? true : status === "done" ? t.status === "done" : (t.status !== "done" && t.status !== "archived"))
      .filter((t) => !input?.listName || String(t.listName ?? "").toLowerCase() === String(input.listName).toLowerCase())
      .filter((t) => !input?.assignedMemberId || t.assignedMemberId === input.assignedMemberId)
      .filter((t) => matches(input?.query, t.title, t.notes))
      .sort((a, b) => String(a.dueAt ?? "9").localeCompare(String(b.dueAt ?? "9")));
    return { ok: true, result: { tasks: rows.slice(0, limit).map((t) => publicTask(hh, t)), count: rows.length } };
  },
});

export const familiListMeals = defineAction({
  id: "famili.list_meals",
  name: "List planned meals",
  description: "List the meal plan for a date range (default: today through 14 days). Use it before planning meals so you never double-book a slot.",
  ...READ,
  input: { type: "object", properties: { from: { type: "string", description: "YYYY-MM-DD" }, to: { type: "string", description: "YYYY-MM-DD" } }, additionalProperties: false },
  output: {
    type: "object",
    properties: {
      meals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string" }, date: strOrNull, slot: { type: "string" }, title: { type: "string" },
            servings: { type: ["number", "null"] }, ingredientCount: { type: "number" }, recipeUrl: { type: "string" },
          },
          required: ["id", "title", "servings", "ingredientCount"], additionalProperties: false,
        },
      },
      count: { type: "number" },
    },
    required: ["meals", "count"], additionalProperties: false,
  },
  errorCodes: ["invalid_input"],
  async run(ctx, input) {
    const { hh, seeable } = nativeScope(ctx);
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.from ?? "")) ? input.from : new Date().toISOString().slice(0, 10);
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(input?.to ?? "")) ? input.to : new Date(Date.parse(from) + 14 * 86_400_000).toISOString().slice(0, 10);
    const rows = listMeals((m) => m.householdId === hh && !m.archived).filter(seeable)
      .filter((m) => !m.date || (m.date >= from && m.date <= to))
      .sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
    return { ok: true, result: { meals: rows.map((m) => ({ id: m.id, date: m.date, slot: m.slot, title: m.title, servings: m.servings ?? null, ingredientCount: (m.ingredients ?? []).length, recipeUrl: m.recipeUrl || undefined })), count: rows.length } };
  },
});

export const familiListMembers = defineAction({
  id: "famili.list_members",
  name: "List household members",
  description: "The household roster with member ids, roles and relationships. Use it to resolve a name to the id that assign/driver/participant fields need.",
  ...READ,
  input: { type: "object", properties: {}, additionalProperties: false },
  output: {
    type: "object",
    properties: {
      members: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, name: { type: "string" }, role: { type: "string" }, relationship: strOrNull, isYou: { type: "boolean" } },
          required: ["id", "role", "relationship", "isYou"], additionalProperties: false,
        },
      },
      count: { type: "number" },
    },
    required: ["members", "count"], additionalProperties: false,
  },
  errorCodes: ["invalid_input"],
  async run(ctx) {
    const { session, hh } = nativeScope(ctx);
    const rows = listMembers({ householdId: hh }).filter((m) => !m.archived)
      .map((m) => ({ id: m.actorId, name: m.displayName, role: m.role, relationship: m.relationship ?? null, isYou: m.actorId === session.actorId }));
    return { ok: true, result: { members: rows, count: rows.length } };
  },
});

export const familiSearchMemory = defineAction({
  id: "famili.search_memory",
  name: "Search family memory",
  description: "Search what the family has told Famili to remember (preferences, routines, facts) and past conversation knowledge. Use it when a request depends on something the family may have said before.",
  ...READ,
  input: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
  output: {
    type: "object",
    properties: {
      memories: {
        type: "array",
        items: { type: "object", properties: { id: { type: "string" }, text: strOrNull, scope: strOrNull }, additionalProperties: false },
      },
      degraded: { type: "boolean" },
    },
    required: ["memories", "degraded"], additionalProperties: false,
  },
  errorCodes: ["invalid_input", "query_required"],
  async run(ctx, input) {
    const { session, hh, channel } = nativeScope(ctx);
    const q = String(input?.query ?? "").trim();
    if (!q) return { ok: false, error: "query_required", message: "What should I search for?" };
    /* In the group channel a personal memory is dropped outright rather than matched
     * against the asker — same rule as buildServerContext, and for the same reason:
     * the asker is not the audience. So is a NEST's: only household memory is found there,
     * exactly as a nest's tasks and events are hidden there (canSeeEntityInChannel), and as
     * famili.delete_memory refuses anything else there. (ADR-004 Stage 2.) */
    const groupVisible = (m) => m.scope === "household";
    const visible = (m) => (channel === "group" ? groupVisible(m) : m.scope !== "personal" || (m.sourceActorId ?? m.source?.actorId) === session.actorId);
    const health = await memoryProvider.health();
    if (health.ok) {
      const r = await memoryProvider.search(q, { containerTag: hh, limit: 10 });
      /* `id` rides along so famili__delete_memory has something to name — before, a wrong
       * memory could be found but never pointed at. The index row is `sm_mem_<store id>`
       * and it is a COPY: its scope and author are whatever was passed at write time.
       * Visibility is therefore decided on the STORE row when there is one — the same
       * record and predicate the app and the delete tool use — so search can never show an
       * entry that "Forget" then refuses (2026-09-22: found on every search,
       * memory_not_found on every delete). The index's own fields are consulted only for a
       * row the store no longer has. */
      const judged = (m) => {
        const id = m.id ? String(m.id).replace(/^sm_mem_/, "") : null;
        const row = id ? getMemoryEntry(id) : null;
        if (row) {
          if (row.householdId !== hh) return null;
          if (!(channel === "group" ? groupVisible(row) : canSeeMemory(row, session))) return null;
          return { id: row.id, text: row.text, scope: row.scope };
        }
        return visible(m) ? { ...(id ? { id } : {}), text: m.text, scope: m.scope } : null;
      };
      if (r.ok) return { ok: true, result: { memories: (r.results ?? []).map(judged).filter(Boolean), degraded: !!r.degraded } };
    }
    const rows = listMemory({ householdId: hh, limit: 200 }).filter(visible).filter((m) => matches(q, m.text)).slice(0, 10);
    return { ok: true, result: { memories: rows.map((m) => ({ id: m.id, text: m.text, scope: m.scope })), degraded: true } };
  },
});

export const familiListApprovals = defineAction({
  id: "famili.list_approvals",
  name: "List pending approvals",
  description: "Approvals the household still has to decide on (things waiting before they can send or run).",
  ...READ,
  input: { type: "object", properties: {}, additionalProperties: false },
  output: {
    type: "object",
    properties: {
      approvals: {
        type: "array",
        items: {
          type: "object",
          properties: { id: { type: "string" }, toolId: { type: "string" }, preview: { type: "string" }, risk: { type: "string" }, expiresAt: strOrNull },
          required: ["id", "toolId", "expiresAt"], additionalProperties: false,
        },
      },
      count: { type: "number" },
    },
    required: ["approvals", "count"], additionalProperties: false,
  },
  errorCodes: ["invalid_input"],
  async run(ctx) {
    const { session, hh, channel } = nativeScope(ctx);
    /* In the group thread — read by people outside the household, and an approval's preview
     * now names the record it would change — only what the asker requested, or what was itself
     * asked for in the thread: a pending approval whose run the thread queued (sourceRef.channel
     * "group" from the chat lane, via "group_chat" from the group listener). An approval a
     * helper or someone's app turn queued stays in the Inbox, not the thread. (ADR-004 Stage 2.) */
    const fromThread = channel === "group" ? new Set(listRuns({ householdId: hh, status: "waiting_for_approval", limit: 1000 })
      .filter((r) => r.sourceRef?.channel === "group" || r.sourceRef?.via === "group_chat")
      .flatMap((r) => (r.steps ?? []).map((s) => s.approvalId).filter(Boolean))) : null;
    const rows = listApprovals({ householdId: hh }).filter((a) => a.status === "pending")
      .filter((a) => a.visibility !== "personal" || (channel !== "group" && a.requestedBy === session.actorId))
      .filter((a) => channel !== "group" || a.requestedBy === session.actorId || fromThread.has(a.id))
      .map((a) => ({ id: a.id, toolId: a.toolId, preview: a.preview, risk: a.risk, expiresAt: a.expiresAt ? new Date(a.expiresAt).toISOString() : null }));
    return { ok: true, result: { approvals: rows, count: rows.length } };
  },
});
