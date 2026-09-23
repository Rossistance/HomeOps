/* THE NATIVE LANE (ADR-004 Stage 1).
 *
 * The sixteen famili.* tools the chat loop offers itself used to be an inline list in
 * assistant-agent.mjs that ran `await d.run(input)` and wrote one thin audit row — the only
 * tool-execution path outside the policy ladder. They are declared actions now, offered by
 * each one's available() and run through engine.mjs runNativeAction: the same gate a catalog
 * tool meets, a per-action timeout, the engine's audit row.
 *
 * What this file pins, in order: the declarations themselves; the menu (the one behaviour
 * change — the helper tools leave the group thread); the native wire (required-ness and
 * enum membership stay the bodies' own, so no refusal changes its words); the runner's
 * refusals, including the one the ladder can still produce for a requiresApproval:false tool
 * ("always ask me"), which is refused in words rather than executed or dropped; and then,
 * through the real chat route and a scripted model, a deny-list, the audit shape, the kill
 * switch on a Google-linked event, and a helper's instructions arriving as written.
 */
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-native-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

// Boot order, as the server loads: context → internal-functions → the registry.
await import("../context.mjs");
const { INTERNAL_FUNCTIONS } = await import("../internal-functions.mjs");
const { NATIVE_ACTIONS, ACTIONS, getAction } = await import("../actions/registry.mjs");
const { defineAction } = await import("../actions/define-action.mjs");
const { runNativeAction, gateToolCall } = await import("../engine.mjs");
const { readAudit } = await import("../store.mjs");
const { startServer, stopServer, makeSession, readStoreDoc, writeStoreDoc, readStoreRecord, writeStoreRecord } = await import("./harness.mjs");
const { useFakeModel } = await import("./fake-model.mjs");

const MENU_ORDER = [
  "famili.list_events", "famili.list_tasks", "famili.list_meals", "famili.list_members", "famili.search_memory", "famili.list_approvals",
  "famili.update_event", "famili.delete_event", "famili.update_task", "famili.delete_task", "famili.delete_meal", "famili.delete_memory",
  "famili.list_helpers", "famili.create_helper", "famili.update_helper", "famili.run_helper",
];
const HELPER_TOOLS = ["famili.list_helpers", "famili.create_helper", "famili.update_helper", "famili.run_helper"];
const RISK = {
  "famili.update_event": "Low", "famili.update_task": "Low", "famili.list_helpers": "Low",
  "famili.delete_event": "Medium", "famili.delete_task": "Medium", "famili.delete_meal": "Medium", "famili.delete_memory": "Medium",
  "famili.create_helper": "Medium", "famili.update_helper": "Medium", "famili.run_helper": "Medium",
};
// Stage 1 said approvals for these "arrive in a later update"; owner decision A means they
// never do, so the refusal no longer promises one.
const ASK_FIRST = "This helper is set to ask before doing this, and a change like this is never held for approval — nothing was done.";
const menu = ({ role, channel = "personal", asHelper = false }) =>
  NATIVE_ACTIONS.filter((a) => a.available({ session: { role, householdId: "local", actorId: "m-x" }, channel, asHelper })).map((a) => a.id);

/* ───────────────────────────── the declarations ───────────────────────────── */

test("THE SIXTEEN ARE DECLARED: frozen, on the native lane, never a registry entry, in the order the model has always seen", () => {
  assert.deepEqual(NATIVE_ACTIONS.map((a) => a.id), MENU_ORDER);
  for (const a of NATIVE_ACTIONS) {
    assert.ok(Object.isFrozen(a) && Object.isFrozen(a.input), `${a.id} is frozen`);
    assert.equal(a.lane, "native");
    assert.equal(a.agent, true);
    assert.equal(a.http, undefined, `${a.id} has no HTTP door`);
    assert.equal(a.requiresApproval, false, `${a.id} needs no approval in Stage 1`);
    assert.equal(a.delivers, false);
    assert.equal(a.risk, RISK[a.id] ?? (a.action === "Read" ? "Low" : "?"), `${a.id} risk`);
    assert.equal(typeof a.available, "function");
    assert.ok(a.output, `${a.id} declares its result`);
    assert.ok(a.errorCodes.includes("invalid_input"));
    assert.throws(() => a.toInternalFunction(), /native-lane tool/);
    assert.throws(() => a.toInternalInputs(), /native-lane tool/);
    assert.equal(INTERNAL_FUNCTIONS[a.id], undefined, `${a.id} is not a catalog tool`);
    assert.equal(getAction(a.id), a, "getAction reaches it");
    assert.ok(ACTIONS.includes(a), "and so does the type generator");
  }
});

test("run_helper waits on a whole nested turn, so its limit is 300 s; every other native tool keeps the step's 60 s", () => {
  for (const a of NATIVE_ACTIONS) assert.equal(a.timeoutMs, a.id === "famili.run_helper" ? 300_000 : 60_000, a.id);
});

test("defineAction refuses a malformed native declaration at load", () => {
  const base = { id: "test.native_thing", name: "T", description: "t", action: "Read", risk: "Low", errorCodes: ["invalid_input"], input: { type: "object", properties: {} }, run: async () => ({ ok: true, result: {} }) };
  assert.throws(() => defineAction({ ...base, lane: "catalog" }), /lane must be "native"/);
  assert.throws(() => defineAction({ ...base, lane: "native", http: { method: "GET", path: "/api/native-thing" } }), /no http door/);
  assert.throws(() => defineAction({ ...base, lane: "native", agent: false, http: { method: "GET", path: "/api/native-thing" } }), /agent:true/);
  assert.throws(() => defineAction({ ...base, timeoutMs: 0 }), /timeoutMs/);
  assert.throws(() => defineAction({ ...base, timeoutMs: 1.5 }), /timeoutMs/);
  assert.throws(() => defineAction({ ...base, available: true }), /available must be a function/);
  const plain = defineAction(base);
  assert.equal(plain.lane, null, "absent lane is the ordinary registry path");
  assert.equal(plain.timeoutMs, 60_000);
  assert.equal(plain.available({}), true);
});

/* ───────────────────────────── the menu ───────────────────────────── */

test("THE MENU: an adult gets all sixteen; the GROUP THREAD and a helper run never get the helper tools", () => {
  for (const role of ["Owner", "Adult Admin", "Adult Member"]) assert.deepEqual(menu({ role }), MENU_ORDER, `${role}, personal`);
  const noHelpers = MENU_ORDER.filter((id) => !HELPER_TOOLS.includes(id));
  // The one behaviour change of Stage 1: the prompt always said helpers are not made from a
  // group text; the menu now agrees.
  for (const role of ["Owner", "Adult Admin", "Adult Member"]) assert.deepEqual(menu({ role, channel: "group" }), noHelpers, `${role}, group`);
  assert.deepEqual(menu({ role: "Owner", asHelper: true }), noHelpers, "a helper cannot make or run helpers");
  // A read-only profile keeps the writes on its menu — they refuse inside run, in words.
  for (const role of ["Limited Member", "Child View", "Guest/Helper"]) assert.deepEqual(menu({ role }), noHelpers, role);
});

/* ───────────────────────────── the native wire ───────────────────────────── */

