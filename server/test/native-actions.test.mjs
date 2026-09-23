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
const ASK_FIRST = "This helper is set to ask before doing this, and approvals for this tool arrive in a later update — nothing was done.";
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

test("\"ALWAYS ASK ME\" ON A NATIVE TOOL IS REFUSED IN WORDS — Stage 1 cannot park it, and must not run or drop it", async () => {
  /* Every native tool is requiresApproval:false, but the ladder can still answer
   * NEEDS_APPROVAL for one: rule 4 (the helper's alwaysApprove) and rule 6 (an autoAllow on a
   * write, which it refuses to relax). The run engine cannot resolve a famili.* id until
   * Stage 2, so queueing it would end as "Unknown tool". It is refused, and says why. */
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

test("STAGE 1, BY DESIGN: a Limited Member in the GROUP thread still deletes their own task at once — rule 4b parks only a gated tool (owner decision C)", async () => {
  /* Rule 4b parks a non-adult's call only when the capability itself asks for approval, and
   * no native tool does. So the real famili.delete_task, called as a Limited Member in the
   * group lane with actorIsAdult:false, runs immediately. Pinned so that changing it is a
   * decision (ADR-004 decision C), not a side effect. */
  const { putTask, getTask } = await import("../store.mjs");
  putTask({ id: "tk_native_kid", householdId: "local", title: "Feed the fish", status: "todo", createdBy: "m-kid", visibility: "household" });
  const kid = { householdId: "local", actorId: "m-kid", role: "Limited Member" };
  const del = NATIVE_ACTIONS.find((a) => a.id === "famili.delete_task");
  const out = await runNativeAction({ action: del, input: { taskId: "tk_native_kid" }, session: kid, agent: agentWith(), channel: "group", actorIsAdult: false });
  assert.deepEqual(out, { ok: true, result: { deleted: true, title: "Feed the fish" } });
  assert.equal(getTask("tk_native_kid") ?? null, null, "gone, with no approval record");
});

test("with no acting agent the ladder is skipped exactly as executeToolForChat skips it; rule 4b never touches a native tool", async () => {
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
  // A Limited Member in the group thread: 4b parks only what the capability itself gates.
  assert.equal((await runNativeAction({ action: a, input: {}, session, agent: agentWith(), channel: "group", actorIsAdult: false })).ok, true);
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
