// FamiliOS — one declaration per capability (ADR-003).
//
// WHY THIS EXISTS. "Create a calendar event" was written twice — once as the HTTP route
// (index.mjs, POST /api/events) and once as the agent tool (internal-functions.mjs,
// homeops.create_event_draft) — and its INPUT contract lived in four more places joined by
// string key at request time: INTERNAL_INPUTS (keys only), the provider/connector inline
// `inputs`, and KEY_HINTS, a by-key-name global that held the only real types. Each client
// then hand-wrote what it believed the server returned, and both were wrong in different
// ways. That is not untidiness; it is how a tool the prompt tells the model to call
// (homeops__get_agent) could fail to exist in the registry with nothing to notice.
//
// A declared action is the ONE place a capability is described. From it come: the registry
// entry the run engine and the chat loop already consume (their shape is unchanged), the
// INTERNAL_INPUTS row the planner reads (derived, never hand-kept), the JSON Schema the AI
// SDK's jsonSchema() receives verbatim, the HTTP handler, and the TypeScript both clients
// import. The AI SDK, the policy ladder and executeToolForChat are untouched; this sits
// underneath them.
//
// WHAT THIS DELIBERATELY DOES NOT DO. It does not pull in a schema library, a validator or a
// codegen package. The schema subset this file understands is SUPPORTED_KEYWORDS, and that
// list is ONE fence shared by the definition check, the validator and the TypeScript
// emitter: a keyword none of them knows is refused at boot, so nobody can write a schema
// that one of them silently ignores. That fence is the whole guarantee.
//
// The idea is borrowed from BuilderIO/agent-native's defineAction. The package was not: it
// brings its own server, database, auth and a React 19 UI shell, and would replace the most
// careful parts of this codebase with less expressive ones. ADR-003 has the numbers.

/** Every schema keyword the validator AND the TypeScript emitter understand. Nothing else
 *  may appear in an action's schema — assertSchema refuses it at load. */
export const SUPPORTED_KEYWORDS = Object.freeze([
  "type", "properties", "required", "items", "enum", "additionalProperties", "description", "$ref",
]);
const TYPES = new Set(["string", "number", "boolean", "null", "object", "array"]);
const ACTION_VERBS = new Set(["Read", "Write", "Send"]);
const RISKS = new Set(["Low", "Medium", "High", "Sensitive"]);
const METHODS = new Set(["GET", "POST", "PATCH", "DELETE"]);
const ID_RE = /^[a-z]+\.[a-z_]+$/;
const REF_RE = /^#\/\$defs\/([A-Za-z][A-Za-z0-9]*)$/;

function deepFreeze(o) {
  if (o && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}
const join = (path, key) => (path ? `${path}.${key}` : key);
const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);

/** Refuse, at load, any schema the validator or the emitter would not understand. */
export function assertSchema(schema, where, defs = {}) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error(`${where}: a schema must be an object`);
  for (const k of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.includes(k)) throw new Error(`${where}: unsupported schema keyword "${k}" — teach the validator AND the emitter (SUPPORTED_KEYWORDS) or do not use it`);
  }
  if (schema.$ref !== undefined) {
    const m = REF_RE.exec(String(schema.$ref));
    if (!m) throw new Error(`${where}: $ref must look like #/$defs/Name, got ${JSON.stringify(schema.$ref)}`);
    if (!defs[m[1]]) throw new Error(`${where}: $ref to unknown $defs.${m[1]}`);
    if (Object.keys(schema).some((k) => k !== "$ref" && k !== "description")) throw new Error(`${where}: a $ref schema carries only a description`);
    return;
  }
  const types = schema.type === undefined ? [] : Array.isArray(schema.type) ? schema.type : [schema.type];
  for (const t of types) if (!TYPES.has(t)) throw new Error(`${where}: unknown type "${t}"`);
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) throw new Error(`${where}: enum must be a non-empty array`);
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required)) throw new Error(`${where}: required must be an array of property names`);
    for (const r of schema.required) if (!schema.properties || !(r in schema.properties)) throw new Error(`${where}: required "${r}" is not a declared property`);
  }
  if (schema.properties !== undefined) {
    if (!schema.properties || typeof schema.properties !== "object") throw new Error(`${where}: properties must be an object`);
    for (const [k, v] of Object.entries(schema.properties)) assertSchema(v, `${where}.${k}`, defs);
  }
  if (schema.items !== undefined) assertSchema(schema.items, `${where}[]`, defs);
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") assertSchema(schema.additionalProperties, `${where}.*`, defs);
}