test("THE NATIVE WIRE: types are coerced and undeclared keys stripped, but required-ness and enum membership stay the body's", async () => {
  let got = null;
  const spy = defineAction({
    id: "test.native_wire", name: "Wire", description: "w", action: "Write", risk: "Low", lane: "native", errorCodes: ["invalid_input"],
    input: { type: "object", properties: { id: { type: "string" }, level: { type: "string", enum: ["ask", "act"] }, n: { type: "number" }, ok: { type: "boolean" }, ids: { type: "array", items: { type: "string" } } }, required: ["id"], additionalProperties: false },
    run: async (_ctx, input) => { got = input; return { ok: true, result: {} }; },
  });
  const warned = [];
  const warn = console.warn;
  console.warn = (m) => warned.push(String(m));
  try {
    // Missing `id` and an out-of-range `level` reach run: the famili.* bodies refuse (or map)
    // those with their own codes — create_helper turns autonomy "full" into "ask".
    assert.equal((await spy.invoke({}, { level: "full", n: "3", ok: "false", ids: "a, b", extra: 1 })).ok, true);
    assert.deepEqual(got, { level: "full", n: 3, ok: false, ids: ["a", "b"] }, "coerced, split, and `extra` stripped");
    assert.ok(warned.some((w) => /ignoring undeclared input field "extra"/.test(w)), "the strip is named once in the log");
    // A value of the wrong TYPE is still refused — that is the validator's job on every lane.
    const bad = await spy.invoke({}, { id: 7 });
    assert.equal(bad.error, "invalid_input");
    assert.equal(bad.field, "id");
  } finally { console.warn = warn; }
  // The model and the generated types still see the declared schema, enum and required intact.
  assert.deepEqual(spy.input.required, ["id"]);
  assert.deepEqual(spy.input.properties.level.enum, ["ask", "act"]);
});

test("ON THE NATIVE WIRE NULL MEANS ABSENT, at every depth — a schedule's weekday:null is the default again, not invalid_input", async () => {
  /* The chat loop's coerceInput has always dropped a top-level null. A NESTED one reached
   * the bodies untouched and normalizeSchedule defaulted it; the declared number type then
   * refused it outright. The native lane now drops a null wherever it sits, before run. */
  let got = null;
  const spy = defineAction({
    id: "test.native_nulls", name: "Nulls", description: "n", action: "Write", risk: "Low", lane: "native", errorCodes: ["invalid_input"],
    input: { type: "object", properties: { id: { type: "string" }, schedule: { type: "object", properties: { kind: { type: "string", enum: ["manual", "weekly"] }, time: { type: "string" }, weekday: { type: "number" } }, required: ["kind"], additionalProperties: false } }, additionalProperties: false },
    run: async (_ctx, input) => { got = input; return { ok: true, result: {} }; },
  });
  assert.equal((await spy.invoke({}, { id: "a", schedule: { kind: "weekly", time: "07:00", weekday: null } })).ok, true);
  assert.deepEqual(got, { id: "a", schedule: { kind: "weekly", time: "07:00" } });
  assert.equal((await spy.invoke({}, { id: null, schedule: { kind: "manual", time: null, weekday: null } })).ok, true);
  assert.deepEqual(got, { schedule: { kind: "manual" } });
  assert.equal((await spy.invoke({}, { schedule: { weekday: "Monday" } })).field, "schedule.weekday", "a wrong type is still refused");
  // The declared schema — what the model and the generated types see — is untouched.
  assert.deepEqual(spy.input.properties.schedule.properties.weekday, { type: "number" });
});

test("a native input may not use $ref — the native wire does not follow one, so the fence refuses it at load", () => {
  assert.throws(() => defineAction({
    id: "test.native_ref", name: "R", description: "r", action: "Read", risk: "Low", lane: "native", errorCodes: ["invalid_input"],
    $defs: { Row: { type: "object", properties: { x: { type: "string" } } } },
    input: { type: "object", properties: { row: { $ref: "#/$defs/Row" } } },
    run: async () => ({ ok: true, result: {} }),
  }), /native-lane input may not use \$ref/);
  for (const a of NATIVE_ACTIONS) assert.equal(JSON.stringify(a.input).includes("$ref"), false, `${a.id} has no $ref`);
});

/* ───────────────────────────── the runner ───────────────────────────── */

const session = { householdId: "local", actorId: "m-alex", role: "Owner" };
const agentWith = (extra = {}) => ({ id: "agt_native_test", householdId: "local", allowedToolIds: [], deniedToolIds: [], approvalPolicy: {}, ...extra });
function spyAction(id, { action = "Write", timeoutMs, run } = {}) {
  const calls = [];
  const a = defineAction({
    id, name: `Spy ${id}`, description: "spy", action, risk: "Low", lane: "native", errorCodes: ["invalid_input", "boom"],
    ...(timeoutMs ? { timeoutMs } : {}),
    input: { type: "object", properties: { x: { type: "string" } }, additionalProperties: false },
    run: async (ctx, input) => { calls.push({ ctx, input }); return run ? run(ctx, input) : { ok: true, result: { did: true } }; },
  });
  return { a, calls };
}
const lastAudit = (pred) => readAudit(500).find(pred);

test("THE RUNNER: the native ctx carries the session and the channel, and the audit row is the engine's", async () => {
  const { a, calls } = spyAction("test.native_ctx");
  const out = await runNativeAction({ action: a, input: { x: "1" }, session, agent: agentWith(), channel: "group", conversationId: "conv_1", asHelper: true, actorIsAdult: true });
  assert.deepEqual(out, { ok: true, result: { did: true } });
  const { ctx } = calls[0];
  assert.deepEqual({ ...ctx, session: undefined }, { householdId: "local", actorId: "m-alex", role: "Owner", channel: "group", session: undefined, via: "agent", runId: null, agentId: "agt_native_test", asHelper: true });
  assert.equal(ctx.session, session, "the bodies read the session whole (listHelpers, publicHelper, runHelper)");
  const row = lastAudit((r) => r.type === "assistant.tool" && r.toolId === "test.native_ctx");
  assert.ok(row, "an assistant.tool row");
  assert.equal(row.connectorId, "homeops");
  assert.equal(typeof row.durationMs, "number");
  assert.equal(row.agentId, "agt_native_test");
  assert.equal(row.conversationId, "conv_1");
  assert.equal(row.ok, true);
});

test("a DENY-LIST and a non-empty ALLOW-LIST reach a native tool — refused, audited, never run", async () => {
  const { a, calls } = spyAction("test.native_denied");
  const denied = await runNativeAction({ action: a, input: {}, session, agent: agentWith({ deniedToolIds: ["test.native_denied"] }) });
  assert.equal(denied.ok, false);
  assert.equal(denied.policyBlocked, true);
  assert.equal(denied.error, "not_permitted_denied", "the same error the catalog path gives");
  assert.match(denied.message, /blocked list/);
  assert.ok(lastAudit((r) => r.type === "assistant.tool_blocked" && r.toolId === "test.native_denied" && r.reason === "denied" && r.agentId === "agt_native_test"));
  /* ADR-004's accepted risk, pinned so it is deliberate: a helper whose family gave it a
   * non-empty allow-list is refused a native tool that is not on it — which is what the
   * list means. No seeded helper has one. */
  const narrow = await runNativeAction({ action: a, input: {}, session, agent: agentWith({ allowedToolIds: ["homeops.create_task"] }) });
  assert.equal(narrow.error, "not_permitted_not_permitted");
  assert.equal(calls.length, 0, "neither ran");
});

