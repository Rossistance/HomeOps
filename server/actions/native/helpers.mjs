// The native helper-management tools (ADR-004 Stage 1): famili.list_helpers, create_helper,
// update_helper and run_helper.
//
/* ------------------------------ helpers ------------------------------------
 * The old design had ONE tool here — propose_build — which did not build anything.
 * It returned a card describing a "skill" with steps, an "agent" to own it and an
 * "automation" to fire it, and the family had to confirm three concepts they had
 * never been taught in order to get a reminder. Worse, the card rendered whether or
 * not anything was possible, so a request the app could not satisfy still came back
 * looking like a plan.
 *
 * A helper is now made the same way anything else in this app is made: the tool
 * creates it, and the assistant says what it created and when it will next run. */
//
// On the menu only for an adult who is not a helper run, and never in the group thread
// (managesHelpers, ./shared.mjs) — the prompt already said so; this is where it is enforced.
// The bodies are the ones that lived inline in assistant-agent.mjs nativeTools(), moved
// unchanged but for two things: helpers.mjs is reached at CALL time (below), and nothing
// sets ctx.helperChanged any more — no client ever read it.
import { SCHEDULE_KINDS } from "../../helper-shape.mjs";
import { defineAction } from "../define-action.mjs";
import { short, nativeScope, managesHelpers, PROJECTION } from "./shared.mjs";

/* helpers.mjs reaches the engine, the registry and context.mjs (through triggers.mjs), and
 * the registry imports THIS file — a static import would close that loop at load and leave
 * INTERNAL_FUNCTIONS half-built. So it is reached when a tool runs, the same way helpers.mjs
 * itself reaches runAssistantAgent only at call time; by then every module is loaded. */
const helpersModule = () => import("../../helpers.mjs");

const NATIVE = { requiresApproval: false, delivers: false, lane: "native", available: managesHelpers };

const scheduleSchema = {
  type: "object",
  description: "When it runs. Leave it out for a helper the family runs by hand.",
  properties: {
    kind: { type: "string", enum: SCHEDULE_KINDS, description: "manual, hourly, daily or weekly." },
    time: { type: "string", description: "Time of day on the household clock, 24-hour HH:MM. Needed for daily and weekly." },
    weekday: { type: "number", description: "0 = Sunday … 6 = Saturday. Needed for weekly." },
  },
  required: ["kind"], additionalProperties: false,
};

export const familiListHelpers = defineAction({
  id: "famili.list_helpers",
  name: "List the family's helpers",
  description: "List the helpers this household has, what each one does, when it runs and how it last went. Use it before creating one (so you extend an existing helper instead of making a near-duplicate) and to answer any question about what the helpers are doing.",
  action: "Read", risk: "Low", timeoutMs: 60_000, ...NATIVE,
  input: { type: "object", properties: {}, additionalProperties: false },
  output: { type: "object", properties: { helpers: { type: "array", items: PROJECTION } }, required: ["helpers"], additionalProperties: false },
  errorCodes: ["invalid_input"],
  async run(ctx) {
    const { session, channel } = nativeScope(ctx);
    const { listHelpers, publicHelper } = await helpersModule();
    // A PERSONAL helper is not named into a shared thread, not even to its own owner.
    return { ok: true, result: { helpers: listHelpers(session)
      .filter((h) => channel !== "group" || String(h.visibility ?? "household") === "household")
      .map((h) => {
      const v = publicHelper(h, session);
      return { id: v.id, name: v.name, purpose: v.purpose, instructions: short(v.instructions, 400), schedule: v.scheduleText, autonomy: v.autonomyText, enabled: v.enabled, lastRun: v.lastRun ? { at: new Date(v.lastRun.at).toISOString(), ok: v.lastRun.ok, summary: v.lastRun.summary } : null };
    }) } };
  },
});

export const familiCreateHelper = defineAction({
  id: "famili.create_helper",
  name: "Create a helper",
  description: "Create a standing helper that does a job over and over — \"every morning…\", \"each week…\", \"from now on…\", \"remind us whenever…\". The instructions you write ARE the helper: write them as a clear paragraph addressed to the helper, saying what to look at, what to do, what to leave alone, and how to report back. It is created immediately, so tell the family its name, when it next runs and that they can edit or pause it in Helpers. Never use this for a one-off request — just do that now.",
  action: "Write", risk: "Medium", timeoutMs: 60_000, ...NATIVE,
  input: { type: "object", properties: {
    name: { type: "string", description: "Short, plain name the family will recognise, e.g. \"Morning Briefing\"." },
    purpose: { type: "string", description: "One sentence: what it is for." },
    instructions: { type: "string", description: "The helper's standing instructions, in plain English, written to the helper." },
    schedule: scheduleSchema,
    autonomy: { type: "string", enum: ["ask", "act"], description: "ask = it checks with the family before doing anything; act = it does everyday things itself and still asks before sending or spending. Default ask." },
    visibility: { type: "string", enum: ["household", "personal"], description: "household = the whole family, personal = just this person. Default household." },
  }, required: ["name", "instructions"], additionalProperties: false },
  output: {
    type: "object",
    properties: {
      created: { type: "boolean" }, helperId: { type: "string" }, name: { type: "string" },
      schedule: { type: "string" }, autonomy: { type: "string" }, visibility: { type: "string" }, note: { type: "string" },
    },
    required: ["created", "helperId", "name", "schedule", "autonomy", "visibility"], additionalProperties: false,
  },
  errorCodes: ["invalid_input", "name_required", "instructions_required"],
  async run(ctx, input) {
    const { session } = nativeScope(ctx);
    const { createHelper, publicHelper } = await helpersModule();
    const name = String(input?.name ?? "").trim();
    const instructions = String(input?.instructions ?? "").trim();
    if (!name) return { ok: false, error: "name_required", message: "Give the helper a name." };
    if (instructions.length < 20) return { ok: false, error: "instructions_required", message: "Write the helper real instructions — a sentence or two saying what it should actually do." };
    // An Adult Member gets a helper of their own; making one for the whole family is an
    // Owner/Adult Admin act, and saying so beats silently creating a narrower thing.
    const visibility = session.role === "Adult Member" ? "personal" : (input?.visibility === "personal" ? "personal" : "household");
    const h = createHelper({
      name, purpose: input?.purpose ?? "", instructions,
      schedule: input?.schedule, visibility,
      // "full" autonomy is never granted from a chat message: it is the one setting that
      // lets a helper send and spend with nobody watching, and it belongs behind the
      // household PIN in Helpers.
      autonomy: input?.autonomy === "act" ? "act" : "ask",
    }, session);
    const v = publicHelper(h, session);
    return { ok: true, result: { created: true, helperId: v.id, name: v.name, schedule: v.scheduleText, autonomy: v.autonomyText, visibility: v.visibility, note: visibility === "personal" && session.role === "Adult Member" ? "Created as a personal helper — an Owner or Adult Admin can share it with the whole family." : undefined } };
  },
});

