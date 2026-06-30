// HomeOps AI — internal functions: real, server-side handlers that mutate HomeOps'
// own durable state (memory, artifacts, approved decisions). These are first-class
// executable tools in the run engine, distinct from external connector/provider
// tools. Every handler does real work and returns a real result — no simulation.
import { addMemory, addArtifact, putEvent, getEvent, patchEvent, putTask } from "./store.mjs";
import crypto from "node:crypto";

const eid = (p) => p + "_" + crypto.randomBytes(8).toString("hex");
const nowISO = () => new Date().toISOString();

export const INTERNAL_FUNCTIONS = {
  "homeops.write_memory": {
    id: "homeops.write_memory",
    name: "Write memory",
    action: "Write",
    risk: "Low",
    requiresApproval: false,
    connectorId: "homeops",
    connectorName: "HomeOps",
    // Persist a household/personal memory entry the assistant can recall later.
    async run(ctx, input) {
      const text = String(input?.text ?? "").trim();
      if (!text) return { ok: false, error: "empty_text", message: "Nothing to remember." };
      const rec = addMemory({
        householdId: ctx.householdId,
        scope: input?.scope ?? "family",
        type: input?.type ?? "Fact",
        text,
        source: { runId: ctx.runId, actorId: ctx.actorId },
      });
      return { ok: true, result: { id: rec.id, text: rec.text, scope: rec.scope } };
    },
  },

  "homeops.create_artifact": {
    id: "homeops.create_artifact",
    name: "Create artifact",
    action: "Write",
    risk: "Low",
    requiresApproval: false,
    connectorId: "homeops",
    connectorName: "HomeOps",
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
    connectorId: "homeops",
    connectorName: "HomeOps",
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
    connectorId: "homeops",
    connectorName: "HomeOps",
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
        source: "HomeOps Assistant", provenance: { via: "agent", runId: ctx.runId, actorId: ctx.actorId },
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
    connectorId: "homeops",
    connectorName: "HomeOps",
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
    connectorId: "homeops",
    connectorName: "HomeOps",
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
    connectorId: "homeops",
    connectorName: "HomeOps",
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
    connectorId: "homeops",
    connectorName: "HomeOps",
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

  "homeops.create_list_item": {
    id: "homeops.create_list_item",
    name: "Add a list item",
    action: "Write",
    risk: "Low",
    requiresApproval: false,
    connectorId: "homeops",
    connectorName: "HomeOps",
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
    connectorId: "homeops",
    connectorName: "HomeOps",
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
    connectorId: "homeops",
    connectorName: "HomeOps",
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
};

export function getInternalFunction(id) {
  return INTERNAL_FUNCTIONS[id] ?? null;
}
export function listInternalFunctions() {
  return Object.values(INTERNAL_FUNCTIONS);
}