test("\"ALWAYS ASK ME\" ON A NATIVE TOOL IS REFUSED IN WORDS — decision A means it is never parked, and it must not run or drop it", async () => {
  /* Every native tool is requiresApproval:false, but the ladder can still answer
   * NEEDS_APPROVAL for one: rule 4 (the helper's alwaysApprove) and rule 6 (an autoAllow on a
   * write, which it refuses to relax). Stage 1 refused it because the run engine could not
   * yet resolve a famili.* id; since Stage 2 it can, and it is still refused, because owner
   * decision A says no native write waits for approval except a child's in the group thread. */
  const { a, calls } = spyAction("test.native_ask");
  const out = await runNativeAction({ action: a, input: {}, session, agent: agentWith({ approvalPolicy: { alwaysApprove: ["test.native_ask"] } }) });
  assert.equal(out.ok, false);
  assert.equal(out.policyBlocked, true);
  assert.equal(out.error, "policy_agent.always_approve");
  assert.equal(out.message, ASK_FIRST, "one sentence the model can repeat");
  // The row keeps the ladder's own reason, the same shape every assistant.tool_blocked row has.
  assert.equal(lastAudit((r) => r.type === "assistant.tool_blocked" && r.toolId === "test.native_ask" && r.rule === "agent.always_approve")?.reason, "This helper is set to always ask you first.");
  const auto = await runNativeAction({ action: a, input: {}, session, agent: agentWith({ approvalPolicy: { autoAllow: ["test.native_ask"] } }) });
  assert.equal(auto.error, "policy_agent.auto_allow_refused");
  /* Rule 6's own reason says "…doesn't apply — it still needs you", which the family was
   * never going to be asked; embedding it contradicted the refusal. The row keeps it. */
  assert.equal(auto.message, ASK_FIRST);
  assert.match(lastAudit((r) => r.type === "assistant.tool_blocked" && r.toolId === "test.native_ask" && r.rule === "agent.auto_allow_refused")?.reason ?? "", /still needs you/);
  assert.equal(calls.length, 0, "nothing ran");
  // A read on autoAllow is not high-stakes and was never gated: it runs.
  const { a: read, calls: readCalls } = spyAction("test.native_ask_read", { action: "Read" });
  assert.equal((await runNativeAction({ action: read, input: {}, session, agent: agentWith({ approvalPolicy: { autoAllow: ["test.native_ask_read"] } }) })).ok, true);
  assert.equal(readCalls.length, 1);
});

test("STAGE 2 (owner decision C): a Limited Member's native WRITE in the GROUP thread is no longer run — rule 4b holds it for an adult", async () => {
  /* Stage 1 pinned the opposite on purpose: no native tool asked for approval, so rule 4b had
   * nothing to park and the real famili.delete_task ran at once. Decision C gates exactly this
   * call — a native write, the group thread, an asker who is not an adult — so the ladder now
   * answers NEEDS_APPROVAL under rule 4b, and the runner reports it for the chat lane to queue
   * (queueApprovalRun), exactly as a gated catalog call. Nothing ran and nothing was refused.
   * The queued run, its approval and an adult's decision are pinned end to end, through the
   * real group lane, in group-native-approval.test.mjs. */
  const { putTask, getTask } = await import("../store.mjs");
  putTask({ id: "tk_native_kid", householdId: "local", title: "Feed the fish", status: "todo", createdBy: "m-kid", visibility: "household" });
  const kid = { householdId: "local", actorId: "m-kid", role: "Limited Member" };
  const del = NATIVE_ACTIONS.find((a) => a.id === "famili.delete_task");
  const out = await runNativeAction({ action: del, input: { taskId: "tk_native_kid" }, session: kid, agent: agentWith(), channel: "group", actorIsAdult: false });
  assert.deepEqual(out, { ok: false, needsApproval: true, rule: "actor.not_adult" });
  assert.ok(getTask("tk_native_kid"), "still there — it waits for an adult");
  assert.equal(lastAudit((r) => r.type === "assistant.tool_blocked" && r.toolId === "famili.delete_task"), undefined, "a park is not a refusal");
  // The same child, the same call, anywhere but the group thread: immediate (decision A).
  const app = await runNativeAction({ action: del, input: { taskId: "tk_native_kid" }, session: kid, agent: agentWith(), channel: "personal", actorIsAdult: null });
  assert.deepEqual(app, { ok: true, result: { deleted: true, title: "Feed the fish" } });
});

test("A READ-ONLY PROFILE in the group is not parked: Child View and Guest/Helper get the body's read_only_profile, as in Stage 1", async () => {
  /* Review finding L1. The park fired before the body's write check, so these profiles were
   * queued and then refused by queueApprovalRun ("This profile can't start actions that need
   * approval.") — a request nobody could ever approve. Only someone who can write at all (a
   * Limited Member, the bodies' own test) is held for an adult. */
  const { putTask, getTask } = await import("../store.mjs");
  const { nativeRequiresApproval } = await import("../engine.mjs");
  const del = getAction("famili.delete_task");
  putTask({ id: "tk_native_readonly", householdId: "local", title: "Feed the cat", status: "todo", createdBy: "m-kid", visibility: "household" });
  for (const role of ["Child View", "Guest/Helper"]) {
    const who = { householdId: "local", actorId: "m-readonly", role };
    const out = await runNativeAction({ action: del, input: { taskId: "tk_native_readonly" }, session: who, agent: agentWith(), channel: "group", actorIsAdult: false });
    assert.deepEqual(out, { ok: false, error: "read_only_profile", message: "This profile can look things up but not change them. Ask a parent or an adult member to do it." }, role);
    assert.equal(nativeRequiresApproval(del, { channel: "group", actorIsAdult: false, role }), false, `${role}: never gated`);
  }
  assert.equal(nativeRequiresApproval(del, { channel: "group", actorIsAdult: false, role: "Limited Member" }), true, "a Limited Member still is");
  assert.ok(getTask("tk_native_readonly"), "nothing was deleted");
});

test("ONLY rule 4b queues a native call: \"always ask me\" on a child's group write is still a refusal (decision A), and a read never asks", async () => {
  /* Rule 4 fires before rule 4b, so a helper's alwaysApprove on the tool refuses even the one
   * call that would otherwise park — refused in words, never queued. */
  const { a, calls } = spyAction("test.native_child_always_ask");
  const kid = { householdId: "local", actorId: "m-kid", role: "Limited Member" };
  const refused = await runNativeAction({ action: a, input: {}, session: kid, agent: agentWith({ approvalPolicy: { alwaysApprove: ["test.native_child_always_ask"] } }), channel: "group", actorIsAdult: false });
  assert.equal(refused.needsApproval, undefined, "not queued");
  assert.equal(refused.error, "policy_agent.always_approve");
  assert.equal(refused.message, ASK_FIRST);
  assert.equal(calls.length, 0);
  const { a: read, calls: readCalls } = spyAction("test.native_child_read", { action: "Read" });
  assert.equal((await runNativeAction({ action: read, input: {}, session: kid, agent: agentWith(), channel: "group", actorIsAdult: false })).ok, true, "a child's read in the group runs");
  assert.equal(readCalls.length, 1);
});

test("with no acting agent the ladder is skipped exactly as executeToolForChat skips it; only a non-adult's group write is gated", async () => {
  const { a, calls } = spyAction("test.native_unattributed");
  assert.equal((await runNativeAction({ action: a, input: {}, session })).ok, true);
  assert.equal(calls[0].ctx.agentId, null);
  // The gate's no-agent branch reads the pre-ladder gate only…
  const g = gateToolCall({ cap: { id: "x.y", requiresApproval: true }, toolId: "x.y", agent: null, householdId: "local", requiresApproval: false });
  assert.deepEqual(g, { blocked: false, needsApproval: false, decision: null, error: null, message: null });
  // …and when that is not a boolean, the capability's own gate — never "no gate" by accident.
  for (const requiresApproval of [undefined, null]) {
    assert.equal(gateToolCall({ cap: { id: "x.y", requiresApproval: true }, toolId: "x.y", agent: null, householdId: "local", requiresApproval }).needsApproval, true, String(requiresApproval));
  }
  /* Stage 1 asserted here that a write asked as a non-adult in the group thread ran, because no
   * native tool was gated. Decision C gates exactly that call, so it is held — by rule 4b with
   * an acting agent, by the capability's own gate without one — and never runs in the turn. */
  assert.deepEqual(await runNativeAction({ action: a, input: {}, session, agent: agentWith(), channel: "group", actorIsAdult: false }), { ok: false, needsApproval: true, rule: "actor.not_adult" });
  assert.deepEqual(await runNativeAction({ action: a, input: {}, session, channel: "group", actorIsAdult: false }), { ok: false, needsApproval: true, rule: "capability.requires_approval" });
  assert.equal(calls.length, 1, "only the unattributed personal call above ran");
  // …an adult in the group thread, or anyone outside it, is never held (decision A).
  assert.equal((await runNativeAction({ action: a, input: {}, session, agent: agentWith(), channel: "group", actorIsAdult: true })).ok, true);
  assert.equal((await runNativeAction({ action: a, input: {}, session, agent: agentWith(), channel: "personal", actorIsAdult: false })).ok, true);
});

