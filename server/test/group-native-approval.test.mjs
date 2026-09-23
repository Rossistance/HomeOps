/* ADR-004 STAGE 2 — a non-adult's write in the family group thread waits for an adult.
 *
 * Driven through the REAL group lane: a spawned server, the BlueBubbles webhook, a bound
 * group chat, verified phone numbers for an Owner and a Limited Member, and a scripted model
 * (the same harness group-agent-turn and group-injection use). The household is set to
 * Trusted by its Owner — one of the grants that let Famili speak in a group thread at all
 * (group-chat.mjs speakPermission), and the one that used to clear a parked step on its way
 * through the run engine.
 *
 * What this file pins, in order:
 *   1. THE RUN-PATH GAP, closed for catalog tools. A Limited Member's approval-gated catalog
 *      call in the group thread was parked by the chat turn (rule 4b), then re-judged by the
 *      run without `actorIsAdult`, cleared by Trusted, and executed with no approval while
 *      the model was told it was done. The run now carries what the chat judged it on.
 *   2. DECISION C. A Limited Member's native write in the group thread is queued for an adult
 *      the same way; an Owner's yes runs it AS THE CHILD (so it still cannot reach someone
 *      else's task), a no leaves it; the same child in the app, an adult in the group, and a
 *      child's read are never held (decision A).
 *   3. WHAT AN ADULT READS (in-process, run first): the approval's server-built preview (never
 *      a private item's title), the push body leading with it, and parked/expired copy that
 *      says "changed" for a step that would only have changed something at home.
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

/* ─────────── 3. what an adult reads: the preview, the push and the copy (in-process) ─────────── */