/* Shape validation only. `run` keeps every SEMANTIC check (a timestamp that parses, a
 * member who exists, an end after its start) — the validator says what a field IS, the
 * action says what it MEANS. Two modes for keys the schema does not declare, because the
 * two callers need different things: the HTTP path strips them (the mobile form sends
 * `localNotes` on create today and must not start failing), the contract test rejects
 * them (a stored record with a key the schema does not know is a schema bug). */
function coerceScalar(v, types) {
  if (typeof v !== "string") return v;
  if (types.includes("boolean") && (v === "true" || v === "false")) return v === "true";
  if (types.includes("number") && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return v;
}
export function validateInput(schema, value, { unknown = "reject", coerce = false, defs = {} } = {}) {
  const stripped = [];
  const fail = (field, message) => ({ ok: false, error: "invalid_input", field, message });
  const walk = (s, v, path) => {
    if (s.$ref) return walk(defs[REF_RE.exec(s.$ref)[1]], v, path);
    const types = s.type === undefined ? null : Array.isArray(s.type) ? s.type : [s.type];
    if (types && coerce) v = coerceScalar(v, types);
    const actual = typeOf(v);
    if (types && !types.includes(actual)) return fail(path, `${path || "input"} must be ${types.join(" or ")}, got ${actual}`);
    if (s.enum && !s.enum.includes(v)) return fail(path, `${path || "input"} must be one of ${s.enum.map(String).join(", ")}`);
    if (actual === "object" && (s.properties || s.required || s.additionalProperties !== undefined)) {
      const props = s.properties ?? {};
      for (const r of s.required ?? []) if (v[r] === undefined) return fail(join(path, r), `${join(path, r)} is required`);
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        if (val === undefined) continue;
        if (k in props) { const r = walk(props[k], val, join(path, k)); if (r.ok === false) return r; out[k] = r.value; continue; }
        if (s.additionalProperties === false) {
          if (unknown === "reject") return fail(join(path, k), `${join(path, k)} is not a known field`);
          stripped.push(join(path, k)); continue;
        }
        if (s.additionalProperties && typeof s.additionalProperties === "object") {
          const r = walk(s.additionalProperties, val, join(path, k)); if (r.ok === false) return r; out[k] = r.value; continue;
        }
        out[k] = val;
      }
      return { value: out };
    }
    if (actual === "array" && s.items) {
      const out = [];
      for (let i = 0; i < v.length; i++) { const r = walk(s.items, v[i], `${path}[${i}]`); if (r.ok === false) return r; out.push(r.value); }
      return { value: out };
    }
    return { value: v };
  };
  const r = walk(schema, value, "");
  if (r.ok === false) return r;
  return { ok: true, value: r.value, stripped };
}

/**
 * Declare a capability once. Returns a frozen action carrying the derived forms:
 *   invoke(ctx, raw)       validate (strip unknown, coerce scalars) → run
 *   toInternalFunction()   the INTERNAL_FUNCTIONS entry the engine already consumes
 *   toInternalInputs()     the INTERNAL_INPUTS row the planner already reads
 * `ctx.via` is "user" (HTTP) or "agent" (engine/chat); toInternalFunction defaults it to
 * "agent" so every existing caller — and every existing test — needs no change.
 */
