import type { AppData, SearchResult } from "@/types";
import { surfaceForTask } from "@/lib/taskSurfaces";
import { fmtDateTime } from "@/lib/dates";

/** Build a flat search index spanning every major entity in the household. */
export function buildSearchIndex(data: AppData): SearchResult[] {
  const out: SearchResult[] = [];

  for (const a of data.agents) {
    out.push({
      id: a.id,
      title: a.name,
      type: "Agent",
      summary: a.purpose,
      tags: [a.status, ...a.safetyLimits.slice(0, 1)],
      spaceId: a.spaceId,
      agentId: a.id,
      updatedAt: a.updatedAt,
      route: { screen: "agents", params: { id: a.id } },
      icon: a.icon,
    });
  }
  for (const a of data.automations) {
    out.push({
      id: a.id,
      title: a.name,
      type: "Automation",
      summary: a.description,
      tags: [a.triggerType, a.status],
      spaceId: a.spaceId,
      agentId: a.agentId,
      updatedAt: a.updatedAt,
      route: { screen: "automations", params: { id: a.id } },
      icon: "Workflow",
    });
  }
  for (const t of data.threads) {
    out.push({
      id: t.id,
      title: t.title,
      type: "Message",
      summary: t.preview,
      tags: [t.status],
      spaceId: t.spaceId,
      updatedAt: t.updatedAt,
      route: { screen: "messages", params: { thread: t.id } },
      icon: "MessageSquare",
    });
  }
  for (const f of data.files) {
    out.push({
      id: f.id,
      title: f.name,
      type: "File",
      summary: f.summary,
      tags: [f.type, ...f.tags, ...(f.sensitive ? ["Sensitive"] : [])],
      spaceId: f.spaceId,
      updatedAt: f.uploadedAt,
      route: { screen: "files", params: { file: f.id } },
      icon: "FileText",
    });
  }
  for (const k of data.knowledge) {
    out.push({
      id: k.id,
      title: k.title,
      type: "Knowledge",
      summary: k.content.slice(0, 120),
      tags: [k.type, ...k.tags],
      spaceId: k.spaceId,
      updatedAt: k.updatedAt,
      route: { screen: "files", params: { tab: "knowledge", item: k.id } },
      icon: "BookOpen",
    });
  }
  for (const p of data.playbooks) {
    out.push({
      id: p.id,
      title: p.name,
      type: "Playbook",
      summary: p.description,
      tags: [p.category],
      updatedAt: p.updatedAt,
      route: { screen: "playbooks", params: { id: p.id } },
      icon: "ScrollText",
    });
  }
  for (const m of data.miniApps) {
    out.push({
      id: m.id,
      title: m.name,
      type: "Mini App",
      summary: m.description,
      tags: [m.type, m.status],
      spaceId: m.spaceId,
      updatedAt: m.updatedAt,
      route: { screen: "miniapps", params: { id: m.id } },
      icon: "LayoutGrid",
    });
  }
  for (const mem of data.memories) {
    out.push({
      id: mem.id,
      title: mem.title,
      type: "Memory",
      summary: mem.content,
      tags: [mem.type, ...(mem.sensitive ? ["Sensitive"] : []), ...(mem.userApproved ? ["Approved"] : ["Unverified"])],
      spaceId: mem.spaceId,
      agentId: mem.agentId,
      updatedAt: mem.updatedAt,
      route: { screen: "activity", params: { tab: "memory", id: mem.id } },
      icon: "Brain",
    });
  }
  for (const ap of data.approvals) {
    out.push({
      id: ap.id,
      title: ap.title,
      type: "Approval",
      summary: ap.proposedAction,
      tags: [ap.riskLevel, ap.status],
      spaceId: ap.spaceId,
      agentId: ap.requestedByAgentId,
      updatedAt: ap.updatedAt,
      route: { screen: "messages", params: { tab: "approvals", approval: ap.id } },
      icon: "ShieldCheck",
    });
  }
  for (const m of data.members) {
    out.push({
      id: m.id,
      title: m.displayName,
      type: "Member",
      summary: `${m.role} · ${m.relationship}`,
      tags: [m.role],
      updatedAt: m.updatedAt,
      route: { screen: "spaces", params: { tab: "members", member: m.id } },
      icon: "User",
    });
  }
  for (const s of data.spaces) {
    out.push({
      id: s.id,
      title: s.name,
      type: "Space",
      summary: s.description,
      tags: [s.type, ...(s.sensitive ? ["Sensitive"] : [])],
      spaceId: s.id,
      updatedAt: s.updatedAt,
      route: { screen: "spaces", params: { space: s.id } },
      icon: s.icon,
    });
  }
  // Events, tasks and chats — the things a family most often types into "Search everything",
  // and the three the index used to leave out entirely.
  for (const e of data.events) {
    out.push({
      id: e.id, title: e.title, type: "Event",
      summary: `${e.startAt ? fmtDateTime(e.startAt) : "No date"}${e.location ? ` · ${e.location}` : ""}`,
      tags: [e.allDay ? "All day" : "Event"], spaceId: e.spaceId, updatedAt: e.startAt,
      route: { screen: "calendar", params: { event: e.id } }, icon: "CalendarDays",
    });
  }
  for (const t of data.tasks) {
    if (String(t.status) === "archived") continue;
    const surface = surfaceForTask(t);
    out.push({
      id: t.id, title: t.title, type: "Task",
      summary: `${t.type}${t.dueAt ? ` · due ${fmtDateTime(t.dueAt)}` : ""}${t.listName ? ` · ${t.listName}` : ""}`,
      tags: [t.status], spaceId: t.spaceId, updatedAt: t.updatedAt,
      route: surface ?? { screen: "miniapps" }, icon: t.type === "list" ? "ShoppingCart" : "ListChecks",
    });
  }
  for (const c of data.conversations ?? []) {
    const last = [...c.messages].reverse().find((m) => m.text)?.text ?? "";
    out.push({
      id: c.id, title: c.title, type: "Chat", summary: last.slice(0, 120), tags: ["Ask"], updatedAt: c.updatedAt,
      route: { screen: "assistant", params: { id: c.id } }, icon: "MessageSquare",
    });
  }
  for (const e of data.activity.slice(0, 200)) {
    out.push({
      id: e.id,
      title: e.description,
      type: "Activity",
      summary: `${e.actorName} · ${e.actionType}`,
      tags: [e.status],
      spaceId: e.spaceId,
      updatedAt: e.timestamp,
      route: { screen: "activity", params: { entry: e.id } },
      icon: "Activity",
    });
  }
  return out;
}

/** Score a single result against the query (simple token overlap + prefix). */
function score(result: SearchResult, q: string): number {
  const query = q.toLowerCase().trim();
  if (!query) return 0;
  const hay = `${result.title} ${result.summary} ${result.tags.join(" ")} ${result.type}`.toLowerCase();
  const title = result.title.toLowerCase();
  let s = 0;
  if (title.startsWith(query)) s += 10;
  if (title.includes(query)) s += 6;
  if (hay.includes(query)) s += 3;
  for (const tok of query.split(/\s+/)) {
    if (tok.length < 2) continue;
    if (title.includes(tok)) s += 2;
    else if (hay.includes(tok)) s += 1;
  }
  return s;
}

export function search(index: SearchResult[], query: string, limit = 12): SearchResult[] {
  if (!query.trim()) return [];
  return index
    .map((r) => ({ r, s: score(r, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.r);
}
