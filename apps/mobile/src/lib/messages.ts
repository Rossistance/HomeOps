// Pure helpers for the Inbox and family Messages — no React, no network — so the rules
// that decide what a person sees can be tested on their own.
import type { NotificationRec } from "./api";

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