test("the runner's timer is cleared when the tool answers — a finished call leaves nothing ticking", async () => {
  /* withTimeout raced the call against a setTimeout it never cleared, so every native call
   * left a live timer behind for its whole limit: 60 s, and five minutes after run_helper. */
  const { a } = spyAction("test.native_timer", { timeoutMs: 300_000 });
  const timers = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout").length;
  const before = timers();
  for (let i = 0; i < 3; i++) assert.equal((await runNativeAction({ action: a, input: {}, session })).ok, true);
  assert.equal(timers(), before);
});

test("a body that hangs is cut at its own timeoutMs; a body that throws is tool_failed, as it always was", async () => {
  const { a: slow } = spyAction("test.native_slow", { timeoutMs: 30, run: () => new Promise((r) => setTimeout(() => r({ ok: true, result: {} }), 300)) });
  const t = await runNativeAction({ action: slow, input: {}, session });
  assert.equal(t.error, "timeout");
  assert.equal(lastAudit((r) => r.type === "assistant.tool" && r.toolId === "test.native_slow")?.error, "timeout");
  const { a: bad } = spyAction("test.native_throws", { run: () => { throw new Error("kaput"); } });
  const f = await runNativeAction({ action: bad, input: {}, session });
  assert.equal(f.error, "tool_failed");
  assert.match(f.message, /kaput/);
});

/* ───────────────── the group channel's visibility (Stage 2) ───────────────── */

test("IN THE GROUP THREAD the four deletes answer a private item exactly as a missing one — and outside it nothing changes", async () => {
  /* famili.delete_event / delete_task / delete_meal had no channel check and delete_memory
   * ignored the channel, so given an id, an adult in the group thread could delete someone's
   * private item and echo its title or text into a thread people outside the household read.
   * An Owner asks here (no park: decision C is about non-adults), about the Owner's OWN private
   * items — the strongest case: the channel, not the person, is what hides them. */
  const store = await import("../store.mjs");
  const owner = { householdId: "local", actorId: "m-alex", role: "Owner" };
  const call = (id, input, channel) => runNativeAction({ action: getAction(id), input, session: owner, agent: agentWith(), channel, actorIsAdult: channel === "group" ? true : null });
  const mine = { householdId: "local", createdBy: "m-alex", ownerId: "m-alex", visibility: "private" };
  store.putEvent({ id: "ev_vis_1", title: "Therapy appointment", startAt: "2030-10-01T15:00:00.000Z", layer: "canonical", ...mine });
  store.putTask({ id: "tk_vis_1", title: "Refill the prescription", status: "todo", ...mine });
  store.putMeal({ id: "meal_vis_1", title: "Anniversary dinner", date: "2030-10-02", slot: "dinner", archived: false, ...mine });
  const mem = store.addMemory({ householdId: "local", scope: "personal", type: "fact", text: "Alex's surprise party is on the 12th", sourceActorId: "m-alex" });
  const cases = [
    ["famili.delete_event", { eventId: "ev_vis_1" }, { eventId: "ev_nope" }],
    ["famili.delete_task", { taskId: "tk_vis_1" }, { taskId: "tk_nope" }],
    ["famili.delete_meal", { mealId: "meal_vis_1" }, { mealId: "meal_nope" }],
    ["famili.delete_memory", { memoryId: mem.id }, { memoryId: "mem_nope" }],
  ];
  for (const [id, real, missing] of cases) {
    const hidden = await call(id, real, "group");
    assert.equal(hidden.ok, false, `${id} refused in the group`);
    assert.deepEqual(hidden, await call(id, missing, "group"), `${id}: the same code and the same words as a missing id`);
    assert.equal(JSON.stringify(hidden).match(/Therapy|prescription|Anniversary|surprise/), null, "nothing about the item");
  }
  assert.ok(store.getEvent("ev_vis_1") && store.getTask("tk_vis_1") && store.getMeal("meal_vis_1") && store.getMemoryEntry(mem.id), "all four survive");
  // The controls: the same Owner, the same ids, anywhere but the group thread — as before.
  for (const [id, real] of cases) assert.equal((await call(id, real, "personal")).ok, true, `${id} still deletes outside the group`);
  assert.ok(!store.getEvent("ev_vis_1") && !store.getTask("tk_vis_1") && !store.getMemoryEntry(mem.id));
});

test("…and the two update tools answer the same way in the group — where \"isn't visible\" used to say the item exists — keeping forbidden outside it", async () => {
  /* Review finding L2. update_event / update_task refused a private item in the group with
   * forbidden, "That event isn't visible to this person." — which tells the thread there is one.
   * In the group they now answer exactly as for a missing id; outside it, forbidden as before. */
  const store = await import("../store.mjs");
  const owner = { householdId: "local", actorId: "m-alex", role: "Owner" };
  const update = (id, input, channel) => runNativeAction({ action: getAction(id), input, session: owner, agent: agentWith(), channel, actorIsAdult: channel === "group" ? true : null });
  store.putEvent({ id: "ev_vis_2", householdId: "local", title: "Private lunch", startAt: "2030-10-03T16:00:00.000Z", layer: "canonical", createdBy: "m-alex", ownerId: "m-alex", visibility: "private" });
  store.putTask({ id: "tk_vis_2", householdId: "local", title: "Private errand", status: "todo", createdBy: "m-alex", ownerId: "m-alex", visibility: "private" });
  const ev = await update("famili.update_event", { eventId: "ev_vis_2", notes: "x" }, "group");
  assert.deepEqual(ev, await update("famili.update_event", { eventId: "ev_nope", notes: "x" }, "group"), "update_event: byte for byte a missing id");
  assert.equal(ev.error, "event_not_found");
  const tk = await update("famili.update_task", { taskId: "tk_vis_2", status: "done" }, "group");
  assert.deepEqual(tk, await update("famili.update_task", { taskId: "tk_nope", status: "done" }, "group"), "update_task: byte for byte a missing id");
  assert.equal(tk.error, "task_not_found");
  assert.equal(store.getTask("tk_vis_2").status, "todo");
  // The control: outside the group an item this person may not see is still `forbidden`.
  store.putEvent({ id: "ev_vis_3", householdId: "local", title: "Morgan's private lunch", startAt: "2030-10-04T16:00:00.000Z", layer: "canonical", createdBy: "m-morgan", ownerId: "m-morgan", visibility: "private" });
  store.putTask({ id: "tk_vis_3", householdId: "local", title: "Morgan's private errand", status: "todo", createdBy: "m-morgan", ownerId: "m-morgan", visibility: "private" });
  assert.deepEqual(await update("famili.update_event", { eventId: "ev_vis_3", notes: "x" }, "personal"), { ok: false, error: "forbidden", message: "That event isn't visible to this person." });
  assert.deepEqual(await update("famili.update_task", { taskId: "tk_vis_3", status: "done" }, "personal"), { ok: false, error: "forbidden", message: "That task isn't visible to this person." });
});