describe("what an adult reads before deciding", () => {
  let approvalPreview, getAction, store, notify, runs;
  const kid = { householdId: "local", actorId: "m-pv-kid", role: "Limited Member", actorName: "Maya Harper" };
  before(async () => {
    ({ approvalPreview } = await import("../actions/native/shared.mjs"));
    ({ getAction } = await import("../actions/registry.mjs"));
    store = await import("../store.mjs");
    notify = await import("../notify.mjs");
    runs = await import("../assistant-runs.mjs");
    store.putMember({ actorId: "m-pv-kid", displayName: "Maya Harper", role: "Limited Member", householdId: "local" });
    store.putMember({ actorId: "m-pv-owner", displayName: "Alex Harper", role: "Owner", householdId: "local" });
    store.setSettings({ timezone: "America/New_York" }, "local");
  });

  test("THE PREVIEW names the action, the record and who asked — built on the server, never from the request", () => {
    const delTask = getAction("famili.delete_task");
    store.putTask({ id: "tk_pv_1", householdId: "local", title: "Take out the trash", status: "todo", createdBy: "m-pv-kid", visibility: "household" });
    assert.equal(approvalPreview(delTask, { taskId: "tk_pv_1" }, { session: kid, channel: "group" }),
      "Delete a task: Take out the trash\nAsked by Maya Harper in the family group thread");
    // A move names the new time, on the household's clock.
    store.putEvent({ id: "ev_pv_1", householdId: "local", title: "Soccer practice", startAt: "2030-09-19T20:00:00.000Z", visibility: "household", layer: "canonical" });
    const moved = approvalPreview(getAction("famili.update_event"), { eventId: "ev_pv_1", startAt: "2030-09-19T21:00:00.000Z" }, { session: kid, channel: "group" });
    assert.match(moved.split("\n")[0], /^Change an event: Soccer practice → Thu, Sep 19, 5:00\sPM$/);
    assert.equal(approvalPreview(getAction("famili.update_task"), { taskId: "tk_pv_1", status: "done" }, { session: kid, channel: "group" }).split("\n")[0],
      "Change a task: Take out the trash → done");
    // No such record: the action alone, and the body refuses the id when it runs.
    assert.equal(approvalPreview(delTask, { taskId: "tk_nope" }, { session: kid, channel: "group" }).split("\n")[0], "Delete a task");
  });

  test("…and it never carries a PRIVATE item's title or a personal memory's text: the approval reaches every adult", () => {
    store.putTask({ id: "tk_pv_private", householdId: "local", title: "Therapy homework", status: "todo", createdBy: "m-pv-owner", ownerId: "m-pv-owner", visibility: "private" });
    const hidden = approvalPreview(getAction("famili.delete_task"), { taskId: "tk_pv_private" }, { session: kid, channel: "group" });
    assert.equal(hidden, "Delete a task\nAsked by Maya Harper in the family group thread");
    const mem = store.addMemory({ householdId: "local", scope: "personal", type: "fact", text: "Maya's locker code is 4412", sourceActorId: "m-pv-kid" });
    const forgot = approvalPreview(getAction("famili.delete_memory"), { memoryId: mem.id }, { session: kid, channel: "group" });
    assert.equal(forgot.split("\n")[0], "Forget a memory", "a personal memory is never named in the group thread, not even to its owner");
    assert.equal(forgot.includes("4412"), false);
  });

  test("THE PUSH leads with the preview, for every tool — the raw id only when there is no preview", async () => {
    store.addPushToken("tok-pv-owner", { householdId: "local", actorId: "m-pv-owner" });
    const base = { householdId: "local", requestedBy: "m-pv-kid", visibility: "household", allowedApproverRoles: ["Owner", "Adult Admin", "Adult Member"] };
    const realFetch = globalThis.fetch;
    const sent = [];
    globalThis.fetch = async (_url, init) => {
      const messages = JSON.parse(init.body);
      sent.push(messages);
      return { ok: true, status: 200, json: async () => ({ data: messages.map(() => ({ status: "ok" })) }) };
    };
    try {
      await notify.pushApprovalNotification({ ...base, id: "apr_pv_1", toolId: "famili.delete_task", preview: "Delete a task: Take out the trash\nAsked by Maya Harper in the family group thread" });
      await notify.pushApprovalNotification({ ...base, id: "apr_pv_2", toolId: "gmail.send", preview: "Send the weekly note" });
      await notify.pushApprovalNotification({ ...base, id: "apr_pv_3", toolId: "gmail.send", preview: "" });
    } finally { globalThis.fetch = realFetch; }
    const bodies = sent.map((m) => m[0]?.body);
    assert.deepEqual(bodies, [
      "Delete a task: Take out the trash — Asked by Maya Harper in the family group thread",
      "Send the weekly note",
      "gmail.send",
    ]);
    assert.equal(sent[0][0].title, "Approval needed", "the title is unchanged");
  });

  test("THE COPY: a step that would only have changed something at home says \"changed\"; a send keeps \"sent\"", () => {
    const { nothingHappened, runOutcomeText, parkedStatusText } = runs;
    assert.equal(nothingHappened("famili.delete_task"), "nothing has changed yet");
    assert.equal(nothingHappened("famili.delete_task", { past: true }), "nothing was changed");
    assert.equal(nothingHappened("homeops.create_task"), "nothing has changed yet", "a local catalog write too");
    assert.equal(nothingHappened("gmail.send"), "nothing has been sent yet");
    assert.equal(nothingHappened("homeops.create_approval", { past: true }), "nothing was sent", "a Send keeps today's words");
    assert.equal(nothingHappened("calendar.create"), "nothing has been sent yet", "so does a provider write — it reaches outside");
    assert.equal(nothingHappened(["famili.delete_task", "gmail.send"]), "nothing has been sent yet", "mixed or unknown → today's words");
    assert.equal(nothingHappened(undefined), "nothing has been sent yet");

    const expired = (toolId, title) => ({ status: "expired", title, cursor: 0, steps: [{ index: 0, toolId, title, status: "expired" }] });
    const local = runOutcomeText(expired("famili.delete_task", "Delete a task or list item"));
    assert.match(local, /^That approval expired — nothing was changed for "Delete a task or list item"\./);
    assert.match(local, /• Expired — "Delete a task or list item" was waiting on approval and the window closed\. Nothing was changed\./);
    const send = runOutcomeText(expired("gmail.send", "Send email"));
    assert.match(send, /^That approval expired — nothing was sent for "Send email"\./);
    assert.match(send, /the window closed\. Nothing was sent\./);

    const parked = (toolId, title) => ({ title, cursor: 0, steps: [{ index: 0, toolId, title, status: "waiting_for_approval" }] });
    assert.equal(parkedStatusText(parked("homeops.create_task", "Create task"), { expiresAt: Date.now() + 30 * 60_000 }),
      "Waiting for your approval before \"Create task\" can run — nothing has changed yet. It expires in about 30 minutes. Review it in your Inbox to let it through.");
    assert.match(parkedStatusText(parked("gmail.send", "Send email")), /can run — nothing has been sent yet\. Review it/);
  });
});

