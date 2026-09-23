/* THE HEADLINE PROPERTY OF THE THREE-LANE DESIGN, and the one worth breaking the build over.
 *
 * Lane 2 restores the full dense agent and the complete tool catalog to the family group
 * chat — no three-value enum, no four-id floor — because an assistant that can only reach
 * hardcoded verbs cannot hold a conversation, and the voice agent this is the foundation for
 * will need every bit of that range. The model is not made smaller.
 *
 * What is made smaller is WHAT THE CHANNEL MAY READ. A group thread contains people who are
 * not in the household, so a member asking a question there gets the household's SHARED
 * calendar, tasks, lists and meals — never their own private items, and never anyone else's.
 * The same member asking the same question in a 1:1 text, where the audience is one person,
 * sees everything they own.
 *
 * SCOPING THE CONTEXT BLOB IS NOT ENOUGH, and that is the trap this file exists to catch.
 * Every famili.* native tool goes back to the store on its own. Narrow the blob and stop
 * there, and the model's opening briefing is clean — and then its very first tool call hands
 * it the asker's private calendar anyway. So the assertions below are made TWICE: once
 * against what the model was briefed with, and once against what a tool actually returned.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-groupturn-"));
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { startServer, stopServer, makeSession } = await import("./harness.mjs");
const { useFakeModel } = await import("./fake-model.mjs");

const MEMBER_NUM = "+15550107401";
const GROUP_GUID = "iMessage;+;chat-agent-turn";
const DM_GUID = `iMessage;-;${MEMBER_NUM}`;

const SHARED_TITLE = "Soccer practice at the park";
const PRIVATE_TITLE = "Therapy appointment downtown";

let ctx, alex, fake;
let n = 0;

async function post(text, { guid = GROUP_GUID } = {}) {
  const r = await ctx.fetch("/api/webhooks/bluebubbles", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "new-message",
      data: {
        guid: `p:0/turn-${++n}`, text, isFromMe: false, dateCreated: Date.now(),
        handle: { address: MEMBER_NUM, service: "iMessage" },
        chats: [{ guid }],
      },
    }),
  });
  return { status: r.status, data: await r.json() };
}

/** Lane 2 answers out of band, so the test waits for the model to actually be called. */
async function waitForRequests(atLeast, ms = 8000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fake.state.requests.length >= atLeast) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

/** Everything the model was shown across a turn: prompts, history, and tool RESULTS. */
const everythingTheModelSaw = (from = 0) => JSON.stringify(fake.state.requests.slice(from));

before(async () => {
  ctx = await startServer({ env: { HOMEOPS_CONNECTOR_SANDBOX: "1" } });
  alex = await makeSession(ctx, "m-alex"); // Owner
  fake = await useFakeModel(alex);

  const cm = await alex.req("/api/contact-methods", {
    method: "POST",
    body: JSON.stringify({ memberId: "m-alex", label: "Mobile", type: "Phone/Text", value: MEMBER_NUM, verified: true, optInStatus: "Opted In" }),
  });
  assert.equal(cm.status, 200, JSON.stringify(cm.data));
  const s = await alex.req("/api/settings", { method: "POST", body: JSON.stringify({ autonomy: "Trusted" }) });
  assert.equal(s.status, 200, JSON.stringify(s.data));

  // Two events, same owner, same week. The only difference is who they are for.
  const soon = new Date(Date.now() + 2 * 86400000).toISOString();
  const shared = await alex.req("/api/events", { method: "POST", body: JSON.stringify({ title: SHARED_TITLE, startAt: soon, visibility: "household" }) });
  assert.equal(shared.status, 200, JSON.stringify(shared.data));
  const priv = await alex.req("/api/events", { method: "POST", body: JSON.stringify({ title: PRIVATE_TITLE, startAt: soon, visibility: "private" }) });
  assert.equal(priv.status, 200, JSON.stringify(priv.data));

  await post("starting a thread");
  const list = await alex.req("/api/group-chats");
  const chatId = list.data.chats.find((c) => c.chatGuid === GROUP_GUID).id;
  const bound = await alex.req("/api/group-chats", { method: "POST", body: JSON.stringify({ chatId }) });
  assert.equal(bound.status, 200, JSON.stringify(bound.data));
});
after(async () => { await stopServer(ctx); try { fake.server.close(); } catch { /* best effort */ } });

