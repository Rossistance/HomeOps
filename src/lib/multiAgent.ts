// WP-101 s5 — one predicate for "do this template's named specialists actually exist in
// this household?", shared by every surface that claims them: the Templates grid chip,
// the template detail roster, and the compile step that decides whether to send
// multiAgentRoles to the server preflight. It lives in one place on purpose — the defect
// being closed is one surface advertising specialists another surface won't deliver, and
// separate per-surface copies of the check is exactly how that drifts back.
//
// Mirrors server/automation-preflight.mjs validateMultiAgentRoles: match by name,
// case-insensitively, against agents that aren't archived. An empty/blank role name never
// resolves (the server treats it as unassigned too).
import type { Agent } from "@/types";

type AgentLike = Pick<Agent, "name" | "status">;
type MultiAgentRole = { name: string };

const norm = (s: string) => s.trim().toLowerCase();

export function roleResolvesToAgent(agents: AgentLike[], name: string): boolean {
  const wanted = norm(name);
  return !!wanted && agents.some((a) => a.status !== "Archived" && norm(a.name) === wanted);
}

/** True only when the template names at least one specialist AND every one of them matches
 *  a real, non-archived agent. A partially-resolved roster is never "resolved" — six
 *  advertised specialists with one real agent behind them is the thing this prevents. */
export function multiAgentRosterResolved(agents: AgentLike[], roster?: MultiAgentRole[] | null): boolean {
  return !!roster?.length && roster.every((m) => roleResolvesToAgent(agents, m.name));
}
