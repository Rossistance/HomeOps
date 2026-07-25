// FamiliOS AI — internal functions: real, server-side handlers that mutate FamiliOS'
// own durable state (memory, artifacts, approved decisions). These are first-class
// executable tools in the run engine, distinct from external connector/provider
// tools. Every handler does real work and returns a real result — no simulation.
import { addMemory, addArtifact, putEvent, getEvent, patchEvent, putTask, putMeal, listMeals, patchMeal, listEvents, getSettings, listContactMethods, listAgents, getAgent, getMember } from "./store.mjs";
import { partialUpdateAgent } from "./agents.mjs";
import { mealEventNotes, pushEventToGoogle } from "./calendar.mjs";
import { deliverNotification, deliverInAppFallback } from "./notify.mjs";
import { memoryProvider } from "./memory-provider.mjs";
import crypto from "node:crypto";

const eid = (p) => p + "_" + crypto.randomBytes(8).toString("hex");
const nowISO = () => new Date().toISOString();

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
  "homeops.list_agents": {
    id: "homeops.list_agents",
    name: "List helpers",
    action: "Read",
    risk: "Low",
    requiresApproval: false,
    delivers: false,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    async run(ctx) {
      const rows = listAgents((a) => a.householdId === ctx.householdId || a.householdId === "local")
        .map((a) => ({ id: a.id, name: a.name, purpose: a.purpose ?? "", status: a.status ?? "Active" }));
      return { ok: true, result: { agents: rows, count: rows.length } };
    },
  },
  "homeops.get_agent": {
    id: "homeops.get_agent",
    name: "Read a helper's setup",
    action: "Read",
    risk: "Low",
    requiresApproval: false,
    delivers: false,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    // The full instructions, so the model can reason about WHY a helper behaves as it does
    // instead of guessing from its name.
    async run(ctx, input) {
      const id = String(input?.agentId ?? "").trim();
      if (!id) return { ok: false, error: "agent_id_required", message: "Which helper? Pass its agentId (use list_agents first)." };
      const a = getAgent(id);
      if (!a || (a.householdId !== ctx.householdId && a.householdId !== "local")) {
        return { ok: false, error: "unknown_agent", message: `There's no helper "${id}" in this household.` };
      }
      return { ok: true, result: {
        id: a.id, name: a.name, purpose: a.purpose ?? "", instructions: a.instructions ?? "",
        status: a.status ?? "Active", version: a.version ?? 1, system: a.system === true,
        allowedToolIds: a.allowedToolIds ?? [], deniedToolIds: a.deniedToolIds ?? [],
      } };
    },
  },
  "homeops.update_agent": {
    id: "homeops.update_agent",
    name: "Change a helper's setup",
    action: "Write",
    risk: "Medium",
    // Approval-gated: this rewrites what a helper will do on its own, later, unattended.
    // The family should see that change before it takes effect — not discover it in a
    // briefing next week.
    requiresApproval: true,
    delivers: false,
    connectorId: "homeops",
    connectorName: "FamiliOS",
    async run(ctx, input) {
      const id = String(input?.agentId ?? "").trim();
      if (!id) return { ok: false, error: "agent_id_required", message: "Which helper? Pass its agentId." };
      const a = getAgent(id);
      if (!a || (a.householdId !== ctx.householdId && a.householdId !== "local")) {
        return { ok: false, error: "unknown_agent", message: `There's no helper "${id}" in this household.` };
      }
      // Only these fields — a chat turn must not be able to widen a helper's permissions
      // (allowedToolIds/deniedToolIds stay with the policy screens, where WP-105's
      // effective-policy view can explain them).
      const patch = {};
      for (const f of ["name", "purpose", "instructions", "status"]) {
        if (typeof input?.[f] === "string" && input[f].trim()) patch[f] = input[f].trim();
      }
      // G5 — [18:52], on a helper the family built by talking to it: "don't ask for
      // permission, you have approval." That sentence is said IN CHAT, so this is where it
      // has to be actionable. It is not a permission WIDENING (the helper's allow-lists are
      // untouched); it removes the pause on the steps it can already run.
      //
      // The role is read from the store for the acting member — never from the model's input
      // — so the high-risk tier is granted only when the person actually asking has the
      // standing to grant it (agents.mjs sanitizeApprovalPolicy makes the same check again).
      // And this tool is approval-gated, so the family sees the change before it takes hold.
      let unattendedNote = null;
      if (typeof input?.runUnattended === "boolean") {
        const role = getMember(ctx.actorId)?.role ?? null;
        patch.approvalPolicy = {
          ...(a.approvalPolicy ?? { autoAllow: [], alwaysApprove: [] }),
          unattended: input.runUnattended
            ? { enabled: true, includeHighRisk: input.includeSendAndSpend === true }
            : { enabled: false },
        };
        unattendedNote = !input.runUnattended
          ? "It will ask before gated steps again."
          : input.includeSendAndSpend === true && ["Owner", "Adult Admin"].includes(String(role))
            ? "It will now run on its own, including steps that send or spend."
            : input.includeSendAndSpend === true
              ? "It will now run low-risk steps on its own. Sending and spending still needs an Owner to allow it, so those still pause."
              : "It will now run low-risk steps on its own. Anything that sends or spends still pauses for you.";
      }
      if (Object.keys(patch).length === 0) {
        return { ok: false, error: "nothing_to_change", message: "Say what to change — name, purpose, instructions, status, or whether it runs unattended." };
      }
      const before = { name: a.name, purpose: a.purpose ?? "", instructions: a.instructions ?? "", status: a.status ?? "Active" };
      const next = partialUpdateAgent(id, patch, { actorId: ctx.actorId, householdId: ctx.householdId, role: getMember(ctx.actorId)?.role ?? null });
      if (!next) return { ok: false, error: "update_failed", message: "Couldn't save that change." };
      // before/after travels back so the chat can show what actually changed — and so a
      // claim of having edited a helper is backed by a diff, not by assertion.
      return { ok: true, result: {
        id: next.id, name: next.name, version: next.version,
        changed: Object.keys(patch), before, after: { ...before, ...patch },
        // Read back what ACTUALLY applies, so a refused tier can't be reported as granted.
        ...(unattendedNote ? { unattended: next.approvalPolicy?.unattended ?? { enabled: false }, unattendedNote } : {}),
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
      const scope = input?.scope ?? "family";
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
      const rec = putEvent({
        id: eid("ev"), householdId: ctx.householdId, title,
        startAt: input?.startAt ?? null, endAt: input?.endAt ?? null,
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
      return { ok: true, result: { id: rec.id, title: rec.title, status: rec.status } };
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
      const rec = putTask({
        id: eid("tk"), householdId: ctx.householdId, title,
        type: input?.type ?? "task", status: "todo", dueAt: input?.dueAt ?? null,
        assignedMemberId: input?.assignedMemberId ?? null, spaceId: input?.spaceId ?? "sp-family",
        priority: input?.priority ?? "medium", amount: input?.amount ?? null,
        visibility: input?.visibility ?? "household", notes: input?.notes ?? "",
        source: "agent", createdBy: ctx.actorId, createdByAgentId: input?.agentId ?? null,
        createdAt: nowISO(), updatedAt: nowISO(),
      });
      return { ok: true, result: { id: rec.id, title: rec.title, type: rec.type } };
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
          scheduleNote = `Replaced ${old.title} on ${date}.`;
        } else {
          const requested = date;
          for (let d = 1; d <= 7 && occupant(date); d++) {
            date = new Date(Date.parse(requested) + d * 86400000).toISOString().slice(0, 10);
          }
          scheduleNote = occupant(date)
            ? "" // week is full — keep the requested date rather than land nowhere
            : `${requested} ${slot} already had ${occupant(requested)?.title ?? "a meal"} — moved to ${date}. Ask me to "replace" if you'd rather swap.`;
          if (!scheduleNote) date = requested;
        }
      }
      let meal;
      if (dupe) {
        // Same dish already on the plan — move/refresh it instead of duplicating.
        meal = patchMeal(dupe.id, {
          date, slot, updatedAt: now,
          ...(ingredients.length && !(dupe.ingredients ?? []).length ? { ingredients } : {}),
          ...(instructions.length && !(dupe.instructions ?? []).length ? { instructions } : {}),
        }) ?? dupe;
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
      const { listTasks } = await import("./store.mjs");
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
        const startAt = `${date}T${time}:00`;
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
