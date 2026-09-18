// FamiliOS — a shared thing, as the reader may see it right now.
//
// A message can carry a reference to an event, task, file, meal, list item, help request or
// helper update. The reference is stored; the preview is computed at read time for the
// person reading, so a card never goes stale and never shows something its reader could
// not open themselves. A ref the reader cannot see renders as { hidden: true }.
import { getEvent, getTask, getFileRec, getMeal, getHelpRequest, listNotifications, canSeeEntity, getMember } from "./store.mjs";

const name = (actorId) => (actorId ? getMember(actorId)?.displayName ?? null : null);

export function resolvePreview({ type, id }, session) {
  const gate = (entity) => entity && canSeeEntity(entity, session);
  try {
    switch (type) {
      case "event": {
        const e = getEvent(id);
        if (!gate(e) || e.deletedAt) return { hidden: true };
        return { type, id, title: e.title, when: e.startAt ?? null, allDay: !!e.allDay, where: e.location ?? null, who: name(e.ownerId ?? e.createdBy), status: null, route: { pathname: "/event-form", params: { id } } };
      }
      case "task": case "list_item": {
        const t = getTask(id);
        if (!gate(t)) return { hidden: true };
        return { type, id, title: t.title, when: t.dueAt ?? null, who: name(t.assignedMemberId), status: t.status ?? null, route: { pathname: "/tasks", params: { id } } };
      }
      case "file": {
        const f = getFileRec(id);
        if (!gate(f)) return { hidden: true };
        return { type, id, title: f.name, mime: f.mime ?? null, sizeBytes: f.sizeBytes ?? null, who: name(f.uploadedBy), route: { pathname: "/(library)", params: { file: id } } };
      }
      case "meal": {
        const m = getMeal(id);
        if (!gate(m)) return { hidden: true };
        return { type, id, title: m.title ?? m.name ?? "Meal", when: m.date ?? null, slot: m.slot ?? m.mealType ?? null, route: { pathname: "/meals" } };
      }
      case "help_request": {
        const h = getHelpRequest(id);
        if (!h || h.householdId !== session.householdId) return { hidden: true };
        return { type, id, title: h.message, who: h.fromName ?? null, to: h.toName ?? null, status: h.status, route: { pathname: "/help" } };
      }
      case "notification": {
        const n = listNotifications((x) => x.id === id && x.householdId === session.householdId)[0];
        if (!n) return { hidden: true };
        return { type, id, title: n.title, body: String(n.body ?? "").slice(0, 600), who: n.source?.name ?? null, conversationId: n.conversationId ?? null, route: { pathname: "/inbox", params: { seg: "updates" } } };
      }
      default:
        return { hidden: true };
    }
  } catch {
    return { hidden: true };
  }
}
