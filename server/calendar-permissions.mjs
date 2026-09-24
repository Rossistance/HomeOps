// Who may do what with a connected calendar — the ONE place the Connections matrix lives.
//
// Pure on purpose: no store, no session lookups. The routes resolve the viewer, the
// subscription and its owner, and hand them here; the answer is a set of flags the routes
// enforce AND the client renders (so a button the server would refuse is never shown).
// Keeping it pure is what lets calendar-permissions.test.mjs walk every role pair without
// a server, and keeps the matrix readable as a table rather than scattered `if`s.
//
// "Own calendar" means the subscription's assigned member (sub.ownerActorId). Every
// subscription gets one at creation and the boot migration fills legacy ones, so the
// null-owner branch below exists only for records the migration could not resolve.

export const ADULT_ROLES = ["Owner", "Adult Admin", "Adult Member"];

// Mirrors auth.mjs ROLES (highest first). Duplicated rather than imported because auth.mjs
// pulls in the store, and this module must stay importable with no data dir at all.
const ROLE_ORDER = ["Owner", "Adult Admin", "Adult Member", "Limited Member", "Child View", "Guest/Helper"];
const rank = (role) => { const i = ROLE_ORDER.indexOf(role); return i < 0 ? -1 : ROLE_ORDER.length - i; };
const atLeast = (role, min) => rank(role) >= rank(min) && rank(role) > 0;

// An Adult Admin may remove calendars that belong to the household's non-adults (a child's
// school feed, a helper's rota) — they are the grown-up in the room — but not another
// adult's: removing someone's calendar removes THEIR events from the family's view.
const ADMIN_REMOVABLE_OWNER_ROLES = ["Limited Member", "Child View", "Guest/Helper"];

/** Whose calendar this is. An explicit assignment wins; a Google calendar otherwise belongs
 * to whoever connected the account; failing both, whoever added it. */
export function subscriptionOwnerId(sub, account) {
  return sub?.ownerActorId ?? account?.connectedByActorId ?? sub?.createdBy ?? null;
}

const NONE = Object.freeze({ view: false, sync: false, edit: false, markWork: false, assign: false, remove: false, scope: false });

/**
 * @param {{actorId:string, role:string}} viewer
 * @param {object} sub the subscription record (unused today beyond presence; kept so a rule
 *   that depends on the source — e.g. a Google calendar — has somewhere to go)
 * @param {{actorId:string, role:string}|null} owner the calendar's owner member, or null
 * @returns {{view:boolean, sync:boolean, edit:boolean, markWork:boolean, assign:boolean, remove:boolean, scope:boolean}}
 */
export function calendarCan(viewer, sub, owner) {
  const role = viewer?.role;
  if (!viewer || !sub) return { ...NONE };
  if (!owner) {
    // Legacy, unassigned: someone has to be able to clean it up (the Owner), and an Admin
    // may keep it running and give it a name — but not delete what may be another adult's.
    // No scope: scope is about what a Limited Member sees, and there is no member here.
    if (role === "Owner") return { view: true, sync: true, edit: true, markWork: true, assign: true, remove: true, scope: false };
    if (role === "Adult Admin") return { ...NONE, view: true, sync: true, edit: true };
    return { ...NONE };
  }
  const own = owner.actorId === viewer.actorId;
  const ownerAdult = ADULT_ROLES.includes(owner.role);
  if (role === "Owner") {
    return { view: true, sync: true, edit: true, markWork: ownerAdult, assign: true, remove: true, scope: owner.role === "Limited Member" };
  }
  if (role === "Adult Admin") {
    // Everything but the Owner's own calendars; never reassigns (that is the Owner's call).
    const notOwners = owner.role !== "Owner";
    const edit = notOwners;
    return {
      view: true, sync: notOwners, edit, markWork: edit && ownerAdult, assign: false,
      remove: own || ADMIN_REMOVABLE_OWNER_ROLES.includes(owner.role), scope: false,
    };
  }
  if (role === "Adult Member") {
    if (!own) return { ...NONE };
    return { view: true, sync: true, edit: true, markWork: ownerAdult, assign: false, remove: true, scope: false };
  }
  if (role === "Limited Member") {
    // Sees and refreshes their one calendar; changing or removing it goes through the Owner.
    if (!own) return { ...NONE };
    return { ...NONE, view: true, sync: true };
  }
  return { ...NONE }; // Child View, Guest/Helper: the legend row is all they get
}

/**
 * May this viewer add a calendar — for themselves, or (Owner only) for someone else?
 * @param {{actorId:string, role:string}} viewer
 * @param {{forMember?: {actorId:string}|null, ownedCount?: number}} opts ownedCount is how
 *   many calendars the TARGET member already owns.
 */
export function canAddCalendar(viewer, { forMember = null, ownedCount = 0 } = {}) {
  if (!viewer || !atLeast(viewer.role, "Limited Member")) {
    return { ok: false, status: 403, error: "insufficient_role", message: "Ask a grown-up in the household to connect a calendar." };
  }
  if (forMember && forMember.actorId !== viewer.actorId) {
    // The Owner sets up calendars for anyone, uncapped — "the Owner may add more for them".
    if (viewer.role !== "Owner") return { ok: false, status: 403, error: "owner_only", message: "Only the Owner can add a calendar for someone else." };
    return { ok: true };
  }
  // The cap limits only what a Limited Member adds THEMSELVES.
  if (viewer.role === "Limited Member" && ownedCount >= 1) {
    return { ok: false, status: 403, error: "calendar_limit", message: "Limited members can connect one calendar. Ask the Owner if you need another." };
  }
  return { ok: true };
}
