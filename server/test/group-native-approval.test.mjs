/* ADR-004 STAGE 2 — a non-adult's write in the family group thread waits for an adult.
 *
 * Driven through the REAL group lane: a spawned server, the BlueBubbles webhook, a bound
 * group chat, verified phone numbers for an Owner and a Limited Member, and a scripted model
 * (the same harness group-agent-turn and group-injection use). The household is set to
 * Trusted by its Owner — the stance every bound group household has, and the one that used
 * to clear a parked step on its way through the run engine.
 *
 * What this file pins, in order:
 *   1. THE RUN-PATH GAP, closed for catalog tools. A Limited Member's approval-gated catalog
 *      call in the group thread was parked by the chat turn (rule 4b), then re-judged by the
 *      run without `actorIsAdult`, cleared by Trusted, and executed with no approval while
 *      the model was told it was done. The run now carries what the chat judged it on.
 */
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-groupnative-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { startServer, stopServer, makeSession } = await import("./harness.mjs");
const { useFakeModel } = await import("./fake-model.mjs");

const OWNER_NUM = "+15550107601";
const KID_NUM = "+15550107602";
const GROUP_GUID = "iMessage;+;chat-native-park";
const RUN_ID = /run_[0-9a-f]{20}/;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 12000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(100);
  }
}

describe("the group thread, through the real BlueBubbles lane", () => {
  let ctx, alex, fake;
  let n = 0;

  async function post(address, text) {
    const r = await ctx.fetch("/api/webhooks/bluebubbles", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "new-message",
        data: {
          guid: `p:0/native-park-${++n}`, text, isFromMe: false, dateCreated: Date.now(),
          handle: { address, service: "iMessage" },
          chats: [{ guid: GROUP_GUID }],
        },
      }),
    });
    return { status: r.status, data: await r.json() };
  }
  const audit = async () => (await alex.req("/api/audit?limit=500")).data.events ?? [];
  const wakeTurns = async () => (await audit()).filter((a) => a.type === "imessage.wake_turn").length;
  const pendingFor = async (toolId) => ((await alex.req("/api/approvals")).data.approvals ?? []).filter((a) => a.status === "pending" && a.toolId === toolId);
  const runOf = async (id) => (await alex.req(`/api/runs/${id}`)).data?.run ?? null;

  /** One Lane 2 turn: script the model, wake Famili from `address`, and wait for the turn to
   *  finish (its imessage.wake_turn row). Returns every tool result the model was shown,
   *  parsed — the same object the tool's execute returned to it. */
  async function groupTurn(address, text, script) {
    const turnsBefore = await wakeTurns();
    const from = fake.state.requests.length;
    fake.state.script.push(...script);
    const r = await post(address, `@famili ${text}`);
    assert.equal(r.data.kind, "wake_accepted", JSON.stringify(r.data));
    assert.ok(await waitFor(async () => (await wakeTurns()) > turnsBefore), "the turn finished");
    const told = fake.state.requests.slice(from)
      .flatMap((q) => (q.messages ?? []).filter((m) => m.role === "tool"))
      .map((m) => { try { return JSON.parse(m.content); } catch { return m.content; } });
    return told;
  }

  before(async () => {
    ctx = await startServer({ env: { HOMEOPS_CONNECTOR_SANDBOX: "1" } });
    alex = await makeSession(ctx, "m-alex"); // Owner
    fake = await useFakeModel(alex);
    const m = await alex.req("/api/members", { method: "POST", body: JSON.stringify({ actorId: "m-maya", displayName: "Maya Harper", role: "Limited Member", relationship: "Child (age 14)" }) });
    assert.equal(m.status, 200, JSON.stringify(m.data));
    for (const [memberId, value] of [["m-alex", OWNER_NUM], ["m-maya", KID_NUM]]) {
      const cm = await alex.req("/api/contact-methods", { method: "POST", body: JSON.stringify({ memberId, label: "Mobile", type: "Phone/Text", value, verified: true, optInStatus: "Opted In" }) });
      assert.equal(cm.status, 200, JSON.stringify(cm.data));
    }
    // Trusted, set by the Owner: the stance under which the old run path let a parked step go.
    const s = await alex.req("/api/settings", { method: "POST", body: JSON.stringify({ autonomy: "Trusted" }) });
    assert.equal(s.status, 200, JSON.stringify(s.data));
    await post(OWNER_NUM, "starting a thread");
    const chatId = (await alex.req("/api/group-chats")).data.chats.find((c) => c.chatGuid === GROUP_GUID).id;
    const bound = await alex.req("/api/group-chats", { method: "POST", body: JSON.stringify({ chatId }) });
    assert.equal(bound.status, 200, JSON.stringify(bound.data));
  });
  after(async () => { await stopServer(ctx); try { fake.server.close(); } catch { /* best effort */ } });

  test("THE RUN-PATH GAP, CLOSED: a Limited Member's approval-gated CATALOG call in the group thread stays parked under a Trusted stance an Owner set", async () => {
    /* homeops.create_approval asks for approval by default and reaches outside (action Send),
     * so Trusted-by-an-Owner clears it — for an adult. The chat turn parked Maya's call under
     * rule 4b; the run used to re-judge it without her standing, clear it, record the
     * "approved decision" and report completed. */
    const told = await groupTurn(KID_NUM, "ask the adults to sign off on the concert tickets", [
      { toolCalls: [{ name: "homeops__create_approval", args: { subject: "Concert tickets for Saturday", detail: "Maya asked in the family thread." } }] },
      { text: "I've asked the adults to sign off." },
    ]);
    const out = told.find((t) => t && typeof t === "object" && (t.status || "ok" in t));
    assert.equal(out?.status, "awaiting_approval", `the model is told it is WAITING, not done: ${JSON.stringify(told)}`);
    const runId = RUN_ID.exec(JSON.stringify(out))?.[0];
    assert.ok(runId, "and it names the parked run");
    await sleep(400); // nothing further may happen on its own
    const run = await runOf(runId);
    assert.equal(run.status, "waiting_for_approval", `still waiting for an adult: ${JSON.stringify(run)}`);
    assert.equal(run.steps[0].status, "waiting_for_approval");
    // What the chat judged it on is on the run, server-assigned.
    assert.equal(run.sourceRef.channel, "group");
    assert.equal(run.sourceRef.actorIsAdult, false);
    assert.equal(run.sourceRef.actorRole, "Limited Member");
    assert.equal(run.sourceRef.agentId, "agt_household", "the helper that evaluated it in the chat");
    const pending = await pendingFor("homeops.create_approval");
    assert.equal(pending.length, 1, "one real approval for an adult to answer");
    assert.equal(run.steps[0].approvalId, pending[0].id);
    assert.equal((await audit()).some((a) => a.type === "run.step" && a.runId === runId && a.toolId === "homeops.create_approval"), false, "and the step never executed");
  });

  test("…and an ADULT's same call is unaffected: the Owner's own Trusted grant still applies to the Owner", async () => {
    const told = await groupTurn(OWNER_NUM, "record that we signed off on the campsite", [
      { toolCalls: [{ name: "homeops__create_approval", args: { subject: "Campsite for the long weekend", detail: "Agreed in the family thread." } }] },
      { text: "Recorded." },
    ]);
    const out = told.find((t) => t && typeof t === "object" && "ok" in t);
    assert.equal(out?.ok, true, `it ran in the turn, as it always did: ${JSON.stringify(told)}`);
    assert.equal(out?.result?.subject, "Campsite for the long weekend");
    assert.equal((await pendingFor("homeops.create_approval")).length, 1, "no new approval — only the Limited Member's is waiting");
  });
});
