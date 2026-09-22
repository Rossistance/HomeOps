// FamiliOS AI — internal functions: real, server-side handlers that mutate FamiliOS'
// own durable state (memory, artifacts, approved decisions). These are first-class
// executable tools in the run engine, distinct from external connector/provider
// tools. Every handler does real work and returns a real result — no simulation.
import { addMemory, addArtifact, putEvent, getEvent, patchEvent, deleteEventRec, putTask, listTasks, patchTask, putMeal, listMeals, patchMeal, listEvents, getSettings, listContactMethods, listAgents, getAgent, getMember } from "./store.mjs";
import { mealEventNotes, pushEventToGoogle, deleteGoogleCopy } from "./calendar.mjs";
import { householdTimeZone, localMidnightISO, wallClockISO } from "./household-time.mjs";
import { searchPlaces } from "./places.mjs";
import { understandFile } from "./file-understanding.mjs";
import { extractStructured } from "./file-extract.mjs";
import { deliverNotification, deliverInAppFallback } from "./notify.mjs";
import { memoryProvider } from "./memory-provider.mjs";
import { isValidReminder } from "./reminders.mjs";
import crypto from "node:crypto";

const eid = (p) => p + "_" + crypto.randomBytes(8).toString("hex");
const nowISO = () => new Date().toISOString();
// The HTTP create routes refuse an unparseable stamp (ISS-105) so an event can never be
// stored on no day; these tools took the model's string verbatim, which is how "tomorrow"
// became a row that rendered nowhere and a run that still reported ok:true.
const badStamp = (v) => v != null && v !== "" && Number.isNaN(+new Date(v));
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MEMORY_SCOPES = ["household", "personal", "nest"];
const PRIORITIES = ["low", "medium", "high"];
const MEAL_SLOTS = ["breakfast", "lunch", "dinner", "snack"];
/* A member id the model made up used to be stored as-is — an event with a participant
 * nobody can see, a task assigned to a ghost, a driver who does not exist (found by the
 * App QA helper, 2026-09-22, alongside priority "urgent" and meal slot "brunch", all
 * accepted without a word). The roster is the only source of ids (famili__list_members);
 * an id that is not on it is refused with a reason the model can act on. */
const unknownMember = (id) => {
  if (id == null || id === "") return null;
  const m = getMember(String(id));
  return m && !m.archived ? null : String(id);
};
const ghostMessage = (id) => `No household member has the id "${id}" — list members to find the right one.`;

