// FamiliOS AI — internal functions: real, server-side handlers that mutate FamiliOS'
// own durable state (memory, artifacts, approved decisions). These are first-class
// executable tools in the run engine, distinct from external connector/provider
// tools. Every handler does real work and returns a real result — no simulation.
import { addMemory, addArtifact, getEvent, patchEvent, listContactMethods, listAgents, getAgent, getMember } from "./store.mjs";
import { localMidnightISO } from "./household-time.mjs";
import { searchPlaces } from "./places.mjs";
import { understandFile } from "./file-understanding.mjs";
import { extractStructured } from "./file-extract.mjs";
import { deliverNotification, deliverInAppFallback } from "./notify.mjs";
import { memoryProvider } from "./memory-provider.mjs";
import { isValidReminder } from "./reminders.mjs";
/* The helpers the hand-written tools share with the DECLARED actions (actions/*.mjs) live
 * in one place, so a check tightened for one is tightened for both. */
import { eid, nowISO, badStamp, DATE_ONLY_RE, unknownMember, ghostMessage } from "./actions/shared.mjs";
import { ACTION_INTERNAL_FUNCTIONS } from "./actions/registry.mjs";
import crypto from "node:crypto";

const MEMORY_SCOPES = ["household", "personal", "nest"];
const PRIORITIES = ["low", "medium", "high"];

export const INTERNAL_FUNCTIONS = {
  /* ---- Helper (agent) inspection + iteration is NOT in this registry ----------------
   * The assistant once could not read or change a helper: it had 13 tools and all of them
   * moved DATA, so when a family asked it to fix the briefing helper it answered "Update
   * agent · ag-briefing", said the change was made, and nothing happened. The fix landed
   * as the native famili.list_helpers / create_helper / update_helper / run_helper tools in
   * assistant-agent.mjs (adult-gated, personal channel) — but a comment here, three
   * INTERNAL_INPUTS rows and a prompt line kept describing a homeops.* trio that never
   * existed, and the model was still being told to call it. Those are gone;
   * tool-registry-consistency.test.mjs keeps them gone.
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
      /* A turn that handed an owner's surprise over records NOTHING (ADR-005) — in any scope,
       * because even a "personal" memory is text an index, a search and a later briefing read,
       * and the whole point of a surprise is that it stays where it was said. For the rest of
       * that turn this refuses, with a sentence the model can repeat. */
      if (ctx?.ledger?.secretReleased) {
        return { ok: false, error: "private_turn", message: "Nothing from this conversation is being remembered, because it included a private surprise. I haven't saved anything — say it again another time if you want it kept." };
      }
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
   * role-scoped via the entity's visibility. No external side effects.
   *
   * `homeops.create_event_draft` is no longer written here: it is a DECLARED action
   * (actions/events.mjs) and arrives through the ...ACTION_INTERNAL_FUNCTIONS spread at
   * the bottom of this object, the same entry shape as everything above and below it. */

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

  /* `homeops.create_task` is a DECLARED action (actions/tasks.mjs); it arrives through the
   * ...ACTION_INTERNAL_FUNCTIONS spread at the bottom. create_list_item below still writes
   * a task by hand — next on the ladder. */

  /* `homeops.plan_meal` is a DECLARED action (actions/meals.mjs, ADR-004): the model's meal
   * tool, a composite over the same grocery writer, event composer and retire cascade the
   * meal routes use. It arrives through the spread at the bottom. */

  /* `homeops.create_list_item` is a DECLARED action (actions/tasks.mjs) that runs on the
   * same code as create_task with type "list"; it arrives through the spread at the bottom. */

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

  /* Declared actions (ADR-003). Each is one definition that ALSO yields its HTTP route and
   * the clients' TypeScript; this spread is how the run engine and the chat loop see it,
   * unchanged in shape from the hand-written entries above. Last on purpose: a declared
   * action wins over a stale copy of itself. */
  ...ACTION_INTERNAL_FUNCTIONS,
};

export function getInternalFunction(id) {
  return INTERNAL_FUNCTIONS[id] ?? null;
}
export function listInternalFunctions() {
  return Object.values(INTERNAL_FUNCTIONS);
}
