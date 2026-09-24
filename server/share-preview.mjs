// FamiliOS — a shared thing, as the reader may see it right now.
//
// A message can carry a reference to an event, task, file, meal, list item, help request or
// helper update. The reference is stored; the preview is computed at read time for the
// person reading, so a card never goes stale and never shows something its reader could
// not open themselves. A ref the reader cannot see renders as { hidden: true }.
import { getEvent, getTask, getFileRec, getMeal, getHelpRequest, listNotifications, canSeeEntity, getMember } from "./store.mjs";
import { presentEvent } from "./event-privacy.mjs";

const name = (actorId) => (actorId ? getMember(actorId)?.displayName ?? null : null);

/* An event, as THIS reader may see it (ADR-005). presentEvent is the one place that decides:
 * the full record, the owner's block ("Beannie working" — the time and nothing else), or null.
 * A card is read by a person on their own screen, so purpose "app": an owner sees their own
 * hidden event in full, everyone else — the household Owner included — the block. The block
 * has no route: there is nothing behind it this reader may open. */
function eventAsSeen(e, session) {
  if (!e || e.deletedAt || e.householdId !== session.householdId) return null;
  return presentEvent(e, session, { purpose: "app" });
}

export function resolvePreview({ type, id }, session) {
  const gate = (entity) => entity && canSeeEntity(entity, session);
  try {
    switch (type) {
      case "event": {
        const e = eventAsSeen(getEvent(id), session);
        if (!e) return { hidden: true };
        if (e.block) return { type, id, title: e.title, when: e.startAt ?? null, allDay: !!e.allDay, where: null, who: name(e.ownerId), status: null, route: null };
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
        /* The linked event used to be embedded with no check at all — any member reading the
         * thread got its title and time, whatever its visibility. It goes through the same
         * gate as an event card: gone when this reader could not see it, the block when it is
         * someone else's hidden event (whose id is the block's "blk_…", never the real one). */
        const ev = h.eventId ? eventAsSeen(getEvent(h.eventId), session) : null;
        const does = h.proposal?.patch?.driverId ? `${h.toName} drives` : h.proposal?.patch?.participantId ? `${h.toName} goes along` : null;
        const open = ev && !ev.block;
        return {
          type, id, title: h.message, who: h.fromName ?? null, to: h.toName ?? null, status: h.status,
          fromActorId: h.fromActorId, toActorId: h.toActorId,
          canRespond: h.status === "pending" && h.toActorId === session.actorId,
          event: ev ? { id: ev.id, title: ev.title, when: ev.startAt ?? null } : null,
          does,
          route: open ? { pathname: "/event-form", params: { id: ev.id } } : { pathname: "/help" },
        };
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