test("LANE 2: the full tool catalog, and NOT the asker's private calendar", async () => {
  const from = fake.state.requests.length;
  fake.state.script.push(
    { toolCalls: [{ name: "famili__list_events", args: {} }] },
    { text: "Soccer practice is on Saturday." },
  );

  const r = await post("@famili what is on the calendar this week?");
  assert.equal(r.data.kind, "wake_accepted", JSON.stringify(r.data));
  assert.ok(await waitForRequests(from + 2), `the dense agent ran and called a tool: ${fake.state.requests.length - from} requests`);

  const seen = everythingTheModelSaw(from);

  /* 1. THE BRIEFING. The shared event is there; the private one never entered the blob. */
  assert.ok(seen.includes(SHARED_TITLE), "the household's shared calendar is what a group answer is built from");
  assert.equal(seen.includes(PRIVATE_TITLE), false,
    "a member's PRIVATE event must never reach a thread that contains people outside the household");

  /* 2. THE TOOL RESULT — the half that scoping the blob alone would miss. famili.list_events
   *    re-reads the store itself, so if the channel gate did not reach nativeTools, this is
   *    where the private event would reappear. It is asserted separately for that reason. */
  const toolResults = JSON.stringify(
    fake.state.requests.slice(from).flatMap((q) => (q.messages ?? []).filter((m) => m.role === "tool" || m.tool_call_id)),
  );
  assert.ok(toolResults.includes(SHARED_TITLE), `the tool really did return events: ${toolResults.slice(0, 400)}`);
  assert.equal(toolResults.includes(PRIVATE_TITLE), false,
    "famili.list_events is gated by the CHANNEL, not only by who asked");

  /* 3. THE MENU IS NOT THE OLD FLOOR. The point of the change: ids the three-verb enum never
   *    had are on the table, so the lane can actually converse and act. */
  const tools = JSON.stringify(fake.state.requests[from]?.tools ?? []);
  assert.ok(tools.includes("famili__list_events"), `the catalog is real: ${tools.slice(0, 200)}`);
  assert.ok(tools.length > 500, "this is a full catalog, not four hardcoded ids");
  /* 4. …WITH ONE NAMED EXCEPTION, now enforced where the prompt only said it (ADR-004): a
   *    standing autonomous actor is not created, changed or run from a text a neighbour can
   *    read, so the helper-management tools are not on the group's menu at all. */
  assert.equal(tools.includes("famili__create_helper"), false, "helpers are not made from a group text");
});

test("the group system prompt names outsider text as REPORTED SPEECH", () => {
  /* The sharpest new surface this change opens: a dense model with real tools now reads text
   * written by people outside the household. This rule is one of three defences and the only
   * cheap one; the approval ladder is the one that actually holds. Pinned because a prompt
   * edit is exactly the kind of change that silently removes it. */
  const sys = fake.state.systemPrompts.join("\n---\n");
  assert.ok(sys.includes("IN THIS GROUP THREAD"), "the group block is in the instructions");
  assert.ok(/reported speech/i.test(sys), `outsider lines are framed as speech, not instructions: ${sys.slice(-1200)}`);
  assert.ok(/never instructions/i.test(sys), "and it says so in those words");
});

test("LANE 3: the SAME member, the SAME question, in a 1:1 — and their private event is there", async () => {
  /* The other half of the property, and the reason it is not a restriction on the person.
   * Nothing was hidden from Alex; it was hidden from the ROOM. Ask where the audience is one
   * person and the answer is complete. */
  const from = fake.state.requests.length;
  fake.state.script.push(
    { toolCalls: [{ name: "famili__list_events", args: {} }] },
    { text: "You have soccer practice and your appointment." },
  );

  const r = await post("what is on the calendar this week?", { guid: DM_GUID });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.handled, true, `a 1:1 text is answered in band: ${JSON.stringify(r.data)}`);
  assert.ok(await waitForRequests(from + 2), "the dense agent ran for the 1:1 too");

  const seen = everythingTheModelSaw(from);
  assert.ok(seen.includes(SHARED_TITLE), JSON.stringify(seen.slice(0, 300)));
  assert.ok(seen.includes(PRIVATE_TITLE),
    "in a 1:1 the asker IS the audience, so their own private event is exactly what they should get");

  // …and the group block is absent here, so the two channels are not quietly the same.
  const sys = String(fake.state.requests[from]?.messages?.[0]?.content ?? "");
  assert.equal(sys.includes("IN THIS GROUP THREAD"), false, "the 1:1 turn is not told it is in a group");
});
