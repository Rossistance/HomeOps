// FamiliOS — WP-002 (Honest delivery), slice 2: chat-run agent attribution.
//
// Before this WP, POST /api/assistant(/stream) started a run with NO agentId at all
// (orchestrator.runAssistantPlan, which attributes the household's default agent, was
// dead code — never called). Two dishonest consequences:
//   1. homeops.notify_contact hard-refuses any run with no acting agent, so a plain
//      chat ask could never actually deliver a real notification — only ever draft one.
//   2. an unattributed run got NONE of the WP-003 visible-skip policy clamp that an
//      agent/skill run already gets.
// This suite proves: (a) a chat-born run now carries agentId and notify_contact can
// succeed from a plain ask, (b) a tool the household has explicitly denied on its
// default agent still shows up as an honest, visible skip — never silently run and
// never a hard failure of the whole run, (c) ordinary chat capability (tools outside
// the agent's ORIGINAL narrow seed allow-list) is preserved, not newly clamped, and
// (d) the HOMEOPS_CHAT_AGENT_ATTRIBUTION=off rollback restores the exact pre-WP-002
// shape. No AI provider is real: a local scripted HTTP server stands in for Ollama, so
// every "chat message" deterministically returns a fixed plan — no network, no LLM.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer, makeSession, readStoreDoc, writeStoreDoc } from "./harness.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitTerminal(owner, runId, extra = [], timeoutMs = 20000) {
  const terminal = ["completed", "failed", "cancelled", "expired", ...extra];
  const t0 = Date.now();
  let run = null;
  while (Date.now() - t0 < timeoutMs) {
    const r = await owner.req(`/api/runs/${runId}`);
    run = r.data?.run ?? null;
    if (run && terminal.includes(run.status)) return run;
    await sleep(200);
  }
  return run;
}

// A scripted "assistant brain" reply. `plan` is a mutable slot the test sets right
// before posting the chat message, so the plan's step input can reference ids (like a
// freshly created contact method) that only exist once the test is running.
let nextPlan = null;
function fakeModelServer() {
  return http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url === "/api/tags") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ models: [{ name: "tg-fake" }] })); return; }
      let messages = [];
      try { messages = JSON.parse(body).messages ?? []; } catch { /* ignore */ }
      const sys = String(messages?.[0]?.content ?? "");
      let reply;
      if (sys.includes("You are FamiliOS, a warm, capable assistant") && nextPlan) {
        reply = JSON.stringify({ kind: "plan", answer: "On it.", plan: nextPlan });
      } else {
        reply = JSON.stringify({ kind: "answer", answer: "ok" });
      }
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(JSON.stringify({ message: { content: reply } }) + "\n");
    });
  });
}
async function wireFakeProvider(ctx, owner) {
  const fake = fakeModelServer();
  await new Promise((r) => fake.listen(0, r));
  const port = fake.address().port;
  await owner.req("/api/ai/providers/ollama/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "tg-fake" }) });
  await owner.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "ollama" }) });
  return fake;
}

function notifyPlan(methodId) {
  return {
    title: "TG-Notify via chat", summary: "Send a contact method a note.",
    icon: "Bell", spaceType: "Personal", instructions: "", trigger: { type: "Manual", detail: "" },
    steps: [
      { toolId: "homeops.notify_contact", title: "Send to a contact method", detail: "", input: { methodId, subject: "TG chat notify", body: "TG chat-attributed notify body, long enough to pass validation." }, requiresApproval: false },
    ],
    approvalGates: [], risk: "Low",
  };
}
function taskPlan(suffix) {
  return {
    title: `TG-Create a task via chat ${suffix}`, summary: "Add a household task.",
    icon: "Bot", spaceType: "Personal", instructions: "", trigger: { type: "Manual", detail: "" },
    steps: [
      { toolId: "homeops.create_task", title: "Add a task", detail: "", input: { title: `TG-chat-attribution ${suffix}` }, requiresApproval: false },
    ],
    approvalGates: [], risk: "Low",
  };
}

async function postChat(owner, message) {
  const r = await owner.req("/api/assistant", { method: "POST", body: JSON.stringify({ message }) });
  assert.equal(r.status, 200, `chat post failed: ${JSON.stringify(r.data)}`);
  assert.ok(r.data?.run?.id, `chat did not auto-start a run: ${JSON.stringify(r.data)}`);
  return r.data.run.id;
}

/* ================================================================= *
 * Flag ON (default) — chat runs carry agt_household
 * ================================================================= */
