// Nests — a small group inside the household, with its own space.
//
// Asked for in full, 2026-07-25 (the GPop video):
//
//   "GPop and Beannie are actually married. So for them it might make sense to keep their own
//    agents and grocery list and task list available between the two of them, and yet still
//    isolated from the broader family group… there should be some way to associate two
//    profiles… it would say, you know, Personal, and then GPop + Beannie as its own group, the
//    way it does on the chat interface for the whole household where it says personal or
//    family… there should be a way to say 'send an invite to create a nest'… and the other
//    person would approve — you can either join or decline… and be able to leave that nest at
//    any point."
//
// The shape that falls out of that:
//
//   A nest is a THIRD visibility, sitting between personal and household. Not a permission
//   tier and not a sub-household — the members are still full members of the family, still see
//   the family calendar, still help. What a nest gives them is somewhere to put things that
//   are theirs together: their own chats, their own lists, their own helpers.
//
//   Membership is CONSENTED, both ways. An invite is offered and accepted or declined, and
//   anyone can leave at any time. Nobody is put in a shared space by someone else's decision —
//   which matters more here than usual, because the whole point of the space is privacy from
//   the rest of the household.
//
//   Leaving does not delete. A thread or a list someone made stays with the nest for whoever
//   is left; if the nest empties out it is archived, not erased.
import crypto from "node:crypto";
import { listNests, getNest, putNest, deleteNestRec, listMembers, appendAudit, actorInNest } from "./store.mjs";

const nid = () => "nest_" + crypto.randomBytes(8).toString("hex");
const now = () => new Date().toISOString();

/** Everyone currently IN the nest — accepted only. An invitee is not a member yet. */
export function nestMemberIds(nest) {
  return (nest?.members ?? []).filter((m) => m.status === "joined").map((m) => m.actorId);
}
export function isInNest(nest, actorId) {
  return nestMemberIds(nest).includes(actorId);
}

/** The nests this actor has actually joined. */
export function nestsFor(householdId, actorId) {
  return listNests((n) => n.householdId === householdId && !n.archived).filter((n) => isInNest(n, actorId));
}

/** Nests where this actor has a pending invitation waiting on them. */
export function nestInvitesFor(householdId, actorId) {
  return listNests((n) => n.householdId === householdId && !n.archived)
    .filter((n) => (n.members ?? []).some((m) => m.actorId === actorId && m.status === "invited"));
}

/**
 * Can this actor see something scoped to this nest?
 *
 * Deliberately strict: nest content is visible to nest members and NOBODY else — not to an
 * Owner, not to an Adult Admin. A space that the household's administrator can read is not the
 * space he described, and "isolated from the broader family group" has to mean isolated.
 */
export function canSeeNest(nestId, householdId, actorId) {
  // One definition, in store.mjs beside the visibility gate that also depends on it — so a
  // nest can never mean one thing to a route and another to the store.
  return actorInNest(nestId, householdId, actorId);
}

/** A display name for the space switcher: "GPop + Beannie", in his own example. */
export function nestLabel(nest, roster) {
  if (nest?.name) return nest.name;
  const names = nestMemberIds(nest)
    .map((id) => roster.get(id))
    .filter(Boolean);
  if (names.length === 0) return "Nest";
  if (names.length <= 2) return names.join(" + ");
  return `${names[0]} + ${names.length - 1} others`;
}

export function publicNest(nest, roster = new Map(), forActorId = null) {
  return {
    id: nest.id,
    name: nest.name ?? null,
    label: nestLabel(nest, roster),
    createdBy: nest.createdBy,
    createdAt: nest.createdAt,
    members: (nest.members ?? []).map((m) => ({
      actorId: m.actorId,
      name: roster.get(m.actorId) ?? null,
      status: m.status,
      respondedAt: m.respondedAt ?? null,
    })),
    myStatus: forActorId ? ((nest.members ?? []).find((m) => m.actorId === forActorId)?.status ?? null) : null,
  };
}

