// Every declared action, and the two lookups the rest of the server needs: by id (the chat
// loop, to hand the AI SDK the action's own schema) and by route (the HTTP seam in
// index.mjs). Built once at load and refused at load if two actions share an id or a route —
// a second claimant is a bug, not a tie to break at request time.
//
// This module is a LEAF: it reaches only actions/*, the store and the small helpers they
// use. It must never import context.mjs or internal-functions.mjs, because both of those
// import it (context → internal-functions → here), and a cycle would leave INTERNAL_INPUTS
// half-built. The import-order smoke test in server/test/actions-define.test.mjs pins this.
import { createEvent } from "./events.mjs";
import { createTask, createListItem } from "./tasks.mjs";
import { readEvents, readTasks } from "./reads.mjs";

export function buildRegistry(actions) {
  const byId = new Map(), byRoute = new Map();
  for (const a of actions) {
    if (byId.has(a.id)) throw new Error(`actions: duplicate id ${a.id}`);
    byId.set(a.id, a);
    if (a.http) {
      const key = `${a.http.method} ${a.http.path}`;
      if (byRoute.has(key)) throw new Error(`actions: ${a.id} and ${byRoute.get(key).id} both claim ${key}`);
      byRoute.set(key, a);
    }
  }
  return { byId, byRoute };
}

export const ACTIONS = Object.freeze([createEvent, createTask, createListItem, readEvents, readTasks]);
const { byId, byRoute } = buildRegistry(ACTIONS);

export const getAction = (id) => byId.get(id) ?? null;
export const actionForRoute = (method, path) => byRoute.get(`${method} ${path}`) ?? null;

/* Only actions the model may call reach the planner and the engine. An HTTP-only read
 * (agent:false) answers its route and nothing else — the model has its own native read. */
const AGENT_ACTIONS = ACTIONS.filter((a) => a.agent);
/** Spread into INTERNAL_INPUTS (context.mjs) — the planner's input rows, derived. */
export const ACTION_INPUTS = Object.freeze(Object.fromEntries(AGENT_ACTIONS.map((a) => [a.id, a.toInternalInputs()])));
/** Spread into INTERNAL_FUNCTIONS (internal-functions.mjs) — the engine's entries, derived. */
export const ACTION_INTERNAL_FUNCTIONS = Object.freeze(Object.fromEntries(AGENT_ACTIONS.map((a) => [a.id, a.toInternalFunction()])));