export const familiUpdateHelper = defineAction({
  id: "famili.update_helper",
  name: "Change a helper",
  description: "Change an existing helper: its instructions, name, schedule, autonomy, or pause/resume it. Use famili__list_helpers first to get its id. To fix a helper that is doing the wrong thing, rewrite the WHOLE instructions paragraph rather than appending a correction to it.",
  action: "Write", risk: "Medium", timeoutMs: 60_000, ...NATIVE,
  input: { type: "object", properties: {
    helperId: { type: "string", description: "The helper's id (starts with agt_)." },
    name: { type: "string" },
    purpose: { type: "string" },
    instructions: { type: "string", description: "The complete replacement instructions." },
    schedule: scheduleSchema,
    autonomy: { type: "string", enum: ["ask", "act"] },
    enabled: { type: "boolean", description: "false pauses it." },
  }, required: ["helperId"], additionalProperties: false },
  output: {
    type: "object",
    properties: {
      updated: { type: "boolean" }, helperId: { type: "string" }, name: { type: "string" },
      schedule: { type: "string" }, autonomy: { type: "string" }, enabled: { type: "boolean" },
    },
    required: ["updated", "helperId", "name", "schedule", "autonomy", "enabled"], additionalProperties: false,
  },
  errorCodes: ["invalid_input", "helper_not_found", "household_helper"],
  async run(ctx, input) {
    const { session } = nativeScope(ctx);
    const { listHelpers, updateHelper, publicHelper } = await helpersModule();
    const h = listHelpers(session).find((x) => x.id === String(input?.helperId ?? ""));
    if (!h) return { ok: false, error: "helper_not_found", message: "No such helper. List them first." };
    if (session.role === "Adult Member" && h.visibility === "household") {
      return { ok: false, error: "household_helper", message: "That helper belongs to the whole family, so an Owner or Adult Admin looks after it. Say so." };
    }
    const patch = { ...input };
    delete patch.helperId;
    if (patch.autonomy === "full") patch.autonomy = "act";
    const next = updateHelper(h.id, patch, session);
    const v = publicHelper(next, session);
    return { ok: true, result: { updated: true, helperId: v.id, name: v.name, schedule: v.scheduleText, autonomy: v.autonomyText, enabled: v.enabled } };
  },
});

/* A nested assistant turn (runHelper → runAssistantAgent, 240 s turn limit) — so the
 * per-action limit is wider than the turn it waits on, never the step's 60 s. */
export const familiRunHelper = defineAction({
  id: "famili.run_helper",
  name: "Run a helper now",
  description: "Run one of the family's helpers immediately, instead of waiting for its schedule. Returns what it did. Use it when someone asks for a helper's output right now (\"give me the morning briefing\").",
  action: "Write", risk: "Medium", timeoutMs: 300_000, ...NATIVE,
  input: { type: "object", properties: { helperId: { type: "string", description: "The helper's id (starts with agt_)." } }, required: ["helperId"], additionalProperties: false },
  output: {
    type: "object",
    properties: { ran: { type: "string" }, said: { type: "string" }, did: { type: "number" } },
    required: ["ran", "did"], additionalProperties: false,
  },
  // helper_not_found is this tool's; the rest are runHelper's and its nested turn's, passed through.
  errorCodes: ["invalid_input", "helper_not_found", "unknown_helper", "helper_paused", "no_instructions", "helper_failed", "empty_message", "authentication_required", "no_provider", "ai_budget_exhausted", "provider_error"],
  async run(ctx, input) {
    const { session } = nativeScope(ctx);
    const { listHelpers, runHelper } = await helpersModule();
    const h = listHelpers(session).find((x) => x.id === String(input?.helperId ?? ""));
    if (!h) return { ok: false, error: "helper_not_found", message: "No such helper. List them first." };
    const out = await runHelper({ helperId: h.id, session, reason: "manual" });
    if (!out.ok) return { ok: false, error: out.error, message: out.message };
    return { ok: true, result: { ran: h.name, said: out.answer, did: (out.toolCalls ?? []).filter((c) => c.status === "done").length } };
  },
});