/**
 * Create a nest and invite people to it.
 *
 * The creator joins immediately — they are choosing this for themselves. Everyone else is
 * INVITED and has to say yes.
 */
export function createNest({ householdId, actorId, name, inviteActorIds = [] }) {
  const roster = new Set(listMembers((m) => m.householdId === householdId && !m.archived).map((m) => m.actorId));
  const invitees = [...new Set(inviteActorIds.map(String))].filter((id) => roster.has(id) && id !== actorId);
  if (invitees.length === 0) return { error: "nobody_to_invite", message: "Choose at least one other person for the nest." };
  const nest = {
    id: nid(), householdId, name: String(name ?? "").trim().slice(0, 60) || null,
    createdBy: actorId, createdAt: now(), updatedAt: now(), archived: false,
    members: [
      { actorId, status: "joined", respondedAt: now() },
      ...invitees.map((id) => ({ actorId: id, status: "invited", respondedAt: null })),
    ],
  };
  putNest(nest);
  appendAudit({ type: "nest.create", nestId: nest.id, invited: invitees.length });
  return { nest };
}

/** Invite more people to an existing nest. Only someone already in it may. */
export function inviteToNest({ nestId, householdId, actorId, inviteActorIds = [] }) {
  const n = getNest(nestId);
  if (!n || n.householdId !== householdId || n.archived) return { error: "not_found" };
  if (!isInNest(n, actorId)) return { error: "forbidden", message: "Only someone in the nest can invite to it." };
  const roster = new Set(listMembers((m) => m.householdId === householdId && !m.archived).map((m) => m.actorId));
  const existing = new Set((n.members ?? []).map((m) => m.actorId));
  const fresh = [...new Set(inviteActorIds.map(String))].filter((id) => roster.has(id) && !existing.has(id));
  if (fresh.length === 0) return { error: "nobody_to_invite" };
  n.members = [...(n.members ?? []), ...fresh.map((id) => ({ actorId: id, status: "invited", respondedAt: null }))];
  n.updatedAt = now();
  putNest(n);
  appendAudit({ type: "nest.invite", nestId: n.id, invited: fresh.length });
  return { nest: n, invited: fresh };
}

/** Accept or decline an invitation — only for YOURSELF. */
export function respondToNest({ nestId, householdId, actorId, accept }) {
  const n = getNest(nestId);
  if (!n || n.householdId !== householdId || n.archived) return { error: "not_found" };
  const me = (n.members ?? []).find((m) => m.actorId === actorId);
  if (!me || me.status !== "invited") return { error: "no_invitation", message: "You don't have an invitation to that nest." };
  me.status = accept ? "joined" : "declined";
  me.respondedAt = now();
  n.updatedAt = now();
  putNest(n);
  appendAudit({ type: "nest.respond", nestId: n.id, accepted: !!accept });
  return { nest: n };
}

/**
 * Leave a nest. "And be able to leave that nest at any point if that's what you'd want to do."
 *
 * What was made inside it STAYS — a shared list is not undone because one person stepped out,
 * and deleting someone else's things on your way out would be a strange thing for leaving to
 * mean. A nest nobody is left in is archived rather than deleted, so its contents remain
 * accountable and recoverable.
 */
export function leaveNest({ nestId, householdId, actorId }) {
  const n = getNest(nestId);
  if (!n || n.householdId !== householdId || n.archived) return { error: "not_found" };
  if (!isInNest(n, actorId)) return { error: "not_a_member" };
  n.members = (n.members ?? []).map((m) => (m.actorId === actorId ? { ...m, status: "left", respondedAt: now() } : m));
  n.updatedAt = now();
  if (nestMemberIds(n).length === 0) n.archived = true;
  putNest(n);
  appendAudit({ type: "nest.leave", nestId: n.id, archived: !!n.archived });
  return { nest: n, archived: !!n.archived };
}

export { listNests, getNest, deleteNestRec };