export const INTERNAL_FUNCTIONS = {
  /* ---- Helper (agent) inspection + iteration --------------------------------------
   * The assistant could not read or change a helper. It had 13 tools and all of them
   * moved DATA — not one touched an agent. So when a family asked it to fix the briefing
   * helper, it answered "Update agent · ag-briefing", said the change was made, and
   * nothing happened: there was no such capability to call. Ten minutes of a recorded
   * session went into iterating against a control that did not exist.
   *
   * That is the whole point of connecting a model: the intelligence layer is supposed to
   * be able to look at a helper, understand what it is doing wrong, and change it. These
   * three tools give it eyes and hands on the helpers themselves.
   *
   * Editing a helper's standing instructions changes what it will do UNATTENDED later, so
   * update is approval-gated — the family sees the before/after and signs off. Reading is
   * free.
   */
  "homeops.find_places": {
    id: "homeops.find_places",
    name: "Find places nearby",
    action: "Read",
    risk: "Low",
    requiresApproval: false,
    delivers: false,
    connectorId: "homeops",
    connectorName: "Places",
    async run(ctx, input) {
      const query = String(input?.query ?? "").trim();
      if (!query) return { ok: false, error: "query_required", message: "What should I look for — restaurants, a pharmacy, a park?" };
      const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
      const limit = Math.min(10, Math.max(1, Number(input?.limit) || 5));
      const r = await searchPlaces(query, { lat: num(input?.lat), lng: num(input?.lng), limit });
      if (!r.ok) return { ok: false, error: r.error, message: r.message ?? "Couldn't look that up right now." };
      return { ok: true, result: { places: r.places, provider: r.provider, limitations: r.limitations } };
    },
  },
  /* ---- Reading a file, and pulling the family's life out of it -------------------------
   *
   * Asked for directly after the attachment bug: "it'd be really amazing if I could ask
   * questions about them, and then even more amazing than all that would be to have it be able
   * to parse information from them into categories or presented back to me, and recognise
   * things that it correlates with the app — like if it was a photo of a schedule it could say
   * 'I found these items, here are the cards, choose which ones you'd want to add'."
   *
   * Two tools, deliberately separate:
   *   read_file    — answer questions ABOUT a file. No side effects.
   *   extract_from_file — find the calendar events, tasks and list items INSIDE it, and hand
   *                  them back as rows. They render as cards (the same resultGroups path the
   *                  chat already uses), each with an Add action, so the family PICKS. Nothing
   *                  is written to the calendar by extracting.
   *
   * That last point is the whole design. A photo of a school schedule contains nine things;
   * silently creating nine events is the kind of help nobody asked for. */
  "homeops.read_file": {
    id: "homeops.read_file",
    name: "Read a file",
    action: "Read",
    risk: "Low",
    requiresApproval: false,
    delivers: false,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    async run(ctx, input) {
      const fileId = String(input?.fileId ?? "").trim();
      if (!fileId) return { ok: false, error: "file_id_required", message: "Which file? Pass its fileId." };
      const out = await understandFile(fileId, { householdId: ctx.householdId, prompt: input?.question });
      if (!out.ok) return { ok: false, error: out.error, message: out.message };
      return { ok: true, result: { name: out.name, kind: out.kind, text: out.text, truncated: !!out.truncated } };
    },
  },
  "homeops.extract_from_file": {
    id: "homeops.extract_from_file",
    name: "Find events and tasks in a file",
    action: "Read",
    risk: "Low",
    // No approval: this only PROPOSES. Nothing lands on a calendar or a list until a person
    // taps Add on the card.
    requiresApproval: false,
    delivers: false,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    async run(ctx, input) {
      const fileId = String(input?.fileId ?? "").trim();
      if (!fileId) return { ok: false, error: "file_id_required", message: "Which file? Pass its fileId." };
      const read = await understandFile(fileId, {
        householdId: ctx.householdId,
        prompt: "Transcribe every date, time, name, place and task in this, exactly as written, preserving order.",
      });
      if (!read.ok) return { ok: false, error: read.error, message: read.message };
      const found = await extractStructured({ householdId: ctx.householdId, text: read.text, sourceName: read.name });
      if (!found.ok) return { ok: false, error: found.error, message: found.message };
      const items = found.items ?? [];
      if (items.length === 0) {
        return { ok: true, result: { candidates: [], sourceName: read.name, note: `I read "${read.name}" but couldn't find anything with a date or an action in it.` } };
      }
      return { ok: true, result: {
        // Named `candidates` so the card renderer picks it up as rows (assistant-runs.mjs
        // rowsFromResult finds the first array of objects, whatever it's called).
        candidates: items,
        sourceName: read.name,
        note: `${items.length} thing${items.length === 1 ? "" : "s"} found in "${read.name}". Nothing has been added — pick the ones you want.`,
      } };
    },
  },
  "homeops.write_memory": {
    id: "homeops.write_memory",
    name: "Write memory",
    action: "Write",
    risk: "Low",
    requiresApproval: false,
    // WP-002 slice 1 — explicit, single source of truth for whether a SUCCEEDED step
    // reaches outside the run (an inbox, a phone, a person). summarizeOutcome
    // (assistant-runs.mjs) reads ONLY this flag to decide what counts as "delivered" —
    // never the tool's id/name. A memory write never leaves the household.
    delivers: false,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    // Persist a household/personal memory entry the assistant can recall later.
    async run(ctx, input) {
      const text = String(input?.text ?? "").trim();
      if (!text) return { ok: false, error: "empty_text", message: "Nothing to remember." };
      // "family" was a fourth scope no reader recognised (it fell through as household-
      // visible), and the default. Household is the honest default for a durable fact;
      // anything else the caller names is validated against the three real rooms.
      const requested = String(input?.scope ?? "").trim().toLowerCase();
      const scope = requested === "family" ? "household" : MEMORY_SCOPES.includes(requested) ? requested : "household";
      const type = input?.type ?? "Fact";
      const rec = addMemory({
        householdId: ctx.householdId,
        scope,
        type,
        text,
        source: { runId: ctx.runId, actorId: ctx.actorId },
      });
      // WP-007 (DEC-014) dual-write: the tenant memory.json row above stays the source of
      // truth (KEPT, never removed — no data loss either direction); the provider write
      // below feeds retrieval-quality search/profile (planner.mjs's read path, the Memory
      // tab's search box). Fail-soft by construction (memory-provider.mjs never throws) —
      // a degraded/offline provider must never fail this tool or lose the tenant write.
      const providerWrite = await memoryProvider.add(text, { containerTag: ctx.householdId, scope, type, sourceActorId: ctx.actorId, id: `sm_mem_${rec.id}` });
      return { ok: true, result: { id: rec.id, text: rec.text, scope: rec.scope, providerWrite: { ok: providerWrite.ok, degraded: !!providerWrite.degraded } } };
    },
  },

  "homeops.create_artifact": {
    id: "homeops.create_artifact",
    name: "Create artifact",
    action: "Write",
    risk: "Low",
    requiresApproval: false,
    delivers: false,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    // Produce a durable artifact (briefing / report / checklist) tied to the run.
    async run(ctx, input) {
      const title = String(input?.title ?? "Untitled").trim();
      const body = String(input?.body ?? "");
      const rec = addArtifact({
        householdId: ctx.householdId,
        runId: ctx.runId,
        kind: input?.kind ?? "report",
        title,
        body,
      });
      return { ok: true, result: { id: rec.id, title: rec.title, kind: rec.kind } };
    },
  },

  "homeops.create_approval": {
    id: "homeops.create_approval",
    name: "Request household sign-off",
    action: "Send",
    risk: "High",
    requiresApproval: true,
    // "Send"-shaped for approval-gating purposes only — it records a decision, it does
    // not reach anyone outside the household. This is exactly the distinction the old
    // regex/requiresApproval heuristic missed (see summarizeOutcome).
    delivers: false,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    // Gated on a real human approval. The handler runs ONLY after the household
    // approved the step, and records the approved decision as a durable artifact so
    // the sign-off has an auditable, persistent outcome.
    async run(ctx, input) {
      const subject = String(input?.subject ?? input?.title ?? "Household decision").trim();
      const detail = String(input?.detail ?? input?.body ?? "");
      const rec = addArtifact({
        householdId: ctx.householdId,
        runId: ctx.runId,
        kind: "approved-decision",
        title: subject,
        body: detail,
        approvedBy: ctx.actorId,
      });
      return { ok: true, result: { id: rec.id, subject, recorded: true } };
    },
  },

  /* ---- Family-data tools (P1.2 / P4.1): real, server-owned writes ----
   * The assistant/agents draft rich family events and tasks here. These are the
   * canonical household graph — review-first (events land as drafts), durable, and
   * role-scoped via the entity's visibility. No external side effects. */
  "homeops.create_event_draft": {
    id: "homeops.create_event_draft",
    name: "Draft a family event",
    action: "Write",
    risk: "Low",
    requiresApproval: false,
    delivers: false,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    async run(ctx, input) {
      const title = String(input?.title ?? "").trim();
      if (!title) return { ok: false, error: "empty_title", message: "An event needs a title." };
      if (badStamp(input?.startAt)) return { ok: false, error: "invalid_startAt", message: "startAt isn't a valid date/time — use ISO 8601 (e.g. 2026-09-14T17:00:00-04:00) or YYYY-MM-DD for an all-day event." };
      if (badStamp(input?.endAt)) return { ok: false, error: "invalid_endAt", message: "endAt isn't a valid date/time." };
      for (const id of Array.isArray(input?.participantIds) ? input.participantIds : []) {
        const ghost = unknownMember(id);
        if (ghost) return { ok: false, error: "unknown_member", message: ghostMessage(ghost) };
      }
      { const ghost = unknownMember(input?.driverId); if (ghost) return { ok: false, error: "unknown_member", message: ghostMessage(ghost) }; }
      const tz = householdTimeZone(ctx.householdId);
      // A date-only start means "that whole day" — an all-day event anchored to the
      // household's midnight, never the server's (which is how a US family's all-day
      // events began the evening before).
      const dateOnly = DATE_ONLY_RE.test(String(input?.startAt ?? ""));
      const allDay = input?.allDay === true || dateOnly;
      const startAt = dateOnly ? localMidnightISO(input.startAt, tz) : (input?.startAt ?? null);
      const endAt = input?.endAt ? (DATE_ONLY_RE.test(String(input.endAt)) ? localMidnightISO(input.endAt, tz) : input.endAt) : null;
      // An end BEFORE the start used to be dropped to null without a word; the model then
      // told the family the event ran 3–5 when it had no end at all. (Equal is still
      // treated as "no end" — a same-day all-day event arrives that way.)
      if (endAt && startAt && Date.parse(endAt) < Date.parse(startAt)) return { ok: false, error: "end_before_start", message: "endAt is before startAt — give the end time after the start, or leave it out." };
      const rec = putEvent({
        id: eid("ev"), householdId: ctx.householdId, title,
        startAt, endAt: endAt && startAt && Date.parse(endAt) > Date.parse(startAt) ? endAt : null, allDay,
        notes: typeof input?.notes === "string" ? input.notes : "",
        location: input?.location ?? "", spaceId: input?.spaceId ?? "sp-family",
        participantIds: Array.isArray(input?.participantIds) ? input.participantIds : [],
        driverId: input?.driverId ?? null, ownerId: input?.ownerId ?? ctx.actorId, backupOwnerId: null,
        whatToBring: Array.isArray(input?.whatToBring) ? input.whatToBring : [],
        checklist: [], travel: input?.travel ?? null, reminders: [],
        attachments: [], comments: [], mealImpact: input?.mealImpact ?? null,
        visibility: input?.visibility ?? "household", category: input?.category ?? "Family",
        layer: "canonical", status: "draft",
        source: "FamiliOS Assistant", provenance: { via: "agent", runId: ctx.runId, actorId: ctx.actorId },
        createdBy: ctx.actorId, createdAt: Date.now(), updatedAt: nowISO(),
      });
      return { ok: true, result: { id: rec.id, title: rec.title, status: rec.status, startAt: rec.startAt, endAt: rec.endAt, allDay: rec.allDay === true } };
    },
  },

  "homeops.update_event_checklist": {
    id: "homeops.update_event_checklist",
    name: "Update event checklist",
    action: "Write",
    risk: "Low",
    requiresApproval: false,
    delivers: false,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    async run(ctx, input) {
      const ev = getEvent(input?.eventId);
      if (!ev || ev.householdId !== ctx.householdId) return { ok: false, error: "event_not_found", message: "No such event." };
      const items = Array.isArray(input?.items) ? input.items : [];
      const checklist = items.map((it) => (typeof it === "string" ? { text: it, done: false } : { text: String(it.text ?? ""), done: !!it.done }));
      const rec = patchEvent(ev.id, { checklist });
      return { ok: true, result: { id: rec.id, checklistCount: checklist.length } };
    },
  },

  "homeops.assign_driver": {
    id: "homeops.assign_driver",
    name: "Assign a driver",
    action: "Write",
    risk: "Low",
    requiresApproval: false,
    delivers: false,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    async run(ctx, input) {
      const ev = getEvent(input?.eventId);
      if (!ev || ev.householdId !== ctx.householdId) return { ok: false, error: "event_not_found", message: "No such event." };
      const rec = patchEvent(ev.id, { driverId: input?.driverId ?? null });
      return { ok: true, result: { id: rec.id, driverId: rec.driverId } };
    },
  },

  "homeops.assign_what_to_bring": {
    id: "homeops.assign_what_to_bring",
    name: "Assign what-to-bring",
    action: "Write",
    risk: "Low",
    requiresApproval: false,
    delivers: false,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    async run(ctx, input) {
      const ev = getEvent(input?.eventId);
      if (!ev || ev.householdId !== ctx.householdId) return { ok: false, error: "event_not_found", message: "No such event." };
      const items = Array.isArray(input?.items) ? input.items : [];
      const whatToBring = items.map((it) => (typeof it === "string" ? { item: it, memberId: null } : { item: String(it.item ?? ""), memberId: it.memberId ?? null }));
      const rec = patchEvent(ev.id, { whatToBring });
      return { ok: true, result: { id: rec.id, count: whatToBring.length } };
    },
  },

  "homeops.create_task": {
    id: "homeops.create_task",
    name: "Create a task",
    action: "Write",
    risk: "Low",
    requiresApproval: false,
    delivers: false,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    async run(ctx, input) {
      const title = String(input?.title ?? "").trim();
      if (!title) return { ok: false, error: "empty_title", message: "A task needs a title." };
      if (badStamp(input?.dueAt)) return { ok: false, error: "invalid_dueAt", message: "dueAt isn't a valid date/time — use ISO 8601 or YYYY-MM-DD." };
      if (input?.priority != null && input.priority !== "" && !PRIORITIES.includes(input.priority)) return { ok: false, error: "bad_priority", message: "priority must be low, medium or high." };
      { const ghost = unknownMember(input?.assignedMemberId); if (ghost) return { ok: false, error: "unknown_member", message: ghostMessage(ghost) }; }
      /* A reminder set at creation. The sweep (reminders.mjs) reads remindOffsets, so the
       * same shape POST /api/tasks writes is written here — a lead the app does not offer is
       * refused rather than stored as a nudge that never fires, and a lead with nothing to
       * count back from is refused for the same reason. */
      const remind = input?.remindMinutesBefore == null || input?.remindMinutesBefore === "" ? null : Number(input.remindMinutesBefore);
      if (remind !== null && !isValidReminder(remind)) return { ok: false, error: "bad_reminder", message: "Pick a reminder lead the app offers: 0 (at the time), 15, 30, 60 or 1440 minutes." };
      if (remind !== null && !input?.dueAt) return { ok: false, error: "reminder_needs_time", message: "A reminder needs a dueAt to count back from — set the due date and time too." };
      const rec = putTask({
        id: eid("tk"), householdId: ctx.householdId, title,
        type: input?.type ?? "task", status: "todo", dueAt: input?.dueAt ?? null,
        assignedMemberId: input?.assignedMemberId ?? null, spaceId: input?.spaceId ?? "sp-family",
        priority: input?.priority ?? "medium", amount: input?.amount ?? null,
        visibility: input?.visibility ?? "household", notes: input?.notes ?? "",
        remindMinutesBefore: remind, remindOffsets: remind === null ? [] : [remind], remindersSent: [],
        source: "agent", createdBy: ctx.actorId, createdByAgentId: input?.agentId ?? null,
        createdAt: nowISO(), updatedAt: nowISO(),
      });
      return { ok: true, result: { id: rec.id, title: rec.title, type: rec.type, ...(remind === null ? {} : { remindMinutesBefore: remind }) } };
    },
  },

  "homeops.plan_meal": {
    id: "homeops.plan_meal",
    name: "Plan a meal (planner + groceries + calendar)",
    action: "Write",
    risk: "Low",
    requiresApproval: false,
    delivers: false,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    // One approved meal → everything wired in a single real action:
    //   1. meal in the Meal Planner (title, date, slot, recipe URL, ingredients, instructions)
    //   2. missing ingredients onto the shared Groceries list (mealId back-reference,
    //      so the grocery mini app shows them linked to this meal)
    //   3. a canonical calendar event whose `notes` body carries the recipe URL,
    //      full ingredient list, and step-by-step instructions
    //   4. when the household enabled calendar auto-sync, the event is pushed to
    //      Google Calendar immediately (description = the same notes body).
    // This is what the assistant calls per approved meal in the "plan my week" flow.
    async run(ctx, input) {
      const title = String(input?.title ?? "").trim();
      if (!title) return { ok: false, error: "empty_title", message: "A meal needs a title." };
      // "brunch" used to become dinner and servings:0 used to become null, both silently.
      if (input?.slot != null && input.slot !== "" && !MEAL_SLOTS.includes(input.slot)) return { ok: false, error: "bad_slot", message: "slot must be breakfast, lunch, dinner or snack." };
      if (input?.servings != null && input.servings !== "" && !(Number.isFinite(+input.servings) && +input.servings > 0)) return { ok: false, error: "bad_servings", message: "servings must be a whole number greater than zero." };
      const now = nowISO();
      let ingredients = (Array.isArray(input?.ingredients) ? input.ingredients : [])
        .map((i) => (typeof i === "string" ? { item: i.trim(), have: false } : { item: String(i.item ?? "").trim(), have: !!i.have }))
        .filter((i) => i.item).slice(0, 60);
      let instructions = (Array.isArray(input?.instructions) ? input.instructions : []).map((s) => String(s).trim()).filter(Boolean).slice(0, 60);
      let enrichmentNote = "";
      // Self-enrichment: planners routinely arrive with a bare title (recipe pages
      // bot-walled upstream). A meal without ingredients puts NOTHING on the
      // grocery list — the exact silent failure users hit — so fetch the recipe
      // here, and as a last resort estimate a standard list, honestly labeled.
      if (ingredients.length === 0) {
        const recipeUrl = typeof input?.recipeUrl === "string" ? input.recipeUrl.trim() : "";
        try {
          const { extractRecipe, estimateIngredients } = await import("./web.mjs");
          if (recipeUrl) {
            const r = await extractRecipe(recipeUrl);
            if (r.ok && r.recipe?.ingredients?.length) {
              ingredients = r.recipe.ingredients.map((x) => ({ item: String(x).slice(0, 160), have: false })).slice(0, 60);
              if (instructions.length === 0) instructions = (r.recipe.instructions ?? []).map((s) => String(s)).slice(0, 60);
              if (r.extraction === "text") enrichmentNote = "Ingredients read from the recipe page text.";
            }
          }
          if (ingredients.length === 0) {
            const est = await estimateIngredients(title, input?.servings ?? 4);
            if (est) {
              ingredients = est.ingredients.map((x) => ({ item: x, have: false }));
              if (instructions.length === 0) instructions = est.instructions;
              enrichmentNote = "Ingredients estimated by Famili — check quantities before shopping.";
            }
          }
        } catch { /* enrichment is best-effort; the meal still lands */ }
      }
      const slot = ["breakfast", "lunch", "dinner", "snack"].includes(input?.slot) ? input.slot : "dinner";
      let date = typeof input?.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date) ? input.date : null;
      let scheduleNote = "";
      // State-aware scheduling — the intelligence users expect:
      // 1. Same meal already planned this week → update it, never duplicate.
      // 2. The requested slot is taken → replace only when explicitly asked
      //    (replace:true); otherwise shift to the nearest free slot and say so.
      const household = (m) => m.householdId === ctx.householdId && !m.archived;
      const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const dupe = listMeals(household).find((m) => norm(m.title) === norm(title) && (!date || !m.date || Math.abs(Date.parse(m.date) - Date.parse(date)) < 8 * 86400000));
      const occupant = (d) => listMeals(household).find((m) => m.date === d && m.slot === slot && (!dupe || m.id !== dupe.id));
      if (date && occupant(date)) {
        if (input?.replace === true) {
          const old = occupant(date);
          patchMeal(old.id, { archived: true, updatedAt: nowISO() });
          // Archiving the meal alone left its calendar event and grocery items behind —
          // two dinners on the calendar and both ingredient lists on the shopping list.
          for (const e of listEvents((x) => x.householdId === ctx.householdId && x.mealId === old.id)) {
            if (e.provenance?.googleEventId && getSettings(ctx.householdId).externalActionsEnabled !== false) {
              await deleteGoogleCopy({ ev: e, householdId: ctx.householdId, actorId: ctx.actorId }).catch(() => null);
            }
            deleteEventRec(e.id);
          }
          for (const t of listTasks((x) => x.householdId === ctx.householdId && x.mealId === old.id && x.status !== "done")) {
            patchTask(t.id, { mealId: null, notes: t.notes === `For ${old.title}` ? "" : t.notes });
          }
          scheduleNote = `Replaced ${old.title} on ${date}.`;
        } else {
          const requested = date;
          for (let d = 1; d <= 7 && occupant(date); d++) {
            date = new Date(Date.parse(requested) + d * 86400000).toISOString().slice(0, 10);
          }
          if (occupant(date)) {
            // Week is full — keep the requested date, but SAY it is now a double booking.
            date = requested;
            scheduleNote = `${requested} ${slot} already had ${occupant(requested)?.title ?? "a meal"} and the week is full, so both are on that slot now. Ask me to "replace" if you'd rather swap.`;
          } else {
            scheduleNote = `${requested} ${slot} already had ${occupant(requested)?.title ?? "a meal"} — moved to ${date}. Ask me to "replace" if you'd rather swap.`;
          }
        }
      }
      let meal;
      if (dupe) {
        // Same dish already on the plan — move/refresh it instead of duplicating.
        // Only move it when a date was actually given — re-planning "tacos" with no date used
        // to write date:null over the real one, dropping the meal off the planner while its
        // calendar event stayed on the old day.
        meal = patchMeal(dupe.id, {
          ...(date ? { date, slot } : {}), updatedAt: now,
          ...(ingredients.length && !(dupe.ingredients ?? []).length ? { ingredients } : {}),
          ...(instructions.length && !(dupe.instructions ?? []).length ? { instructions } : {}),
        }) ?? dupe;
        date = meal.date ?? date;
        scheduleNote = scheduleNote || `${meal.title} was already planned — updated it instead of adding a duplicate.`;
      } else {
        meal = putMeal({
          id: eid("meal"), householdId: ctx.householdId, title, date, slot,
          time: typeof input?.time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) ? input.time : null,
          notes: String(input?.notes ?? ""), ingredients, instructions,
          servings: Number.isFinite(+input?.servings) && +input.servings > 0 ? Math.floor(+input.servings) : null,
          recipeUrl: typeof input?.recipeUrl === "string" ? input.recipeUrl.trim() : "",
          visibility: input?.visibility ?? "household", source: "assistant", createdBy: ctx.actorId, createdAt: now, updatedAt: now,
        });
      }
      if (enrichmentNote) scheduleNote = [scheduleNote, enrichmentNote].filter(Boolean).join(" ");
      // 2) Groceries — every not-yet-have ingredient, linked by mealId. Items
      // already on the open list (any meal) aren't added twice.
      const openGrocery = new Set(listTasks((t) => t.householdId === ctx.householdId && t.type === "list" && t.listName === "Groceries" && t.status !== "done").map((t) => norm(t.title)));
      const groceryIds = [];
      for (const ing of ingredients.filter((i) => !i.have && !openGrocery.has(norm(i.item)))) {
        const tk = putTask({
          id: eid("tk"), householdId: ctx.householdId, title: ing.item, type: "list", status: "todo",
          listName: "Groceries", spaceId: "sp-family", priority: "low", visibility: "household",
          source: "assistant", createdBy: ctx.actorId, notes: `For ${meal.title}`, mealId: meal.id,
          createdAt: now, updatedAt: now,
        });
        groceryIds.push(tk.id);
      }
      // 3) Calendar event (idempotent by mealId) with the full recipe body in notes.
      let event = null;
      if (date) {
        const SLOT_TIMES = { breakfast: "08:00", lunch: "12:00", dinner: "18:00", snack: "15:00" };
        const time = meal.time ?? SLOT_TIMES[slot] ?? "18:00";
        const slotLabel = slot.charAt(0).toUpperCase() + slot.slice(1);
        const evTitle = `${slotLabel}: ${meal.title}`;
        // A real instant on the household's clock. The zoneless "2026-07-23T18:00:00" this
        // used to write meant one time on the server and another on every phone, and went
        // to Google with no zone beside a UTC end.
        const startAt = wallClockISO(date, time, householdTimeZone(ctx.householdId)) ?? `${date}T${time}:00`;
        const notes = mealEventNotes(meal);
        const existing = listEvents((e) => e.householdId === ctx.householdId && e.mealId === meal.id)[0];
        event = existing
          ? patchEvent(existing.id, { title: evTitle, startAt, notes })
          : putEvent({
              id: eid("ev"), householdId: ctx.householdId, title: evTitle, startAt, endAt: null,
              location: "", notes, spaceId: "sp-family", participantIds: [], driverId: null,
              ownerId: ctx.actorId, backupOwnerId: null, whatToBring: [], checklist: [], travel: null,
              reminders: [], attachments: [], comments: [], mealImpact: null, mealId: meal.id,
              visibility: "household", category: "Meal", layer: "canonical", status: "confirmed",
              source: "FamiliOS Assistant", provenance: { via: "meal", runId: ctx.runId, actorId: ctx.actorId },
              createdBy: ctx.actorId, createdAt: Date.now(), updatedAt: now,
            });
      }
      // 4) Google push — only when the household pre-authorized it (calendar auto-sync).
      let google = { pushed: false };
      if (event && getSettings(ctx.householdId).calendarAutoSync === true) {
        const r = await pushEventToGoogle({ ev: event, householdId: ctx.householdId, actorId: ctx.actorId });
        google = r.ok ? { pushed: true, googleEventId: r.googleEventId, action: r.action } : { pushed: false, error: r.error };
      }
      return { ok: true, result: { id: meal.id, mealId: meal.id, title: meal.title, date, slot, groceryItems: groceryIds.length, eventId: event?.id ?? null, google, ...(scheduleNote ? { note: scheduleNote } : {}) } };
    },
  },

  "homeops.create_list_item": {
    id: "homeops.create_list_item",
    name: "Add a list item",
    action: "Write",
    risk: "Low",
    requiresApproval: false,
    delivers: false,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    // List items (groceries, packing) are modeled as lightweight tasks of type "list".
    async run(ctx, input) {
      const title = String(input?.text ?? input?.title ?? "").trim();
      if (!title) return { ok: false, error: "empty_text", message: "Nothing to add." };
      const rec = putTask({
        id: eid("li"), householdId: ctx.householdId, title,
        type: "list", status: "todo", listName: input?.listName ?? "Shopping",
        spaceId: input?.spaceId ?? "sp-family", priority: "low",
        visibility: input?.visibility ?? "household", source: "agent",
        createdBy: ctx.actorId, createdAt: nowISO(), updatedAt: nowISO(),
      });
      return { ok: true, result: { id: rec.id, title: rec.title, listName: rec.listName } };
    },
  },

  "homeops.attach_note_or_file_reference": {
    id: "homeops.attach_note_or_file_reference",
    name: "Attach a note or file reference",
    action: "Write",
    risk: "Low",
    requiresApproval: false,
    delivers: false,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    async run(ctx, input) {
      const ev = getEvent(input?.eventId);
      if (!ev || ev.householdId !== ctx.householdId) return { ok: false, error: "event_not_found", message: "No such event." };
      const attachment = { kind: input?.fileRef ? "file" : "note", text: String(input?.note ?? ""), fileRef: input?.fileRef ?? null, at: nowISO(), by: ctx.actorId };
      const rec = patchEvent(ev.id, { attachments: [...(ev.attachments ?? []), attachment] });
      return { ok: true, result: { id: rec.id, attachmentCount: rec.attachments.length } };
    },
  },

  "homeops.send_notification_draft": {
    id: "homeops.send_notification_draft",
    name: "Draft a notification",
    action: "Write",
    risk: "Low",
    requiresApproval: false,
    // This is the exact tool the false-success bug was about: its id CONTAINS
    // "send_notification", but it never sends anything — the old summary regex
    // matched the name and reported a draft as delivered. `draft: true` lets the
    // summary give it its own honest "drafted — review" wording instead of lumping
    // it in with ordinary non-delivering writes.
    delivers: false,
    draft: true,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    // Review-first: produces a DRAFT artifact for a human to review, never sends.
    // Actually sending goes through a gated connector tool (sms/gmail) + approval.
    async run(ctx, input) {
      const to = String(input?.to ?? "").trim();
      const body = String(input?.body ?? input?.message ?? "").trim();
      if (!body) return { ok: false, error: "empty_body", message: "Nothing to draft." };
      const rec = addArtifact({
        householdId: ctx.householdId, runId: ctx.runId,
        kind: "notification-draft", title: input?.subject ?? `Draft message${to ? " to " + to : ""}`,
        body, meta: { to, channel: input?.channel ?? "unspecified" }, createdBy: ctx.actorId,
      });
      return { ok: true, result: { id: rec.id, draft: true, to } };
    },
  },

  /* ================================================================= *
   * WP-005 — REAL UNATTENDED DELIVERY, over the fail-closed registry
   * ================================================================= *
   * The gap this closes (ISS-006): the engine had NO reachable path to actually
   * deliver an email or text on a schedule. `gmail.send` exists but is approval-gated
   * with a 30-minute TTL, so a 7 AM briefing parked at 07:00 and expired unread at
   * 07:30, every single day. `send_notification_draft` only ever wrote a draft. The
   * result was a household that had explicitly asked for a daily email and could not
   * be given one by any route.
   *
   * WHY THIS IS ALLOWED TO SEND WITHOUT A PER-RUN APPROVAL — the consent already
   * happened, earlier and more deliberately than a 07:00 push notification ever
   * could. Three independent gates, ALL enforced inside deliverNotification and ALL
   * fail-closed, must already be true:
   *   1. the contact method is VERIFIED (someone proved control of that address),
   *   2. it is OPTED IN (the recipient agreed to receive messages), and
   *   3. this specific agent is on that method's `allowedAgentIds` allowlist.
   * Gate 3 IS the standing approval, granted per-agent per-address by a human in the
   * contact-method UI. Nothing here can invent a recipient: the tool refuses any
   * address that does not already resolve to such a method.
   *
   * Deliberate design choices, each closing a way this could have gone wrong:
   *   • No free-form recipient. A raw `to` is RESOLVED against the registry and
   *     refused if it doesn't match a verified method — it can never create one.
   *     Without this, "email the briefing to X" could reach any address a model
   *     hallucinated, unattended.
   *   • No agent, no send. deliverNotification only enforces the allowlist when an
   *     agentId is supplied; an unattributed run would slip past gate 3 entirely.
   *     So this refuses to act without an acting agent, rather than relying on a
   *     caller to remember to pass one.
   *   • The household kill switch is honored (see notify.mjs) — a family hitting
   *     "pause" stops this, mid-schedule, with nothing sent.
   *   • Every delivery is audited by the existing notify audit rows.                */
  "homeops.notify_contact": {
    id: "homeops.notify_contact",
    name: "Send to a contact method",
    action: "Send",
    risk: "High",
    // The registry allowlist is the standing consent; a second per-run approval gate
    // here would recreate the 30-minute expiry race this work package exists to end.
    // Safety lives in the three fail-closed gates below, not in a daily interruption.
    requiresApproval: false,
    // The one internal tool that actually reaches a person off-device (or, via the
    // WP-002 slice 3 in-app fallback below, at least reaches them in the app).
    delivers: true,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    async run(ctx, input) {
      const agentId = ctx?.agentId ?? null;
      if (!agentId) {
        return { ok: false, error: "no_acting_agent", message: "This send needs to run as a specific helper, because the recipient's allowlist is granted per helper. Run it from an agent or automation." };
      }
      const body = String(input?.body ?? input?.message ?? "").trim();
      if (!body) return { ok: false, error: "empty_body", message: "Nothing to send — the message body was empty." };
      const subject = String(input?.subject ?? input?.title ?? "A note from FamiliOS").slice(0, 140);

      // Resolve the recipient to an EXISTING registry method. Never create one, never
      // fall back to a raw address: an unregistered recipient is a hard, honest stop.
      let methodId = input?.methodId ? String(input.methodId) : null;
      if (!methodId) {
        const wanted = String(input?.to ?? "").trim().toLowerCase();
        if (!wanted) return { ok: false, error: "no_recipient", message: "No recipient — give me a contact method to send to." };
        const match = listContactMethods((m) => m.householdId === ctx.householdId && String(m.value ?? "").trim().toLowerCase() === wanted);
        if (!match.length) {
          // WP-002 slice 3 — HONEST IN-APP FALLBACK. There is nowhere off-device to
          // reach this recipient yet, but refusing outright means a plain chat ask
          // ("let mom know...") does NOTHING — not even the honesty of a visible
          // result. Deliver a real, durable in-app notification to the REQUESTER (the
          // one person guaranteed reachable right now, since they're mid-conversation)
          // instead, and say plainly what happened and what unlocks off-device reach.
          // This can NEVER reach email/SMS — deliverInAppFallback only ever writes the
          // in_app channel, so the verified+opt-in+allowlist gates below are untouched.
          const fallback = await deliverInAppFallback({
            session: { householdId: ctx.householdId, actorId: ctx.actorId },
            title: subject,
            body: `${body}\n\n(Couldn't reach "${input.to}" — no verified contact method for it yet.)`,
          });
          if (fallback.ok && fallback.delivered) {
            return {
              ok: true,
              result: {
                delivered: true, channel: "in_app", inAppFallback: true, notificationId: fallback.notificationId,
                message: `Delivered in-app — add a verified contact method for email/SMS to reach you off-device.`,
              },
            };
          }
          return {
            ok: false, error: "method_not_registered", needsSetup: "contact_method",
            message: `I can't send to ${input.to} yet — it isn't a verified contact method for this household. Add and verify it in Contact Methods, then allow this helper to message it, and I'll deliver it automatically from then on.`,
          };
        }
        methodId = match[0].id;
      }

      // deliverNotification enforces verified + opted-in + per-agent allowlist and
      // returns an honest, actionable refusal for each. Nothing is sent unless all pass.
      const out = await deliverNotification({
        session: { householdId: ctx.householdId, actorId: ctx.actorId },
        methodId, title: subject, body, agentId,
      });
      if (!out.ok || !out.delivered) {
        return { ok: false, error: out.error ?? "not_delivered", needsSetup: out.needsSetup, message: out.message ?? "The message was not delivered." };
      }
      return { ok: true, result: { delivered: true, channel: out.channel, methodId, message: out.message } };
    },
  },
};

export function getInternalFunction(id) {
  return INTERNAL_FUNCTIONS[id] ?? null;
}
export function listInternalFunctions() {
  return Object.values(INTERNAL_FUNCTIONS);
}