describe("the group thread, through the real BlueBubbles lane", () => {
  let ctx, alex, maya, fake;
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
  const settled = (id) => waitFor(async () => { const r = await runOf(id); return ["completed", "failed", "partially_failed", "expired"].includes(r?.status) ? r : null; });
  const taskExists = async (id) => ((await alex.req("/api/tasks")).data.tasks ?? []).some((t) => t.id === id);
  const makeTask = async (client, title) => {
    const r = await client.req("/api/tasks", { method: "POST", body: JSON.stringify({ title, visibility: "household" }) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return r.data.task;
  };
  // The one tool result in a turn's replies that is an object the tool returned.
  const outcome = (told) => told.find((t) => t && typeof t === "object" && ("ok" in t || "status" in t));
  const decide = async (id, decision) => {
    const r = await alex.req(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision }) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  };
  /** A Limited Member asks, in the group thread, for a native write; returns the parked run. */
  async function childParks(toolName, args, ask) {
    const told = await groupTurn(KID_NUM, ask, [{ toolCalls: [{ name: toolName, args }] }, { text: "That one needs a grown-up." }]);
    const out = outcome(told);
    assert.equal(out?.status, "awaiting_approval", `the model is told it is waiting: ${JSON.stringify(told)}`);
    assert.match(String(out.message), /Queued for the family's approval/, "the same sentence a parked catalog call gets");
    const runId = RUN_ID.exec(JSON.stringify(out))?.[0];
    assert.ok(runId, "and it names the parked run");
    return { out, runId };
  }

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
    maya = await makeSession(ctx, "m-maya");
    assert.equal(maya.role, "Limited Member");
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

  /* ─────────── 2. decision C: a non-adult's NATIVE write waits for an adult ─────────── */

  let parked; // { runId, taskId } — parked by the first test below, decided by the next
  test("DECISION C: a Limited Member's famili.delete_task in the group thread waits for an adult — nothing is deleted, one approval is pending, and Trusted does not clear it", async () => {
    /* Stage 1 pinned the opposite: this ran at once. Now the chat lane queues it exactly as a
     * gated catalog call (the receipt the family's Ask screen would show is awaiting_approval;
     * the model is told the same), and the run re-judges it as a child's under the Owner's
     * Trusted stance — and still waits. */
    const tk = await makeTask(maya, "Take out the trash");
    const { runId } = await childParks("famili__delete_task", { taskId: tk.id }, "delete my trash task");
    await sleep(400); // nothing further may happen on its own
    const run = await runOf(runId);
    assert.equal(run.status, "waiting_for_approval", `still waiting under Trusted-by-an-Owner: ${JSON.stringify(run)}`);
    assert.equal(run.steps[0].attribution, "native", "the run engine resolved the native id");
    assert.equal(run.steps[0].requiresApproval, true, "gated by what the run recorded (decision C)");
    assert.equal(run.steps[0].toolId, "famili.delete_task");
    assert.deepEqual({ channel: run.sourceRef.channel, actorIsAdult: run.sourceRef.actorIsAdult, actorRole: run.sourceRef.actorRole, agentId: run.sourceRef.agentId },
      { channel: "group", actorIsAdult: false, actorRole: "Limited Member", agentId: "agt_household" });
    assert.ok(await taskExists(tk.id), "the task is untouched");
    const pending = await pendingFor("famili.delete_task");
    assert.equal(pending.length, 1, "one real approval");
    assert.equal(pending[0].id, run.steps[0].approvalId);
    assert.equal(pending[0].requestedBy, "m-maya");
    assert.deepEqual(pending[0].allowedApproverRoles, ["Owner", "Adult Admin", "Adult Member"], "an adult answers it");
    // What the adult reads — the Inbox title is its first line, the push leads with it.
    assert.equal(pending[0].preview, "Delete a task: Take out the trash\nAsked by Maya Harper in the family group thread");
    parked = { runId, taskId: tk.id, approvalId: pending[0].id };
  });

  test("…an Owner approves it (POST /api/approvals/:id/decide): the run completes, as the child, and the task is gone", async () => {
    assert.ok(parked, "the park above ran");
    await decide(parked.approvalId, "approve");
    const run = await settled(parked.runId);
    assert.equal(run?.status, "completed", JSON.stringify(run?.steps?.[0]));
    assert.deepEqual(run.steps[0].result, { deleted: true, title: "Take out the trash" });
    assert.equal(await taskExists(parked.taskId), false, "deleted once an adult said yes");
  });

  test("the turn's RECEIPT is awaiting_approval — and when the model goes quiet, the thread hears it said as a change, not a send", async () => {
    /* A group turn's receipts are not returned to anyone, so they are read back the one way the
     * thread itself can hear them: a model that says nothing after acting gets an answer
     * composed from its receipts ("Waiting for your approval: … — …"), and speakToChat sends
     * that to the thread. It names the awaiting_approval receipt, and says "nothing has changed
     * yet" (not "sent") for a local write. */
    const { readStoreDoc } = await import("./harness.mjs");
    const tk = await makeTask(maya, "Water the tomatoes");
    const told = await groupTurn(KID_NUM, "delete my tomatoes task", [{ toolCalls: [{ name: "famili__delete_task", args: { taskId: tk.id } }] }, { text: "" }]);
    assert.equal(outcome(told)?.status, "awaiting_approval");
    const spoken = JSON.stringify(readStoreDoc(ctx, "sandbox_effects.json", {}));
    assert.ok(spoken.includes("Waiting for your approval: Delete a task or list item — nothing has changed yet."), `the thread heard the receipt: ${spoken.slice(-600)}`);
    const [appr] = await pendingFor("famili.delete_task");
    await decide(appr.id, "deny"); // leave nothing pending for the tests below
    assert.ok(await taskExists(tk.id));
  });

  test("…a DENIAL leaves the task where it was", async () => {
    const tk = await makeTask(maya, "Walk the dog");
    const { runId } = await childParks("famili__delete_task", { taskId: tk.id }, "delete my dog walk task");
    const [appr] = await pendingFor("famili.delete_task");
    assert.ok(appr, "parked");
    await decide(appr.id, "deny");
    const run = await settled(runId);
    assert.equal(run?.status, "failed");
    assert.equal(run.error, "approval_denied");
    assert.equal(run.steps[0].status, "skipped");
    assert.ok(await taskExists(tk.id), "still there");
  });

  test("THE REQUESTER'S ROLE RUNS, NOT THE APPROVER'S: an Owner's yes cannot let a child delete someone else's task", async () => {
    /* The park does not judge ownership — the body does, when it runs — and it runs as the
     * Limited Member who asked. So approving a child's request to delete the Owner's task ends
     * in the body's own refusal, and the task survives. */
    const tk = await makeTask(alex, "Pay the water bill");
    const { runId } = await childParks("famili__delete_task", { taskId: tk.id }, "delete the water bill task");
    const [appr] = await pendingFor("famili.delete_task");
    await decide(appr.id, "approve");
    const run = await settled(runId);
    assert.equal(run?.status, "failed");
    assert.equal(run.error, "forbidden", JSON.stringify(run.steps[0]));
    assert.equal(run.steps[0].detail, "Only an adult or the person who created it can delete this.");
    assert.ok(await taskExists(tk.id), "the Owner's task is untouched");
  });

  test("the same child IN THE APP deletes their own task immediately (decision A) — no approval", async () => {
    const tk = await makeTask(maya, "Put away the laundry");
    fake.state.script.push({ toolCalls: [{ name: "famili__delete_task", args: { taskId: tk.id } }] }, { text: "Done." });
    const r = await maya.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: "delete my laundry task" }) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.toolCalls?.[0]?.tool, "famili.delete_task");
    assert.equal(r.data.toolCalls?.[0]?.status, "done", JSON.stringify(r.data.toolCalls));
    assert.equal(await taskExists(tk.id), false);
    assert.equal((await pendingFor("famili.delete_task")).length, 0, "nothing parked");
  });

  test("an ADULT in the group thread deletes immediately — decision C is about who asks, not where", async () => {
    const tk = await makeTask(alex, "Return the library books");
    const told = await groupTurn(OWNER_NUM, "delete the library task", [{ toolCalls: [{ name: "famili__delete_task", args: { taskId: tk.id } }] }, { text: "Deleted." }]);
    const out = outcome(told);
    assert.equal(out?.ok, true, JSON.stringify(told));
    assert.deepEqual(out.result, { deleted: true, title: "Return the library books" });
    assert.equal(await taskExists(tk.id), false);
    assert.equal((await pendingFor("famili.delete_task")).length, 0);
  });

  test("TWO DENIED GROUP PARKS raise no \"automation keeps not finishing\" alert — not to the child, not to anyone", async () => {
    /* Review finding M2: every group-born run is attributed to the household assistant, so two
     * of a child's requests turned down in a row used to count as a routine that keeps failing,
     * and the child was told to check Agents. They are one-off requests. */
    const alertsFor = async (client) => ((await client.req("/api/notifications")).data.notifications ?? []).filter((x) => x.title === "An automation keeps not finishing");
    for (const title of ["Clean the hamster cage", "Sort the recycling"]) {
      const tk = await makeTask(maya, title);
      const { runId } = await childParks("famili__delete_task", { taskId: tk.id }, `delete my ${title.toLowerCase()} task`);
      const [appr] = await pendingFor("famili.delete_task");
      await decide(appr.id, "deny");
      assert.equal((await settled(runId))?.error, "approval_denied");
    }
    assert.deepEqual(await alertsFor(maya), [], "the child is told nothing of the kind");
    assert.deepEqual(await alertsFor(alex), [], "nor is anyone else");
  });

  test("a child's native READ in the group thread is never parked", async () => {
    const approvalsBefore = ((await alex.req("/api/approvals")).data.approvals ?? []).length;
    const told = await groupTurn(KID_NUM, "what's on the task list", [{ toolCalls: [{ name: "famili__list_tasks", args: {} }] }, { text: "Here's the list." }]);
    const out = outcome(told);
    assert.equal(out?.ok, true, JSON.stringify(told));
    assert.ok(Array.isArray(out.result?.tasks), "the read ran in the turn");
    assert.equal(((await alex.req("/api/approvals")).data.approvals ?? []).length, approvalsBefore, "no approval of any kind");
  });
});
