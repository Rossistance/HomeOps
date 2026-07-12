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

/** Which home screen a signed-in member should land on. Relationship-first so it's
 * stable regardless of the exact role a grandparent/sitter was granted. */
export function viewModeFor(m: MemberLike | null | undefined): ViewMode {
  if (!m) return "adult";
  if ((m.role ?? "") === "Owner") return "owner";
  if (isChild(m)) return "child";
  if (isGrandparent(m)) return "grandparent";
  if (isHelper(m)) return "sitter";
  if (isAdultRole(m.role)) return "adult";
  // Limited Member with no caregiving relationship — treat as a light adult view.
  return "adult";
}

export interface Capabilities {
  viewMode: ViewMode;
  isOwner: boolean;
  isAdult: boolean;
  /** Owner or Adult Admin — can manage members, invite, create/run agents. */
  canManage: boolean;
  canInvite: boolean;
  canCreateAgents: boolean;
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
    canCreateAgents: canManage,
    canEditCalendar: isAdult,
    canAssignChores: isAdult,
    canUpload: isAdult,
    // Grandparents/sitters may connect their own calendar; children may not.
    canConnect: isAdult || viewMode === "grandparent" || viewMode === "sitter",
    canUseAI: child ? !!m?.aiEnabled : true,
  };
}