describe("IN THE GROUP THREAD a NEST's memory is not there — found, forgotten or named — and outside it nothing changes", () => {
  /* Review finding M1. The group rules hid PERSONAL memory only; a nest's memory (a third room,
   * visible to its members and nobody else, not even the Owner) was found by search_memory,
   * deleted and echoed by delete_memory, and named on the approval a nest child's group request
   * parked — an approval pushed to every adult and readable in the thread. Tasks and events of a
   * nest were already hidden there (canSeeEntityInChannel admits household/childVisible only). */
  let store, memoryProvider, approvalPreview, secret, shared;
  const adult = { householdId: "local", actorId: "m-nest-adult", role: "Adult Member", actorName: "Gran Harper" };
  const kid = { householdId: "local", actorId: "m-nest-kid", role: "Limited Member", actorName: "Maya Harper" };
  const outsider = { householdId: "local", actorId: "m-nest-outsider", role: "Owner", actorName: "Alex Harper" };
  const call = (id, input, who, channel) => runNativeAction({ action: getAction(id), input, session: who, agent: agentWith(), channel, actorIsAdult: channel === "group" ? true : null });
  const remember = async (text, scope, extra = {}) => {
    const rec = store.addMemory({ householdId: "local", scope, type: "fact", text, source: { actorId: "m-nest-adult" }, ...extra });
    await memoryProvider.add(text, { containerTag: "local", scope, type: "fact", sourceActorId: "m-nest-adult", id: `sm_mem_${rec.id}` });
    return rec;
  };
  before(async () => {
    store = await import("../store.mjs");
    ({ memoryProvider } = await import("../memory-provider.mjs"));
    ({ approvalPreview } = await import("../actions/native/shared.mjs"));
    for (const m of [adult, kid, outsider]) store.putMember({ actorId: m.actorId, displayName: m.actorName, role: m.role, householdId: "local" });
    store.putNest({ id: "nest_vis_1", householdId: "local", name: "Gran + Maya", archived: false, createdBy: "m-nest-adult",
      members: [{ actorId: "m-nest-adult", status: "joined" }, { actorId: "m-nest-kid", status: "joined" }] });
    secret = await remember("NESTSECRET grandma surprise trip to Paris", "nest", { nestId: "nest_vis_1" });
    shared = await remember("NESTSECRET is also the name of the household's wifi", "household");
  });

  test("(a) famili.delete_memory: a nest member's delete in the group answers exactly as a missing id; outside it, it deletes", async () => {
    const hidden = await call("famili.delete_memory", { memoryId: secret.id }, adult, "group");
    assert.deepEqual(hidden, await call("famili.delete_memory", { memoryId: "mem_nope" }, adult, "group"), "the same code and the same words as a missing id");
    assert.equal(JSON.stringify(hidden).includes("Paris"), false, "nothing of the text");
    assert.ok(store.getMemoryEntry(secret.id), "still there");
    // The non-group control — kept for the other tests in this block, so on a copy.
    const copy = store.addMemory({ householdId: "local", scope: "nest", nestId: "nest_vis_1", type: "fact", text: "NESTSECRET copy for the control", source: { actorId: "m-nest-adult" } });
    const gone = await call("famili.delete_memory", { memoryId: copy.id }, adult, "personal");
    assert.deepEqual(gone, { ok: true, result: { deleted: true, text: "NESTSECRET copy for the control" } });
  });

  test("(b) the approval preview names a nest memory's text only outside the group, and only to someone who may forget it", () => {
    const forget = getAction("famili.delete_memory");
    assert.equal(approvalPreview(forget, { memoryId: secret.id }, { session: kid, channel: "group" }),
      "Forget a memory\nAsked by Maya Harper in the family group thread", "a nest child's group request: the action alone");
    assert.equal(approvalPreview(forget, { memoryId: secret.id }, { session: kid, channel: "personal" }).split("\n")[0],
      "Forget a memory: “NESTSECRET grandma surprise trip to Paris”", "the control: a nest member outside the group");
    assert.equal(approvalPreview(forget, { memoryId: secret.id }, { session: outsider, channel: "personal" }).split("\n")[0],
      "Forget a memory", "never to someone outside the nest — the Owner included");
    assert.equal(approvalPreview(forget, { memoryId: shared.id }, { session: kid, channel: "group" }).split("\n")[0],
      "Forget a memory: “NESTSECRET is also the name of the household's wifi”", "a household memory is still named in the group");
  });

  test("(c) famili.search_memory: a nest member's group search does not find the nest's memory; outside the group it does", async () => {
    const texts = async (channel) => ((await call("famili.search_memory", { query: "NESTSECRET" }, adult, channel)).result?.memories ?? []).map((m) => m.text);
    const group = await texts("group");
    assert.ok(group.includes("NESTSECRET is also the name of the household's wifi"), `the search really ran: ${JSON.stringify(group)}`);
    assert.equal(group.some((t) => /Paris/.test(t)), false, "the nest's memory is not in the group");
    assert.ok((await texts("personal")).includes("NESTSECRET grandma surprise trip to Paris"), "the control: found by its nest member elsewhere");
  });

  test("(d) famili.list_approvals in the group shows only the asker's own requests and the thread's own parks; outside it, all of them", async () => {
    /* An approval queued outside the thread — here one whose preview names the nest's memory —
     * is the Inbox's business, not a thread people outside the household read. */
    const { startRun } = await import("../engine.mjs");
    const offThread = store.createApproval({ actorId: "m-nest-adult", householdId: "local", connectorId: "homeops", toolId: "famili.delete_memory", input: { memoryId: secret.id }, risk: "Medium", category: "Write", visibility: "household",
      preview: "Forget a memory: “NESTSECRET grandma surprise trip to Paris”\nAsked by Gran Harper" });
    store.putTask({ id: "tk_vis_thread", householdId: "local", title: "Rake the leaves", status: "todo", createdBy: "m-nest-kid", visibility: "household" });
    const parked = await startRun({ source: "assistant", sourceRef: { channel: "group", actorIsAdult: false, actorRole: "Limited Member" }, session: kid, title: "Change a task",
      plan: { title: "Change a task", steps: [{ toolId: "famili.update_task", title: "Change a task", input: { taskId: "tk_vis_thread", status: "done" } }] } });
    let run = null;
    for (let i = 0; i < 100 && run?.status !== "waiting_for_approval"; i++) { await new Promise((r) => setTimeout(r, 20)); run = store.getRun(parked.id); }
    const inThread = run?.steps?.[0]?.approvalId;
    assert.ok(inThread, "the thread's own park");
    const ids = async (who, channel) => ((await call("famili.list_approvals", {}, who, channel)).result?.approvals ?? []).map((a) => a.id);
    const outsiderGroup = await ids(outsider, "group");
    assert.ok(outsiderGroup.includes(inThread), "a park the thread itself queued is the thread's to see");
    assert.equal(outsiderGroup.includes(offThread.id), false, "one queued elsewhere is not — its preview names a nest's memory");
    assert.ok((await ids(adult, "group")).includes(offThread.id), "…except to the person who asked for it");
    const outsiderApp = await ids(outsider, "personal");
    assert.ok(outsiderApp.includes(offThread.id) && outsiderApp.includes(inThread), "the control: outside the group, as before");
  });
});

/* ───────────────────── the run engine (Stage 2) ───────────────────── */