export function defineAction(def) {
  const where = `defineAction(${def?.id ?? "?"})`;
  if (!def || typeof def !== "object") throw new Error("defineAction: the definition must be an object");
  for (const k of ["id", "name", "description", "action", "risk", "input", "run", "errorCodes"]) if (def[k] === undefined) throw new Error(`${where}: "${k}" is required`);
  if (!ID_RE.test(def.id)) throw new Error(`${where}: id must look like namespace.snake_case`);
  if (!ACTION_VERBS.has(def.action)) throw new Error(`${where}: action must be Read | Write | Send`);
  if (!RISKS.has(def.risk)) throw new Error(`${where}: risk must be Low | Medium | High | Sensitive`);
  if (typeof def.run !== "function") throw new Error(`${where}: run must be a function`);
  if (!Array.isArray(def.errorCodes) || def.errorCodes.length === 0) throw new Error(`${where}: errorCodes must list every error code run can return`);
  const defs = def.$defs ?? {};
  for (const [n, s] of Object.entries(defs)) assertSchema(s, `${where}.$defs.${n}`, defs);
  assertSchema(def.input, `${where}.input`, defs);
  if (def.output !== undefined) assertSchema(def.output, `${where}.output`, defs);
  if (def.http !== undefined) {
    if (!METHODS.has(def.http?.method)) throw new Error(`${where}: http.method must be GET | POST | PATCH | DELETE`);
    if (typeof def.http.path !== "string" || !def.http.path.startsWith("/api/")) throw new Error(`${where}: http.path must start with /api/`);
    if (def.http.audit !== undefined && typeof def.http.audit !== "function") throw new Error(`${where}: http.audit must be a function`);
  }
  if (def.authorize !== undefined && typeof def.authorize !== "function") throw new Error(`${where}: authorize must be a function`);
  /* agent:false is an HTTP-only action — a declared READ the clients call, that the model
   * is deliberately not shown (it has its own windowed, channel-scoped native read). It is
   * kept out of the registry and the catalog, so it must have a door of its own. */
  const agent = def.agent !== false;
  if (!agent && def.http === undefined) throw new Error(`${where}: an action with agent:false must have an http door, or nothing can reach it`);
  const errors = def.errors ?? {};
  for (const [code, status] of Object.entries(errors)) {
    if (!def.errorCodes.includes(code)) throw new Error(`${where}: errors.${code} is not in errorCodes`);
    if (!Number.isInteger(status) || status < 400 || status > 599) throw new Error(`${where}: errors.${code} must be an HTTP error status`);
  }
  if (!def.errorCodes.includes("invalid_input")) throw new Error(`${where}: errorCodes must include "invalid_input" — the validator can return it`);

  const warned = new Set();
  const action = {
    ...def,
    requiresApproval: !!def.requiresApproval, delivers: !!def.delivers,
    connectorId: def.connectorId ?? "homeops", connectorName: def.connectorName ?? "FamiliOS",
    $defs: defs, errors, agent,
    async invoke(ctx, raw) {
      const v = validateInput(def.input, raw ?? {}, { unknown: "strip", coerce: true, defs });
      if (!v.ok) return v;
      for (const k of v.stripped) {
        const key = `${def.id}:${k}`;
        if (!warned.has(key)) { warned.add(key); console.warn(`[actions] ${def.id}: ignoring undeclared input field "${k}"`); }
      }
      const out = await def.run(ctx, v.value);
      /* The declared output is checked on the way out — and only WARNED about, once per
       * field per process. Writers are held to the schema at the write (newEventRecord /
       * newTaskRecord throw); a read may meet rows written years before the schema existed,
       * and refusing to load a family's calendar over a stray key would be the wrong
       * failure. The log names the key so the schema can be extended; the contract tests,
       * on fresh data, reject. */
      if (def.output && out?.ok && out.result !== undefined) {
        const o = validateInput(def.output, out.result, { unknown: "reject", defs });
        if (!o.ok) {
          const key = `${def.id}:out:${o.field}`;
          if (!warned.has(key)) { warned.add(key); console.warn(`[actions] ${def.id}: result does not fit its declared output — ${o.field}: ${o.message}`); }
        }
      }
      return out;
    },
    toInternalFunction() {
      if (!agent) throw new Error(`${def.id} is HTTP-only (agent:false) and has no registry entry`);
      return Object.freeze({
        id: def.id, name: def.name, description: def.description, action: def.action, risk: def.risk,
        requiresApproval: action.requiresApproval, delivers: action.delivers,
        connectorId: action.connectorId, connectorName: action.connectorName,
        run: (ctx, input) => action.invoke({ via: "agent", ...(ctx ?? {}) }, input),
      });
    },
    toInternalInputs() {
      if (!agent) throw new Error(`${def.id} is HTTP-only (agent:false) and has no planner row`);
      const required = new Set(def.input.required ?? []);
      return Object.freeze(Object.entries(def.input.properties ?? {}).map(([key, s]) =>
        Object.freeze({ key, required: required.has(key), ...(s.description ? { label: s.description } : {}) })));
    },
  };
  deepFreeze(action.input); if (action.output) deepFreeze(action.output); deepFreeze(action.$defs);
  Object.freeze(action.errors); Object.freeze(action.errorCodes); if (action.http) Object.freeze(action.http);
  return Object.freeze(action);
}
