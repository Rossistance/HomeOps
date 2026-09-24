// Central role → capability + view-mode resolver, shared by routing (which home a
// signed-in member lands on) and by the UI gates that hide actions a role can't perform.
// The SERVER is the source of truth for permissions (see server/auth.mjs `gate`); these
// checks are cosmetic — they keep low-trust members from seeing buttons that would 403.
//
// `viewMode` is derived from role AND relationship, so it stays correct despite the
// seed/invite inconsistency where a grandparent is sometimes "Limited Member" and
// sometimes "Guest/Helper". Relationship wins for view routing (a grandparent who is an
// Adult Member still gets the calm grandparent home).

export type Role =
  | "Owner" | "Adult Admin" | "Adult Member" | "Limited Member" | "Child View" | "Guest/Helper";

export type ViewMode = "owner" | "adult" | "child" | "grandparent" | "sitter";

// Highest authority first — must match server/auth.mjs ROLES.
const ROLE_RANK: Record<string, number> = {
  "Owner": 6, "Adult Admin": 5, "Adult Member": 4, "Limited Member": 3, "Child View": 2, "Guest/Helper": 1,
};
export function roleAtLeast(role: string | null | undefined, min: Role): boolean {
  return (ROLE_RANK[role ?? ""] ?? 0) >= (ROLE_RANK[min] ?? 999);
}

/* The Adult Member silo, client side.
 *
 * There are now TWO different questions, and conflating them is what made an Adult Member a
 * spectator in the first place:
 *
 *   canManageHousehold — may this person change things that run for EVERYONE (household
 *                        helpers, invites, AI providers)? Owner / Adult Admin.
 *   canManageOwn       — may this person build and run things for THEMSELVES? Any adult.
 *
 * These are cosmetic — the server is the source of truth (server/index.mjs mayWriteAgent) —
 * but getting them right is what stops the app showing a button that 403s, or hiding one that
 * would have worked.
 */
export function canManageHousehold(role: string | null | undefined): boolean {
  return role === "Owner" || role === "Adult Admin";
}
export function canManageOwn(role: string | null | undefined): boolean {
  return roleAtLeast(role, "Adult Member");
}

/** Connections (accounts and calendars) is closed to a Child View (ADR-005): the server gives
 *  them legend rows only, and a screen of doors that are all shut is no screen at all. */
export function canOpenConnections(role: string | null | undefined): boolean {
  return (role ?? "") !== "Child View";
}

export interface MemberLike {
  role?: string | null;
  relationship?: string | null;
  /** Adult-granted AI access for a child (default false). */
  aiEnabled?: boolean | null;
}

const rel = (m: MemberLike) => (m.relationship ?? "").toLowerCase();

export function isChild(m: MemberLike): boolean {
  return (m.role ?? "") === "Child View" || /\bchild\b|\bkid\b|\bteen\b|\bson\b|\bdaughter\b/.test(rel(m));
}
export function isGrandparent(m: MemberLike): boolean {
  return /grand(parent|ma|pa|mother|father)|nana|papa|grammy|grampa/.test(rel(m));
}
export function isHelper(m: MemberLike): boolean {
  // A Guest/Helper role, or a caregiving relationship (sitter/nanny/au pair/caregiver).
  return (m.role ?? "") === "Guest/Helper" || /sitter|babysitter|nanny|au ?pair|caregiver|helper/.test(rel(m));
}
export function isAdultRole(role: string | null | undefined): boolean {
  return role === "Owner" || role === "Adult Admin" || role === "Adult Member";
}

/**
 * Which home screen a signed-in member should land on.
 *
 * ROLE decides, relationship only breaks ties below the adult line. This used to be the other
 * way round — "relationship wins for view routing (a grandparent who is an Adult Member still
 * gets the calm grandparent home)" — and that was wrong in a way that took a whole video to
 * surface:
 *
 *   [v2 00:23] "On an adult member profile like my dad GPop… there is no calendar setup. I
 *              don't know where that occurs, but there's no settings for them. So they don't
 *              have the ability to get to connectors to add their email and their calendar."
 *   [v2 00:37] "They can't see a proper calendar. All they see is this. They can't actually
 *              click into these items to see details about them. They should be able to."
 *   [v2 01:11] "I do not see the tasks and lists centre here."
 *
 * None of that was a permission problem — the Adult Member silo already grants all of it. It
 * was routing: an adult grandparent was being handed the reduced grandparent home, which has
 * no Settings, Helpers or Library tab at all. Being someone's grandparent describes a
 * relationship to the family, not a reduced standing in the app.
 *
 * So: an adult is an adult. The calm grandparent and sitter homes remain for people who
 * genuinely have limited standing — a Guest/Helper, a Limited Member — where a stripped-back
 * screen is a kindness rather than a cage.
 */
export function viewModeFor(m: MemberLike | null | undefined): ViewMode {
  if (!m) return "adult";
  if ((m.role ?? "") === "Owner") return "owner";
  // A child is a child regardless of role — that gate protects them, and is the one place
  // relationship must still outrank an over-generous role assignment.
  if (isChild(m)) return "child";
  if (isAdultRole(m.role)) return "adult";
  if (isGrandparent(m)) return "grandparent";
  if (isHelper(m)) return "sitter";
  // Limited Member with no caregiving relationship — treat as a light adult view.
  return "adult";
}

export interface Capabilities {
  viewMode: ViewMode;
  isOwner: boolean;
  isAdult: boolean;
  /** Owner or Adult Admin — can manage members, invite, run household helpers. */
  canManage: boolean;
  canInvite: boolean;
  /** Any adult may build a helper for themselves; only an admin may make one for everyone. */
  canCreateHelpers: boolean;
  /** Can edit calendar events at all (server still enforces "own synced calendar only"). */
  canEditCalendar: boolean;
  canAssignChores: boolean;
  canUpload: boolean;
  canConnect: boolean;
  /** Chat with the AI. Children need an adult to enable it. */
  canUseAI: boolean;
}

export function capabilitiesFor(m: MemberLike | null | undefined): Capabilities {
  const viewMode = viewModeFor(m);
  const role = m?.role ?? null;
  const isOwner = role === "Owner";
  const isAdult = isAdultRole(role);
  const canManage = roleAtLeast(role, "Adult Admin");
  const child = viewMode === "child";
  return {
    viewMode,
    isOwner,
    isAdult,
    canManage,
    canInvite: canManage,
    /* [v2 02:13] "When he does eventually create an agent, he'll need an agents screen. He'll
     * need an agent himself. And so will Beannie."
     *
     * The server already lets any adult build a helper for themselves (the Adult Member silo);
     * this gate was still Adult-Admin-only, so the app hid the screen that would have worked.
     * A client gate stricter than the server's is just a feature nobody can find. */
    canCreateHelpers: isAdult,
    canEditCalendar: isAdult,
    canAssignChores: isAdult,
    canUpload: isAdult,
    // Grandparents/sitters may connect their own calendar; children may not.
    canConnect: isAdult || viewMode === "grandparent" || viewMode === "sitter",
    canUseAI: child ? !!m?.aiEnabled : true,
  };
}
