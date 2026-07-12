// Central role → capability + view-mode resolver for the web app. Mirror of the mobile
// helper (apps/mobile/src/lib/roles.ts) so a member's view mode and gates are identical on
// both clients. The server (server/auth.mjs `gate`) is the source of truth for permissions;
// these checks only hide actions that would otherwise 403.
//
// `viewMode` is derived from role AND relationship (relationship wins), so it's stable
// despite the seed/invite inconsistency where a grandparent is sometimes "Limited Member"
// and sometimes "Guest/Helper".
import type { Role } from "@/types";

export type ViewMode = "owner" | "adult" | "child" | "grandparent" | "sitter";

const ROLE_RANK: Record<string, number> = {
  "Owner": 6, "Adult Admin": 5, "Adult Member": 4, "Limited Member": 3, "Child View": 2, "Guest/Helper": 1,
};
export function roleAtLeast(role: string | null | undefined, min: Role): boolean {
  return (ROLE_RANK[role ?? ""] ?? 0) >= (ROLE_RANK[min] ?? 999);
}

export interface MemberLike {
  role?: string | null;
  relationship?: string | null;
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
  return (m.role ?? "") === "Guest/Helper" || /sitter|babysitter|nanny|au ?pair|caregiver|helper/.test(rel(m));
}
export function isAdultRole(role: string | null | undefined): boolean {
  return role === "Owner" || role === "Adult Admin" || role === "Adult Member";
}

export function viewModeFor(m: MemberLike | null | undefined): ViewMode {
  if (!m) return "adult";
  if ((m.role ?? "") === "Owner") return "owner";
  if (isChild(m)) return "child";
  if (isGrandparent(m)) return "grandparent";
  if (isHelper(m)) return "sitter";
  if (isAdultRole(m.role)) return "adult";
  return "adult";
}

export interface Capabilities {
  viewMode: ViewMode;
  isOwner: boolean;
  isAdult: boolean;
  canManage: boolean;
  canInvite: boolean;
  canCreateAgents: boolean;
  canEditCalendar: boolean;
  canAssignChores: boolean;
  canUpload: boolean;
  canConnect: boolean;
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
    canConnect: isAdult || viewMode === "grandparent" || viewMode === "sitter",
    canUseAI: child ? !!m?.aiEnabled : true,
  };
}