describe("the run engine reaches a native action (ADR-004 Stage 2)", () => {
  /* A step parked for an adult has to be able to run once one approves, so the engine now
   * resolves a famili.* id (kind "native") and runs it with a ctx rebuilt from the run: the
   * role recorded when the run started — the REQUESTER's, never the approver's — and the
   * channel the request came from. These runs are started directly, as the chat lane's
   * queueApprovalRun → orchestrate would start them, with nothing to approve (a personal
   * channel), so what is pinned here is the resolution and the ctx, not the park. */
  let startRun, getRun, putTask, getTask, putMember;
  const settle = async (id) => {
    for (let i = 0; i < 100; i++) {
      const r = getRun(id);
      if (["completed", "failed", "partially_failed", "waiting_for_approval"].includes(r?.status)) return r;
      await new Promise((res) => setTimeout(res, 30));
    }
    return getRun(id);
  };
  const runStep = async (toolId, input, sourceRef, session) => settle((await startRun({
    source: "assistant", sourceRef, session, title: "Native step",
    plan: { title: "Native step", steps: [{ toolId, title: "Native step", input }] },
  })).id);
  before(async () => {
    ({ startRun } = await import("../engine.mjs"));
    ({ getRun, putTask, getTask, putMember } = await import("../store.mjs"));
    putMember({ actorId: "m-run-owner", displayName: "Run Owner", role: "Owner", householdId: "local" });
    putMember({ actorId: "m-run-kid", displayName: "Run Kid", role: "Limited Member", householdId: "local" });
  });

  test("a famili.* id resolves as kind \"native\" — not \"Unknown tool\" — and runs as the requester", async () => {
    putTask({ id: "tk_run_native_1", householdId: "local", title: "Water the plants", status: "todo", createdBy: "m-run-owner", visibility: "household" });
    const run = await runStep("famili.delete_task", { taskId: "tk_run_native_1" }, { actorRole: "Owner", channel: "personal" }, { householdId: "local", actorId: "m-run-owner", role: "Owner" });
    assert.equal(run.steps[0].attribution, "native", "resolved by the run engine");
    assert.equal(run.steps[0].requiresApproval, false, "an adult's native write never asks (decision A)");
    assert.equal(run.status, "completed", JSON.stringify(run.steps[0]));
    assert.deepEqual(run.steps[0].result, { deleted: true, title: "Water the plants" });
    assert.equal(getTask("tk_run_native_1") ?? null, null);
  });

  test("the recorded role is the one that runs: a Limited Member's step cannot delete someone else's task", async () => {
    putTask({ id: "tk_run_native_2", householdId: "local", title: "Mow the lawn", status: "todo", createdBy: "m-run-owner", visibility: "household" });
    const run = await runStep("famili.delete_task", { taskId: "tk_run_native_2" }, { actorRole: "Limited Member", channel: "personal" }, { householdId: "local", actorId: "m-run-kid", role: "Limited Member" });
    assert.equal(run.status, "failed");
    assert.equal(run.error, "forbidden", "the body's own ownership check, as the requester");
    assert.ok(getTask("tk_run_native_2"), "still there");
  });

  test("a promotion while a step waits does not widen it — the LOWER of the recorded and current roles runs", async () => {
    // Recorded as a Limited Member; the member record now says Owner. The step still runs as
    // the Limited Member it was asked as.
    putMember({ actorId: "m-run-promoted", displayName: "Run Promoted", role: "Owner", householdId: "local" });
    putTask({ id: "tk_run_native_3", householdId: "local", title: "Clean the garage", status: "todo", createdBy: "m-run-owner", visibility: "household" });
    const run = await runStep("famili.delete_task", { taskId: "tk_run_native_3" }, { actorRole: "Limited Member", channel: "personal" }, { householdId: "local", actorId: "m-run-promoted", role: "Limited Member" });
    assert.equal(run.error, "forbidden");
    assert.ok(getTask("tk_run_native_3"));
  });

  /* A child's group write parked, then an adult approves it after the child's standing changed. */
  const parkThenApprove = async (actorId, taskId, change) => {
    const { decideApproval } = await import("../store.mjs");
    const { resumeRun } = await import("../engine.mjs");
    putMember({ actorId, displayName: actorId, role: "Limited Member", householdId: "local" });
    putTask({ id: taskId, householdId: "local", title: "Hang up the coats", status: "todo", createdBy: actorId, visibility: "household" });
    const parked = await runStep("famili.delete_task", { taskId }, { actorRole: "Limited Member", channel: "group", actorIsAdult: false }, { householdId: "local", actorId, role: "Limited Member" });
    assert.equal(parked.status, "waiting_for_approval");
    putMember({ actorId, displayName: actorId, role: "Limited Member", householdId: "local", ...change });
    assert.ok(decideApproval(parked.steps[0].approvalId, { decision: "approve", actorId: "m-run-owner", actorRole: "Owner" }).approval, "an Owner approved it");
    await resumeRun(parked.id);
    return getRun(parked.id);
  };

  test("a DEMOTION while a step waits is honoured: the Owner's yes runs it as the lower role, and the body refuses it as read-only", async () => {
    const run = await parkThenApprove("m-run-demoted", "tk_run_native_demoted", { role: "Child View" });
    assert.equal(run.status, "failed");
    assert.equal(run.error, "read_only_profile", JSON.stringify(run.steps[0]));
    assert.ok(getTask("tk_run_native_demoted"), "nothing was deleted");
  });

  test("an ARCHIVED requester runs as no one: the Owner's yes ends in no_requester_role", async () => {
    const run = await parkThenApprove("m-run-archived", "tk_run_native_archived", { archived: true });
    assert.equal(run.status, "failed");
    assert.equal(run.error, "no_requester_role", JSON.stringify(run.steps[0]));
    assert.ok(getTask("tk_run_native_archived"), "nothing was deleted");
  });

  test("THE RUN PATH ASKS available() AGAIN: a helper tool is refused for a non-adult, and for anyone in the group thread", async () => {
    /* Review finding L4: the chat lane only offers a tool available() to this person here, but
     * the run path did not ask again before executing. Now it does, for the recorded requester
     * and channel. famili.list_helpers needs an adult outside the group thread. */
    const kid = { householdId: "local", actorId: "m-run-kid", role: "Limited Member" };
    const owner = { householdId: "local", actorId: "m-run-owner", role: "Owner" };
    const asKid = await runStep("famili.list_helpers", {}, { actorRole: "Limited Member", channel: "personal" }, kid);
    assert.equal(asKid.status, "failed");
    assert.equal(asKid.error, "tool_not_available", JSON.stringify(asKid.steps[0]));
    assert.match(asKid.steps[0].detail, /nothing was changed/);
    const inGroup = await runStep("famili.list_helpers", {}, { actorRole: "Owner", channel: "group" }, owner);
    assert.equal(inGroup.error, "tool_not_available", "not in the group thread, even for an Owner");
    const control = await runStep("famili.list_helpers", {}, { actorRole: "Owner", channel: "personal" }, owner);
    assert.equal(control.status, "completed", `the control: an Owner outside the group — ${JSON.stringify(control.steps[0])}`);
  });

  test("a native body that THROWS on the run path is tool_failed, as in the chat lane — not timeout", async () => {
    /* Review finding L4. famili.list_meals throws a RangeError on an impossible date (a latent
     * bug in its own `to` default, reported, not fixed here) — which is what makes it a real
     * throwing body to run. If that is ever fixed, pick another input that throws. */
    await assert.rejects(getAction("famili.list_meals").invoke({ householdId: "local", session: { householdId: "local", actorId: "m-run-owner", role: "Owner" }, channel: "personal" }, { from: "2026-99-99" }), RangeError, "precondition: the body throws");
    const run = await runStep("famili.list_meals", { from: "2026-99-99" }, { actorRole: "Owner", channel: "personal" }, { householdId: "local", actorId: "m-run-owner", role: "Owner" });
    assert.equal(run.status, "failed");
    assert.equal(run.error, "tool_failed", JSON.stringify(run.steps[0]));
    assert.match(run.steps[0].detail, /Invalid time value/, "the body's own message");
  });

  test("a run with NO recorded requester role never runs a native step — it is refused, not run as nobody", async () => {
    putTask({ id: "tk_run_native_4", householdId: "local", title: "Sort the mail", status: "todo", createdBy: "m-run-owner", visibility: "household" });
    const run = await runStep("famili.delete_task", { taskId: "tk_run_native_4" }, {}, { householdId: "local", actorId: "m-run-owner", role: "Owner" });
    assert.equal(run.steps[0].attribution, "native");
    assert.equal(run.status, "failed");
    assert.equal(run.error, "no_requester_role");
    assert.ok(getTask("tk_run_native_4"), "nothing was changed");
  });

  test("a run recorded as a non-adult's GROUP write parks it for an ADULT — even a Low-risk one a Limited Member could otherwise approve", async () => {
    const { listApprovals } = await import("../store.mjs");
    putTask({ id: "tk_run_native_6", householdId: "local", title: "Tidy the shoe rack", status: "todo", createdBy: "m-run-kid", visibility: "household" });
    const run = await runStep("famili.update_task", { taskId: "tk_run_native_6", status: "done" }, { actorRole: "Limited Member", channel: "group", actorIsAdult: false }, { householdId: "local", actorId: "m-run-kid", role: "Limited Member" });
    assert.equal(run.steps[0].requiresApproval, true, "decision C, from what the run recorded");
    assert.equal(run.status, "waiting_for_approval");
    const appr = listApprovals({ householdId: "local" }).find((a) => a.id === run.steps[0].approvalId);
    assert.equal(appr?.risk, "Low");
    assert.deepEqual(appr?.allowedApproverRoles, ["Owner", "Adult Admin", "Adult Member"], "a child's park is answered by an adult — never by a Limited Member, the asker included");
    assert.equal(getTask("tk_run_native_6").status, "todo", "nothing changed while it waits");
  });

  test("DECISION A ON THE RUN PATH: a helper's \"always ask me\" on a native step fails it — no approval nobody is meant to be asked for", async () => {
    const { putAgent, listApprovals } = await import("../store.mjs");
    putAgent({ id: "agt_run_ask", householdId: "local", name: "Asker", status: "Active", enabled: true, visibility: "household", allowedToolIds: [], deniedToolIds: [], approvalPolicy: { alwaysApprove: ["famili.delete_task"] } });
    putTask({ id: "tk_run_native_7", householdId: "local", title: "Fold the towels", status: "todo", createdBy: "m-run-owner", visibility: "household" });
    const before = listApprovals({ householdId: "local" }).length;
    const run = await runStep("famili.delete_task", { taskId: "tk_run_native_7" }, { agentId: "agt_run_ask", actorRole: "Owner", channel: "personal" }, { householdId: "local", actorId: "m-run-owner", role: "Owner" });
    assert.equal(run.status, "failed");
    assert.equal(run.error, "policy_agent.always_approve");
    assert.equal(run.steps[0].detail, ASK_FIRST);
    assert.equal(listApprovals({ householdId: "local" }).length, before, "no approval was created");
    assert.ok(getTask("tk_run_native_7"));
  });

  test("\"AN AUTOMATION KEEPS NOT FINISHING\": a helper's run still raises it; a person's one-off request never does, and it never reaches a non-adult", async () => {
    /* Review finding M2. Two failed or expired runs in a row from the same agent raise an in-app
     * alert to the run's actor. Every run a person's chat or group turn queues is attributed to
     * the household assistant, so a child whose two group requests an adult turned down was told
     * an automation keeps not finishing and to check Agents. A helper's own runs (via "agent") —
     * what the alert is for — keep it exactly as before. */
    const { putAgent, listNotifications } = await import("../store.mjs");
    const helper = (id) => putAgent({ id, householdId: "local", name: id, status: "Active", enabled: true, visibility: "household", allowedToolIds: [], deniedToolIds: [], approvalPolicy: {} });
    helper("agt_household"); helper("agt_alert_helper"); helper("agt_alert_kid_helper");
    const alerts = (actorId) => listNotifications((n) => n.actorId === actorId && n.title === "An automation keeps not finishing");
    const failTwice = async (sourceRef, session) => {
      for (let i = 0; i < 2; i++) assert.equal((await runStep("famili.delete_task", { taskId: "tk_alert_missing" }, sourceRef, session)).error, "task_not_found");
    };
    const owner = { householdId: "local", actorId: "m-run-owner", role: "Owner" };
    await failTwice({ via: "agent", agentId: "agt_alert_helper", actorRole: "Owner", channel: "personal" }, owner);
    assert.equal(alerts("m-run-owner").length, 1, "a helper's run failing twice still raises it — unchanged");
    assert.match(alerts("m-run-owner")[0].body, /hasn't delivered twice in a row/);
    await failTwice({ via: "chat", agentId: "agt_household", actorRole: "Owner", channel: "personal" }, owner);
    await failTwice({ via: "group_chat", agentId: "agt_household", actorRole: "Owner", channel: "group" }, owner);
    assert.equal(alerts("m-run-owner").length, 1, "a person's one-off requests — app, text or group — never do");
    await failTwice({ via: "agent", agentId: "agt_alert_kid_helper", actorRole: "Limited Member", channel: "personal" }, { householdId: "local", actorId: "m-run-kid", role: "Limited Member" });
    assert.equal(alerts("m-run-kid").length, 0, "and it never reaches a non-adult");
  });

  test("a native READ resolves and runs too, with the channel the run recorded", async () => {
    putTask({ id: "tk_run_native_5", householdId: "local", title: "Private journal time", status: "todo", createdBy: "m-run-owner", visibility: "private" });
    const personal = await runStep("famili.list_tasks", { query: "journal" }, { actorRole: "Owner", channel: "personal" }, { householdId: "local", actorId: "m-run-owner", role: "Owner" });
    assert.equal(personal.status, "completed");
    assert.equal(personal.steps[0].result.count, 1, "the owner sees their private task in a personal run");
    const group = await runStep("famili.list_tasks", { query: "journal" }, { actorRole: "Owner", channel: "group" }, { householdId: "local", actorId: "m-run-owner", role: "Owner" });
    assert.equal(group.steps[0].result.count, 0, "and not in a run recorded as the group thread's");
  });
});

/* ───────────────────── through the real chat route ───────────────────── */

describe("the native lane through the real chat route", () => {
  let ctx, owner, fake;
  const toolMessage = (i = 1) => JSON.stringify((fake.state.requests[i]?.messages ?? []).filter((m) => m.role === "tool").map((m) => m.content));
  const ask = async (calls, message = "do it") => {
    fake.state.requests = [];
    fake.state.script = [...calls.map((c) => ({ toolCalls: [c] })), { text: "ok" }];
    const r = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message }) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data;
  };
  const withHousehold = async (patch, fn) => {
    const agents = readStoreDoc(ctx, "agents.json", {});
    const saved = agents.agt_household;
    writeStoreDoc(ctx, "agents.json", { ...agents, agt_household: { ...saved, ...patch } });
    try { return await fn(); } finally {
      const now = readStoreDoc(ctx, "agents.json", {});
      writeStoreDoc(ctx, "agents.json", { ...now, agt_household: saved });
    }
  };
  const audit = async () => (await owner.req("/api/audit?limit=500")).data.events ?? [];

  before(async () => {
    ctx = await startServer();
    owner = await makeSession(ctx, "m-alex");
    fake = await useFakeModel(owner);
  });
  after(async () => { await stopServer(ctx); try { fake.server.close(); } catch { /* best effort */ } });

  test("the Owner's personal menu carries all sixteen, under the names the model has always used", async () => {
    await ask([]);
    const names = (fake.state.requests[0]?.tools ?? []).map((t) => t.function?.name ?? t.name);
    for (const id of MENU_ORDER) assert.ok(names.includes(id.replace(".", "__")), `${id} is on the menu`);
  });

  test("a helper's DENY-LIST now reaches a native write: status blocked, the event survives, assistant.tool_blocked is written", async () => {
    const ev = (await owner.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Piano recital", startAt: "2030-06-01T17:00:00.000Z" }) })).data.event;
    const r = await withHousehold({ deniedToolIds: ["famili.delete_event"] }, () => ask([{ name: "famili__delete_event", args: { eventId: ev.id } }]));
    assert.equal(r.toolCalls?.[0]?.tool, "famili.delete_event");
    assert.equal(r.toolCalls?.[0]?.status, "blocked", "a policy refusal is `blocked`, as a catalog refusal always was");
    assert.match(toolMessage(), /blocked list/, "the model is told why");
    const still = (await owner.req("/api/events")).data.events.find((e) => e.id === ev.id);
    assert.ok(still, "nothing was deleted");
    const row = (await audit()).find((a) => a.type === "assistant.tool_blocked" && a.toolId === "famili.delete_event");
    assert.equal(row?.agentId, "agt_household");
    assert.equal(row?.reason, "denied");
  });

  test("\"always ask me\" on a native write, through chat: blocked in words, and the task is still there", async () => {
    const tk = (await owner.req("/api/tasks", { method: "POST", body: JSON.stringify({ title: "Recycle the boxes" }) })).data.task;
    const r = await withHousehold({ approvalPolicy: { alwaysApprove: ["famili.delete_task"] } }, () => ask([{ name: "famili__delete_task", args: { taskId: tk.id } }]));
    assert.equal(r.toolCalls?.[0]?.status, "blocked");
    assert.equal(r.toolCalls?.[0]?.summary, ASK_FIRST);
    assert.ok((await owner.req("/api/tasks")).data.tasks.some((t) => t.id === tk.id), "not deleted");
    assert.ok((await audit()).some((a) => a.type === "assistant.tool_blocked" && a.toolId === "famili.delete_task" && a.rule === "agent.always_approve"));
  });

  test("a native call's assistant.tool row is the engine's shape: connectorId, durationMs, agentId", async () => {
    const r = await ask([{ name: "famili__list_tasks", args: { status: "open" } }]);
    assert.equal(r.toolCalls?.[0]?.status, "done");
    const row = (await audit()).find((a) => a.type === "assistant.tool" && a.toolId === "famili.list_tasks");
    assert.ok(row, "written");
    assert.equal(row.connectorId, "homeops");
    assert.equal(typeof row.durationMs, "number");
    assert.equal(row.agentId, "agt_household");
    assert.equal(row.ok, true);
    assert.equal(row.action, "Read");
  });

  test("THE KILL SWITCH on a Google-linked event: one helper, the same sentences, nothing changed and nothing sent", async () => {
    /* The three inline copies of the setting read are one call to googleReachAllowed() now.
     * No Google is reached here: the switch refuses BEFORE the call, which is the point. */
    writeStoreDoc(ctx, "accounts.json", [
      { id: "acct_alex_google", provider: "google", displayName: "alex@harper.example", scopes: ["https://www.googleapis.com/auth/calendar.events"], status: "connected", connectedByActorId: "m-alex", householdId: "local", createdAt: Date.now(), updatedAt: new Date().toISOString() },
    ]);
    const made = (await owner.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Swim meet", startAt: "2030-07-04T15:00:00.000Z" }) })).data.event;
    const rec = readStoreRecord(ctx, "events", made.id);
    writeStoreRecord(ctx, "events", made.id, { ...rec, layer: "linked", provenance: { ...(rec.provenance ?? {}), googleEventId: "g_native_1", googleAccountId: "acct_alex_google" } });
    const synced = (await owner.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Dentist", startAt: "2030-07-05T15:00:00.000Z" }) })).data.event;
    const srec = readStoreRecord(ctx, "events", synced.id);
    writeStoreRecord(ctx, "events", synced.id, { ...srec, provenance: { ...(srec.provenance ?? {}), googleEventId: "g_native_2" } });
    assert.equal((await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ externalActionsEnabled: false }) })).status, 200);
    try {
      const moved = await ask([{ name: "famili__update_event", args: { eventId: made.id, title: "Swim meet (moved)" } }]);
      assert.equal(moved.toolCalls?.[0]?.status, "failed", "the body's refusal, as before — not a policy block (the tool is a local write)");
      assert.match(String(moved.toolCalls?.[0]?.summary), /^External actions are paused by the household kill switch, so the Google copy can't be changed right now\.$/);
      const gone = await ask([{ name: "famili__delete_event", args: { eventId: made.id } }]);
      assert.equal(gone.toolCalls?.[0]?.status, "failed");
      assert.match(String(gone.toolCalls?.[0]?.summary), /^External actions are paused by the household kill switch\.$/);
      const kept = (await owner.req("/api/events")).data.events.find((e) => e.id === made.id);
      assert.equal(kept?.title, "Swim meet", "neither the edit nor the delete happened");
      // A FamiliOS event with a Google copy is deleted locally; the copy is kept, and it says so.
      const local = await ask([{ name: "famili__delete_event", args: { eventId: synced.id } }]);
      assert.equal(local.toolCalls?.[0]?.status, "done");
      assert.match(toolMessage(), /kept \(external actions paused\)/);
      assert.ok(!(await owner.req("/api/events")).data.events.some((e) => e.id === synced.id));
    } finally {
      await owner.req("/api/settings", { method: "POST", body: JSON.stringify({ externalActionsEnabled: true }) });
    }
  });

  test("a helper's instructions from chat are stored as written — commas and line breaks intact", async () => {
    /* `instructions` is a list key for plan_meal, and the chat loop used to split it for every
     * tool: create_helper then String()-ed the pieces back, storing "due today,and write". A
     * native tool's own schema now decides which keys are lists. */
    const instructions = "Every evening, look at tomorrow's calendar and anything due.\nThen write one short note: who is where, what is due, and what still needs a person.";
    const r = await ask([{ name: "famili__create_helper", args: { name: "Evening Look-Ahead", instructions, schedule: { kind: "daily", time: "19:00" } } }]);
    assert.equal(r.toolCalls?.[0]?.status, "done", JSON.stringify(r.toolCalls));
    const made = (await owner.req("/api/helpers")).data.helpers.find((h) => h.name === "Evening Look-Ahead");
    assert.equal(made?.instructions, instructions);
  });

  test("a schedule with nulls in it is the default again, through the real helper tools", async () => {
    const r = await ask([{ name: "famili__create_helper", args: { name: "Weekly Tidy", instructions: "Each week, list the chores nobody has done and nudge whoever they are assigned to.", schedule: { kind: "weekly", time: "07:00", weekday: null } } }]);
    assert.equal(r.toolCalls?.[0]?.status, "done", JSON.stringify(r.toolCalls));
    const made = (await owner.req("/api/helpers")).data.helpers.find((h) => h.name === "Weekly Tidy");
    assert.equal(made?.scheduleText, "Every Monday at 7:00 AM", "normalizeSchedule's default weekday, as before");
    const u = await ask([{ name: "famili__update_helper", args: { helperId: made.id, schedule: { kind: "manual", time: null, weekday: null } } }]);
    assert.equal(u.toolCalls?.[0]?.status, "done", JSON.stringify(u.toolCalls));
    assert.equal((await owner.req("/api/helpers")).data.helpers.find((h) => h.id === made.id)?.scheduleText, "Only when you ask");
  });

  test("ACCEPTED RISK, made concrete: \"Famili in chat\" (agt_chat) has a non-empty allow-list, so a manual run of it is refused every native tool", async () => {
    /* agt_chat is seeded with allowedToolIds ["sms.send"] the first time a group thread is
     * seen, and the Helpers list offers it Run now. A non-empty allow-list means "only
     * these", so the native tools it used to reach regardless are refused as not_permitted. */
    assert.equal((await owner.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ memberId: "m-alex", label: "Mobile", type: "Phone/Text", value: "+15550107499", verified: true, optInStatus: "Opted In" }) })).status, 200);
    const hook = await ctx.fetch("/api/webhooks/bluebubbles", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "new-message", data: { guid: "p:0/native-seed", text: "hello all", isFromMe: false, dateCreated: Date.now(), handle: { address: "+15550107499", service: "iMessage" }, chats: [{ guid: "iMessage;+;chat-native-seed" }] } }) });
    assert.equal(hook.status, 200);
    const chatHelper = readStoreDoc(ctx, "agents.json", {}).agt_chat;
    assert.deepEqual(chatHelper?.allowedToolIds, ["sms.send"], "seeded with its one-tool list");
    fake.state.requests = [];
    fake.state.script = [{ toolCalls: [{ name: "famili__list_events", args: {} }] }, { text: "Nothing I can look at." }];
    const run = await owner.req("/api/helpers/agt_chat/run", { method: "POST" });
    assert.equal(run.status, 200, JSON.stringify(run.data));
    assert.equal(run.data.toolCalls?.[0]?.tool, "famili.list_events");
    assert.equal(run.data.toolCalls?.[0]?.status, "blocked");
    assert.match(toolMessage(), /not_permitted_not_permitted/);
  });
});