describe("chat-run agent attribution (HOMEOPS_CHAT_AGENT_ATTRIBUTION default ON)", () => {
  let ctx, owner, fake;

  before(async () => {
    ctx = await startServer();
    owner = await makeSession(ctx, "m-alex");
    fake = await wireFakeProvider(ctx, owner);
  });
  after(async () => { await stopServer(ctx); await new Promise((r) => fake.close(r)); });

  test("a chat-born run carries sourceRef.agentId (agt_household)", async () => {
    nextPlan = taskPlan("attribution-check");
    const runId = await postChat(owner, "TG: add a task");
    const run = await waitTerminal(owner, runId);
    assert.equal(run.status, "completed");
    assert.equal(run.sourceRef?.agentId, "agt_household", "a chat run must now carry the household's default agent id");
  });

  test("notify_contact succeeds from a plain chat ask — no no_acting_agent refusal", async () => {
    // In-App methods are born verified/opted-in and never leave the device, so this
    // stays fully hermetic (no Gmail/Twilio needed) while still exercising the REAL
    // per-agent allowlist gate in deliverNotification.
    const made = await owner.req("/api/contact-methods", {
      method: "POST",
      body: JSON.stringify({ label: "TG chat in-app", type: "In-App", allowedAgentIds: ["agt_household"] }),
    });
    assert.ok(made.data?.contactMethod, `contact method creation failed: ${JSON.stringify(made.data)}`);
    nextPlan = notifyPlan(made.data.contactMethod.id);
    const runId = await postChat(owner, "TG: let them know");
    const run = await waitTerminal(owner, runId);
    assert.equal(run.status, "completed", `run did not complete: ${JSON.stringify(run)}`);
    const step = run.steps[0];
    assert.equal(step.toolId, "homeops.notify_contact");
    assert.notEqual(step.status, "failed", `notify_contact must not fail from a chat run: ${step.detail}`);
    assert.doesNotMatch(String(step.detail ?? ""), /no_acting_agent|needs to run as a specific helper/i,
      "the exact pre-WP-002 refusal must be gone now that chat carries an agent identity");
    assert.equal(step.status, "succeeded");
    assert.equal(step.result?.delivered, true);
    assert.equal(step.result?.channel, "in_app");
  });

  test("a tool the household has explicitly denied on its default agent is a visible skip, not silence and not a hard failure", async () => {
    // Deny homeops.create_task on agt_household directly in the store (simulating a
    // household's own deliberate choice) — this must survive the WP-002 slice-2
    // widening (which only ever clears the ALLOW lists, never a DENY list).
    const agents = readStoreDoc(ctx, "agents.json", {});
    agents["agt_household"] = { ...agents["agt_household"], deniedToolIds: ["homeops.create_task"] };
    writeStoreDoc(ctx, "agents.json", agents);
    try {
      nextPlan = taskPlan("denied");
      const runId = await postChat(owner, "TG: add a denied task");
      const run = await waitTerminal(owner, runId);
      assert.equal(run.status, "completed", "a fully-clamped plan must still complete, not hard-fail");
      const step = run.steps[0];
      assert.equal(step.status, "skipped", "a policy-denied step must be a visible skip, matching agent/skill runs");
      assert.match(String(step.detail), /not permitted/i);
      assert.ok(step.clampedOut, "must carry the machine-readable clamp reason, same as an agent run");
      assert.equal(step.clampedOut.reason, "denied");
    } finally {
      // Restore for the remaining tests in this describe block.
      const restore = readStoreDoc(ctx, "agents.json", {});
      restore["agt_household"] = { ...restore["agt_household"], deniedToolIds: [] };
      writeStoreDoc(ctx, "agents.json", restore);
    }
  });

  test("ordinary chat capability is preserved — a tool outside agt_household's ORIGINAL narrow seed allow-list still runs", async () => {
    // agt_household was seeded allowed only for weather.current/calendar.list/
    // gmail.search/write_memory/create_artifact/create_approval. create_task was never
    // in that list. Attribution must not silently shrink chat down to those six tools.
    nextPlan = taskPlan("still-works");
    const runId = await postChat(owner, "TG: add another task");
    const run = await waitTerminal(owner, runId);
    assert.equal(run.status, "completed");
    const step = run.steps[0];
    assert.equal(step.status, "succeeded", "attribution must not newly clamp tools chat already relied on");
    assert.equal(step.toolId, "homeops.create_task");
  });
});

/* ================================================================= *
 * Flag OFF — instant rollback to the pre-WP-002 shape
 * ================================================================= */
describe("chat-run agent attribution rollback (HOMEOPS_CHAT_AGENT_ATTRIBUTION=off)", () => {
  let ctx, owner, fake;

  before(async () => {
    ctx = await startServer({ env: { HOMEOPS_CHAT_AGENT_ATTRIBUTION: "off" } });
    owner = await makeSession(ctx, "m-alex");
    fake = await wireFakeProvider(ctx, owner);
  });
  after(async () => { await stopServer(ctx); await new Promise((r) => fake.close(r)); });

  test("a chat-born run carries NO agentId, exactly like before WP-002", async () => {
    nextPlan = taskPlan("flag-off");
    const runId = await postChat(owner, "TG: add a task with the flag off");
    const run = await waitTerminal(owner, runId);
    assert.equal(run.status, "completed");
    assert.equal(run.sourceRef?.agentId ?? null, null, "the flag must fully restore the pre-WP-002 unattributed shape");
  });

  test("notify_contact is refused with no_acting_agent again, the exact pre-WP-002 behavior", async () => {
    const made = await owner.req("/api/contact-methods", {
      method: "POST",
      body: JSON.stringify({ label: "TG flag-off in-app", type: "In-App", allowedAgentIds: ["agt_household"] }),
    });
    nextPlan = notifyPlan(made.data.contactMethod.id);
    const runId = await postChat(owner, "TG: let them know with the flag off");
    const run = await waitTerminal(owner, runId);
    const step = run.steps[0];
    assert.equal(step.status, "failed");
    assert.match(String(step.detail), /needs to run as a specific helper/i);
  });
});
