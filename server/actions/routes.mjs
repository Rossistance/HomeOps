// The HTTP door for declared actions (ADR-003).
//
// One function, called first from index.mjs's request chain, that answers any route a
// declared action claims and returns false for everything else. The order of checks is the
// order every hand-written route in index.mjs already runs — gate (origin, session, CSRF),
// then the action's own authorize, then the body, then the action — so a route that moves
// onto the registry keeps its exact refusals. The helpers come in as an options bag because
// they are module-local to index.mjs; that is the same seam family-messages-routes.mjs uses.
//
// What the door does NOT do: it does not know what an event is. Validation is the
// action's schema, meaning is the action's run, the audit row is the action's own
// http.audit — this file would look identical for tasks, meals or lists.
import { actionForRoute } from "./registry.mjs";

export async function handleActionRoutes({ req, res, path, method, url, gate, json, readBody, audit }) {
  const action = actionForRoute(method, path);
  if (!action) return false;

  const g = gate(req, { requireSession: true });
  if (!g.ok) { json(res, g.status, { error: g.error }, req); return true; }

  const denied = action.authorize ? action.authorize(g.session) : null;
  if (denied) { json(res, denied.status ?? 403, { error: denied.error ?? "forbidden", ...(denied.message ? { message: denied.message } : {}) }, req); return true; }

  const body = method === "GET" ? Object.fromEntries(url.searchParams) : await readBody(req);
  if (!body) { json(res, 400, { error: "malformed_json" }, req); return true; }

  // via:"user" is the ONLY thing the door tells the action about itself. runId/agentId are
  // null the way engine.mjs passes them for a chat turn: a person, not a run, is acting.
  const out = await action.invoke({ householdId: g.session.householdId, actorId: g.session.actorId, runId: null, agentId: null, via: "user" }, body);
  if (!out.ok) {
    json(res, action.errors[out.error] ?? 400, { error: out.error, message: out.message, ...(out.field ? { field: out.field } : {}) }, req);
    return true;
  }
  if (action.http.audit) audit(action.http.audit(out.result), req, g.session);
  json(res, 200, out.result, req);
  return true;
}
