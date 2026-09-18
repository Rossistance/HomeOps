// Pure helpers for the Inbox and family Messages — no React, no network — so the rules
// that decide what a person sees can be tested on their own.
import type { MemberRec, MessageRec, NestRec, NotificationRec, ThreadRec } from "./api";

export interface SourceChip {
  /** Stable key: `all`, `helper:<id>`, `assistant`, `thread`, `system`. */
  key: string;
  label: string;
  kind: "all" | "helper" | "assistant" | "thread" | "system";
  /** The helper's own chat thread, when the chip is a helper. */
  conversationId?: string | null;
}

/**
 * The chips across the top of Updates. Every helper appears whether or not it has
 * delivered anything yet (a family should see "Morning Briefing" is a source before its
 * first run), then Famili, then Family messages and System only when such rows exist.
 */
export function notificationSources(
  notes: NotificationRec[],
  helpers: { id: string; name: string; conversationId?: string | null }[],
): SourceChip[] {
  const out: SourceChip[] = [{ key: "all", label: "All", kind: "all" }];
  const seen = new Set<string>();
  for (const h of helpers) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    out.push({ key: `helper:${h.id}`, label: h.name, kind: "helper", conversationId: h.conversationId ?? null });
  }
  // Helpers that delivered but are no longer in the roster (deleted) still get a chip, named
  // from the row, so their past updates stay reachable.
  for (const n of notes) {
    const s = n.source;
    if (s?.kind === "helper" && s.id && !seen.has(s.id)) {
      seen.add(s.id);
      out.push({ key: `helper:${s.id}`, label: s.name || "Former helper", kind: "helper", conversationId: n.conversationId ?? null });
    }
  }
  if (notes.some((n) => n.source?.kind === "assistant")) out.push({ key: "assistant", label: "Famili", kind: "assistant" });
  if (notes.some((n) => n.source?.kind === "thread")) out.push({ key: "thread", label: "Family", kind: "thread" });
  if (notes.some((n) => !n.source || n.source.kind === "system" || n.source.kind === "member")) out.push({ key: "system", label: "System", kind: "system" });
  return out;
}

/** Which chip a notification belongs under. */
export function sourceKeyOf(n: NotificationRec): string {
  const s = n.source;
  if (!s) return "system";
  if (s.kind === "helper" && s.id) return `helper:${s.id}`;
  if (s.kind === "assistant") return "assistant";
  if (s.kind === "thread") return "thread";
  return "system";
}

/** Where a tap on a notification should go, beyond marking it read. */
export function notificationTarget(n: NotificationRec): { pathname: string; params?: Record<string, string> } | null {
  const d = n.data ?? undefined;
  if (n.threadId || d?.type === "thread") return { pathname: "/messages/[id]", params: { id: String(n.threadId ?? d?.id) } };
  if (d?.type === "event" && d.id) return { pathname: "/event-form", params: { id: d.id } };
  if (d?.type === "task" && d.id) return { pathname: "/tasks", params: { id: d.id } };
  if (d?.type === "help_request") return { pathname: "/help" };
  if (d?.type === "approval") return { pathname: "/inbox", params: { seg: "approvals" } };
  return null;
}

/* ---- threads ------------------------------------------------------------------------- */

const PARENT = new Set(["Owner", "Adult Admin"]);
const ADULT = new Set(["Owner", "Adult Admin", "Adult Member"]);
const CHILD = new Set(["Child View", "Limited Member"]);

/**
 * Mirror of the server's canMessage for the picker, so the list only offers people a
 * request would succeed for. The server still decides.
 */
export function canStartWith(me: MemberRec | null | undefined, other: MemberRec, nests: NestRec[]): boolean {
  if (!me || me.actorId === other.actorId) return false;
  if (me.role === "Guest/Helper" || other.role === "Guest/Helper") return false;
  if (CHILD.has(me.role)) return false;
  if (ADULT.has(other.role)) return true;
  if (PARENT.has(me.role)) return true;
  if (me.role === "Adult Member") {
    return nests.some((n) => {
      const joined = n.members.filter((m) => m.status === "joined").map((m) => m.actorId);
      return joined.includes(me.actorId) && joined.includes(other.actorId);
    });
  }
  return false;
}

/** "Melissa" for a direct thread, the title or "Melissa, GPop" for a group — never my own name. */
export function threadTitle(t: ThreadRec, meActorId: string | null | undefined): string {
  if (t.title) return t.title;
  const others = t.members.filter((m) => !m.leftAt && m.actorId !== meActorId).map((m) => m.displayName.split(" ")[0]);
  if (others.length === 0) return "Just you";
  if (others.length <= 3) return others.join(", ");
  return `${others.slice(0, 2).join(", ")} +${others.length - 2}`;
}

/** Local calendar day for grouping; the phone's zone is the reader's zone. */
export function dayKeyOf(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Messages oldest → newest, split into days, each day oldest → newest. */
export function groupByDay(messages: MessageRec[]): { day: string; items: MessageRec[] }[] {
  const sorted = [...messages].sort((a, b) => a.at.localeCompare(b.at));
  const out: { day: string; items: MessageRec[] }[] = [];
  for (const m of sorted) {
    const day = dayKeyOf(m.at);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(m); else out.push({ day, items: [m] });
  }
  return out;
}

/** "Today", "Yesterday", "Mon, Sep 14" — relative to `today` (a day key). */
export function dayLabel(day: string, today: string = dayKeyOf(new Date().toISOString())): string {
  if (day === today) return "Today";
  const [y, mo, d] = day.split("-").map(Number);
  const date = new Date(y, mo - 1, d);
  const t = today.split("-").map(Number);
  const yesterday = new Date(t[0], t[1] - 1, t[2] - 1);
  if (date.getTime() === yesterday.getTime()) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(date.getFullYear() !== t[0] ? { year: "numeric" } : {}) });
}

/** 0:07, 1:32 — voice-note lengths. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Receipts: for each reader other than me, the LAST message they have read past — keyed by
 * message id. A direct thread shows one "Seen", a group shows "Seen by A, B".
 */
export function receiptsFor(messages: MessageRec[], readBy: Record<string, string | null>, meActorId: string | null | undefined): Record<string, string[]> {
  const sorted = [...messages].filter((m) => !m.deletedAt).sort((a, b) => a.at.localeCompare(b.at));
  const out: Record<string, string[]> = {};
  for (const [actorId, at] of Object.entries(readBy)) {
    if (!at || actorId === meActorId) continue;
    let last: MessageRec | null = null;
    for (const m of sorted) { if (m.at <= at && m.fromActorId !== actorId) last = m; }
    if (last) (out[last.id] ??= []).push(actorId);
  }
  return out;
}
