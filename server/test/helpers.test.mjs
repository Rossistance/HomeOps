// FamiliOS — Helpers: the whole agent system, tested as one concept.
//
// What this replaced is the reason the tests look like this. A family used to need an
// Agent, a Skill, a Function, a Playbook, an Automation, a Trigger and an Evolution record
// to get a morning briefing, and each of the seven carried its own answer to "who approves
// this?". A helper is a name, instructions in plain English, a schedule and ONE autonomy
// dial — so these tests assert the things a person would actually check: does it exist,
// does it say when it runs, does it run, does it stop and ask when it should, and can the
// wrong person change it.
import test, { before, after, describe } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer, makeSession, readStoreDoc, writeStoreDoc } from "./harness.mjs";
import { hashPin } from "../pin.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A scripted OpenAI-compatible model server: `script` is a queue of turns, each either
 * { toolCalls } or { text }. The memory judge and thread namer fire around a turn and must
 * never eat a scripted one, so they are answered canned. */
function fakeModelServer() {
  const state = { script: [], requests: [], systemPrompts: [] };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.url.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "fake-model" }] }));
        return;
      }
      let parsed = {};
      try { parsed = JSON.parse(body); } catch { /* ignore */ }
      const sys = String(parsed?.messages?.[0]?.content ?? "");
      if (/DURABLE about the household/.test(sys) || /Name this conversation/.test(sys)) {
        const text = /DURABLE/.test(sys) ? JSON.stringify({ remember: false }) : JSON.stringify({ title: "Thread" });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }] }));
        return;
      }
      state.requests.push(parsed);
      state.systemPrompts.push(sys);
      const turn = state.script.shift() ?? { text: "ok" };
      const toolCalls = (turn.toolCalls ?? []).map((tc, i) => ({
        index: i, id: `call_${state.requests.length}_${i}`, type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.args ?? {}) },
      }));
      const finish = toolCalls.length ? "tool_calls" : "stop";
      if (parsed.stream) {
        res.writeHead(200, { "content-type": "text/event-stream" });
        const chunk = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 0, model: "fake-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
        if (toolCalls.length) chunk({ role: "assistant", content: null, tool_calls: toolCalls });
        else for (const piece of String(turn.text ?? "").match(/.{1,12}/g) ?? [""]) chunk({ role: "assistant", content: piece });
        chunk({}, finish);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ index: 0, message: { role: "assistant", content: toolCalls.length ? null : String(turn.text ?? ""), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: finish }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }));
    });
  });
  return { server, state };
}

const dailyAt = (time) => ({ kind: "daily", time });

describe("Helpers", () => {
  let ctx, owner, adult, child, fake;
  /** Promote a seeded member to a role the roster does not ship, then sign in as them. */
  async function sessionAs(actorId, role) {
    const members = readStoreDoc(ctx, "members.json", {});
    writeStoreDoc(ctx, "members.json", { ...members, [actorId]: { ...members[actorId], role } });
    return makeSession(ctx, actorId);
  }

  before(async () => {
    ctx = await startServer();
    owner = await makeSession(ctx, "m-alex");        // Owner
    adult = await makeSession(ctx, "m-morgan");      // Adult Admin
    child = await makeSession(ctx, "m-lily");        // Child View
    fake = fakeModelServer();
    await new Promise((r) => fake.server.listen(0, r));
    const port = fake.server.address().port;
    await owner.req("/api/ai/providers/lmstudio/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "fake-model" }) });
    await owner.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "lmstudio" }) });
  });
  after(async () => { await stopServer(ctx); await new Promise((r) => fake.server.close(r)); });

  /* ------------------------------ what it is ------------------------------ */

  test("a new household has no helpers it did not ask for", async () => {
    /* The old seed installed nine use-case skills, two extra agents and sixteen playbooks
     * on first boot — a library of recipes written months before the tools they named. The
     * only helper now is the household's own assistant, which is the identity chat acts as. */
    const r = await owner.req("/api/helpers");
    assert.equal(r.status, 200);
    const names = r.data.helpers.map((h) => h.name);
    assert.deepEqual(names, ["Famili"], `unexpected seeded helpers: ${names.join(", ")}`);
  });

  test("creating one arms its schedule in the same act", async () => {
    const r = await owner.req("/api/helpers", { method: "POST", body: JSON.stringify({
      name: "Morning Briefing",
      purpose: "One short summary of the day.",
      instructions: "Every morning, summarise today's calendar and anything due, in under 120 words.",
      schedule: dailyAt("07:00"),
      autonomy: "act",
    }) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const h = r.data.helper;
    assert.equal(h.name, "Morning Briefing");
    // Everything a screen needs is already in words: no interval in milliseconds, no
    // "unattended tier" for a family to decode.
    assert.equal(h.scheduleText, "Every day at 7:00 AM");
    assert.equal(h.autonomy, "act");
    assert.equal(h.autonomyText, "Does everyday things on its own, asks before sending or spending");
    assert.equal(h.enabled, true);

    // The schedule is not a second record the family has to keep in step by hand.
    const trig = Object.values(readStoreDoc(ctx, "triggers.json", {})).find((t) => t.helperId === h.id);
    assert.ok(trig, "the helper's own schedule is armed");
    assert.equal(trig.anchor, "07:00");
    assert.equal(trig.target.kind, "helper");
    assert.ok(trig.nextRunAt > Date.now(), "pointed at the next 7 AM, not at creation time + 24h");
  });

  test("a weekly helper lands on the weekday it was given", async () => {
    const r = await owner.req("/api/helpers", { method: "POST", body: JSON.stringify({
      name: "Week Ahead", instructions: "Every Sunday evening, look at the next seven days and write a short heads-up.",
      schedule: { kind: "weekly", time: "17:00", weekday: 0 },
    }) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.helper.scheduleText, "Every Sunday at 5:00 PM");
    const trig = Object.values(readStoreDoc(ctx, "triggers.json", {})).find((t) => t.helperId === r.data.helper.id);
    assert.equal(trig.weekday, 0);
    // Resolved on the calendar date, not by reading getDay() off a UTC instant — which
    // answers for the wrong day either side of midnight.
    assert.equal(new Date(trig.nextRunAt).getDay(), 0, "the next fire really is a Sunday");
    assert.ok(trig.nextRunAt > Date.now());
  });

  test("changing when it runs re-arms it; making it manual disarms it", async () => {
    const made = (await owner.req("/api/helpers", { method: "POST", body: JSON.stringify({
      name: "Bin Night", instructions: "Remind the family which bins go out tonight.", schedule: dailyAt("18:00"),
    }) })).data.helper;
    const armed = () => Object.values(readStoreDoc(ctx, "triggers.json", {})).filter((t) => t.helperId === made.id);
    assert.equal(armed().length, 1);

    const moved = await owner.req(`/api/helpers/${made.id}`, { method: "PATCH", body: JSON.stringify({ schedule: dailyAt("20:30") }) });
    assert.equal(moved.status, 200);
    assert.equal(moved.data.helper.scheduleText, "Every day at 8:30 PM");
    assert.equal(armed()[0].anchor, "20:30", "the same schedule row moved, no duplicate");
    assert.equal(armed().length, 1);

    const manual = await owner.req(`/api/helpers/${made.id}`, { method: "PATCH", body: JSON.stringify({ schedule: { kind: "manual" } }) });
    assert.equal(manual.data.helper.scheduleText, "Only when you ask");
    assert.equal(armed().length, 0, "a manual helper leaves nothing armed behind it");
  });

  test("deleting a helper takes its schedule with it", async () => {
    const made = (await owner.req("/api/helpers", { method: "POST", body: JSON.stringify({
      name: "Temp", instructions: "Do a thing every hour for a while.", schedule: { kind: "hourly" },
    }) })).data.helper;
    assert.equal(Object.values(readStoreDoc(ctx, "triggers.json", {})).filter((t) => t.helperId === made.id).length, 1);
    const del = await owner.req(`/api/helpers/${made.id}`, { method: "DELETE" });
    assert.equal(del.status, 200);
    assert.equal(Object.values(readStoreDoc(ctx, "triggers.json", {})).filter((t) => t.helperId === made.id).length, 0);
    assert.equal((await owner.req(`/api/helpers/${made.id}`)).status, 404);
  });

  test("a helper with no instructions is refused, because there would be nothing to run", async () => {
    const r = await owner.req("/api/helpers", { method: "POST", body: JSON.stringify({ name: "Empty", instructions: "  " }) });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "instructions_required");
  });

  test("the starter templates are instructions a family can read before accepting them", async () => {
    const r = await owner.req("/api/helper-templates");
    assert.equal(r.status, 200);
    const all = r.data.sections.flatMap((s) => s.templates);
    assert.ok(all.length >= 5, "there are real starters");
    for (const t of all) {
      assert.ok(String(t.instructions).length > 80, `${t.name} ships real instructions, not a label`);
      assert.ok(t.scheduleText, `${t.name} says when it would run`);
      assert.ok(t.autonomyText, `${t.name} says what it may do`);
    }
    // A template is a draft, not an install: nothing appeared just from listing them.
    assert.equal((await owner.req("/api/helpers")).data.helpers.some((h) => h.name === "Meal Planner"), false);
  });

  /* ----------------------------- the one dial ----------------------------- */

  test("send-and-spend autonomy needs the household PIN; turning it back down never does", async () => {
    const made = (await owner.req("/api/helpers", { method: "POST", body: JSON.stringify({
      name: "Payer", instructions: "Handle the household bills as they arrive.", autonomy: "act",
    }) })).data.helper;

    // A household with no PIN has no PIN gate anywhere in this product (risk overrides and
    // the old unattended settings behave the same way), so install one the way signup does.
    const settings = readStoreDoc(ctx, "settings.json", {});
    writeStoreDoc(ctx, "settings.json", { ...settings, ownerPinHash: await hashPin("8123") });

    const refused = await owner.req(`/api/helpers/${made.id}`, { method: "PATCH", body: JSON.stringify({ autonomy: "full" }) });
    assert.equal(refused.status, 403);
    assert.match(String(refused.data.error), /pin/);

    const wrong = await owner.req(`/api/helpers/${made.id}`, { method: "PATCH", body: JSON.stringify({ autonomy: "full", pin: "0000" }) });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.data.error, "pin_incorrect");

    const raised = await owner.req(`/api/helpers/${made.id}`, { method: "PATCH", body: JSON.stringify({ autonomy: "full", pin: "8123" }) });
    assert.equal(raised.status, 200, JSON.stringify(raised.data));
    assert.equal(raised.data.helper.autonomy, "full");

    // The PIN is consumed by the check and must not survive onto the record, where every
    // member who can list helpers would be able to read it.
    const stored = readStoreDoc(ctx, "agents.json", {})[made.id];
    assert.equal(stored.pin, undefined);
    assert.equal(JSON.stringify(stored).includes("8123"), false, "the PIN is nowhere on the helper");

    const lowered = await owner.req(`/api/helpers/${made.id}`, { method: "PATCH", body: JSON.stringify({ autonomy: "ask" }) });
    assert.equal(lowered.status, 200, "becoming MORE careful is never gated");
    assert.equal(lowered.data.helper.autonomy, "ask");
  });

  /* ------------------------------ who may act ----------------------------- */

  test("a child cannot make or change helpers", async () => {
    assert.equal(child.role, "Child View");
    const c = await child.req("/api/helpers", { method: "POST", body: JSON.stringify({ name: "Mine", instructions: "Do my chores for me every single day." }) });
    assert.equal(c.status, 403);
    // …but they can see what the family has, which is how they learn what it does.
    assert.equal((await child.req("/api/helpers")).status, 200);
  });

  test("an Adult Member's helper is their own, and the family's is not theirs to edit", async () => {
    const limited = await sessionAs("m-noah", "Adult Member");
    const householdOne = (await owner.req("/api/helpers", { method: "POST", body: JSON.stringify({
      name: "Family Board", instructions: "Keep the shared board tidy every evening.", visibility: "household",
    }) })).data.helper;

    const mine = await limited.req("/api/helpers", { method: "POST", body: JSON.stringify({
      name: "My Inbox", instructions: "Summarise my own inbox for me each morning without telling anyone else.",
    }) });
    assert.equal(mine.status, 200, JSON.stringify(mine.data));
    assert.equal(mine.data.helper.visibility, "personal", "an Adult Member's helper is forced personal");

    const blocked = await limited.req(`/api/helpers/${householdOne.id}`, { method: "PATCH", body: JSON.stringify({ instructions: "Do something else entirely instead." }) });
    assert.equal(blocked.status, 403);
    assert.ok(blocked.data.message, "and the refusal is a sentence, not a code");
  });

  /* -------------------------------- running ------------------------------- */

  test("running one does real work, and its thread is the record of what it did", async () => {
    const made = (await owner.req("/api/helpers", { method: "POST", body: JSON.stringify({
      name: "Chore Chaser", instructions: "Each evening, add a task for anything that still needs doing tomorrow.",
    }) })).data.helper;

    fake.state.systemPrompts = [];
    fake.state.script = [
      { toolCalls: [{ name: "famili__list_events", args: {} }] },
      { toolCalls: [{ name: "homeops__create_task", args: { title: "Pack swimming kit" } }] },
      { text: "Added one task: pack the swimming kit for tomorrow." },
    ];
    const run = await owner.req(`/api/helpers/${made.id}/run`, { method: "POST" });
    assert.equal(run.status, 200, JSON.stringify(run.data));
    assert.equal(run.data.ok, true);
    assert.match(run.data.answer, /swimming kit/);
    assert.ok(run.data.toolCalls.some((c) => c.tool === "homeops.create_task" && c.status === "done"), "the write really happened");

    // The helper's own instructions reach the model as its standing brief — that IS the helper.
    assert.ok(fake.state.systemPrompts.some((p) => p.includes("Each evening, add a task")), "its instructions are the system prompt");
    // And a helper is not handed the tools for editing helpers: that loop goes nowhere good.
    const toolNames = (fake.state.requests.at(-1)?.tools ?? []).map((t) => t.function?.name ?? t.name);
    assert.equal(toolNames.includes("famili__create_helper"), false, "a helper cannot make more helpers");

    const task = (await owner.req("/api/tasks")).data.tasks.find((t) => t.title === "Pack swimming kit");
    assert.ok(task, "the task exists for real");

    const hist = await owner.req(`/api/helpers/${made.id}/history`);
    assert.equal(hist.status, 200);
    const msgs = hist.data.messages;
    assert.ok(msgs.length >= 2, "the run is written down");
    assert.equal(msgs.at(-1).role, "assistant");
    assert.match(msgs.at(-1).text, /swimming kit/);
    assert.ok(msgs.at(-1).toolCalls?.length, "with its receipts");

    const after = (await owner.req(`/api/helpers/${made.id}`)).data.helper;
    assert.equal(after.lastRun.ok, true);
    assert.match(after.lastRun.summary, /Did 2 things/, "the list view can say what happened without opening the thread");
  });

  test("a paused helper does not run, and says so rather than failing silently", async () => {
    const made = (await owner.req("/api/helpers", { method: "POST", body: JSON.stringify({
      name: "Dormant", instructions: "Something that should not happen while this is paused.", schedule: dailyAt("06:00"),
    }) })).data.helper;
    await owner.req(`/api/helpers/${made.id}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
    const r = await owner.req(`/api/helpers/${made.id}/run`, { method: "POST" });
    assert.equal(r.status, 422);
    assert.equal(r.data.error, "helper_paused");
    assert.match(r.data.message, /paused/);
    assert.equal(Object.values(readStoreDoc(ctx, "triggers.json", {})).filter((t) => t.helperId === made.id).length, 0,
      "and pausing it disarms the schedule rather than leaving it to fire into nothing");
  });

  test("when its schedule comes due the tick runs it, and the outcome is recorded straight away", async () => {
    const made = (await owner.req("/api/helpers", { method: "POST", body: JSON.stringify({
      name: "Dawn Patrol", instructions: "At dawn, note what the day holds.", schedule: dailyAt("05:00"), autonomy: "act",
    }) })).data.helper;
    const triggers = readStoreDoc(ctx, "triggers.json", {});
    const id = Object.keys(triggers).find((k) => triggers[k].helperId === made.id);
    assert.ok(id, "the helper armed a schedule");

    fake.state.script = [
      { toolCalls: [{ name: "famili__list_events", args: {} }] },
      { text: "Quiet day — nothing on the calendar." },
    ];
    const fired = await owner.req(`/api/triggers/${id}/fire`, { method: "POST" });
    assert.equal(fired.status, 200, JSON.stringify(fired.data));

    const after = (await owner.req(`/api/helpers/${made.id}`)).data.helper;
    assert.ok(after.lastRun, "the scheduled fire really ran the helper");
    assert.equal(after.lastRun.ok, true);

    /* A helper run finishes inside the fire, so the schedule's status is the real outcome
     * immediately. The old plan runs recorded "started" and needed a second mechanism to
     * come back and correct it — which is why the Automations list sat on a permanent
     * "started" for routines that had long since finished. */
    const t = readStoreDoc(ctx, "triggers.json", {})[id];
    assert.equal(t.lastStatus, "completed");
    assert.equal(t.lastSummary, after.lastRun.summary, "and the schedule row says the same thing the helper does");

    const hist = (await owner.req(`/api/helpers/${made.id}/history`)).data.messages;
    assert.match(hist.at(-2).text, /Scheduled run/, "the thread says why it ran");
    assert.match(hist.at(-1).text, /Quiet day/);
  });

  test("a personal helper's scheduled run acts as its owner, not as the household", async () => {
    /* Approvals from a private helper must reach one person, not fan out to everyone with an
     * approver role — the same isolation a personal chat already promises. */
    const limited = await sessionAs("m-sam", "Adult Member");
    const made = (await limited.req("/api/helpers", { method: "POST", body: JSON.stringify({
      name: "Private Notes", instructions: "Summarise my own week, for me only, and tell nobody else.", schedule: dailyAt("21:00"),
    }) })).data.helper;
    assert.equal(made.visibility, "personal");
    const stored = readStoreDoc(ctx, "agents.json", {})[made.id];
    assert.equal(stored.visibility, "personal");
    assert.equal(stored.createdBy, "m-sam");

    // Another member cannot even see it.
    const others = (await child.req("/api/helpers")).data.helpers.map((h) => h.id);
    assert.equal(others.includes(made.id), false, "a personal helper is invisible to the rest of the family");
  });

  test("a caller cannot choose a helper's id, so it cannot move into someone else's consent", async () => {
    /* A helper's standing permission to message a person is granted per helper ID, on the
     * contact method. While `body.id` was honoured, naming a free id was a way to inherit a
     * grant made to a different helper — including one a family had just deleted in order to
     * revoke it. Two independent closures: deleting purges the grants, and an id can no
     * longer be asked for. */
    const asked = "agt_squatted_identity";
    const r = await owner.req("/api/helpers", { method: "POST", body: JSON.stringify({
      id: asked, name: "Squatter", instructions: "Try to occupy an identity that was granted to something else.",
    }) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.notEqual(r.data.helper.id, asked, "the server names it, not the caller");
    assert.match(r.data.helper.id, /^agt_[0-9a-f]{20}$/);
    assert.equal(readStoreDoc(ctx, "agents.json", {})[asked], undefined, "and nothing lands at the asked-for id");
  });

  test("a downgrade is only reported when something was actually asked for and refused", async () => {
    /* `autonomyDowngraded` drives an apology in the UI. Deriving it from "the grant has no
     * setByRole" made it fire for an ordinary `act` grant by an Adult Member — who never
     * asked for the top tier and lost nothing. What was REQUESTED is recorded alongside what
     * was granted, so the two cases can be told apart. */
    const limited = await sessionAs("m-elaine", "Adult Member");
    const ordinaryRes = await limited.req("/api/helpers", { method: "POST", body: JSON.stringify({
      name: "Modest", instructions: "Tidy my own list each morning and tell me what changed.", autonomy: "act",
    }) });
    assert.equal(ordinaryRes.status, 200, JSON.stringify(ordinaryRes.data));
    const ordinary = ordinaryRes.data.helper;
    assert.equal(ordinary.autonomy, "act");
    assert.equal(ordinary.autonomyDowngraded, false, "nothing was refused, so nothing is apologised for");

    /* The PIN authorises the REQUEST; the role decides the TIER. Passing the right PIN here
     * isolates the second gate: this member is allowed to ask, and still cannot be granted
     * send-and-spend, because policy.mjs only honours that tier for an Owner or Adult Admin. */
    const settings = readStoreDoc(ctx, "settings.json", {});
    writeStoreDoc(ctx, "settings.json", { ...settings, ownerPinHash: await hashPin("5150") });
    const res = await limited.req("/api/helpers", { method: "POST", body: JSON.stringify({
      name: "Ambitious", instructions: "Send whatever needs sending, to anyone, without checking.",
      autonomy: "full", pin: "5150",
    }) });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    const overreaching = res.data.helper;
    assert.equal(overreaching.autonomy, "act", "the tier they could not grant is not granted");
    assert.equal(overreaching.autonomyDowngraded, true, "and the screen can say so");
  });

  test("an edit that doesn't mention permission doesn't quietly change it", async () => {
    /* Autonomy used to be re-derived on every write. Renaming a helper would therefore
     * re-stamp who granted its permission — and, when the person editing lacked the standing
     * to have granted the top tier, silently drop it to the one below. A quiet downgrade
     * nobody asked for and nobody would see is the same class of bug as a quiet upgrade. */
    const settings = readStoreDoc(ctx, "settings.json", {});
    writeStoreDoc(ctx, "settings.json", { ...settings, ownerPinHash: await hashPin("4242") });
    const made = (await owner.req("/api/helpers", { method: "POST", body: JSON.stringify({
      name: "Courier", instructions: "Send the weekly summary to the family on Friday evenings.",
      autonomy: "full", pin: "4242",
    }) })).data.helper;
    assert.equal(made.autonomy, "full");
    const grantedBy = readStoreDoc(ctx, "agents.json", {})[made.id].approvalPolicy.unattended.setBy;

    const renamed = await owner.req(`/api/helpers/${made.id}`, { method: "PATCH", body: JSON.stringify({ name: "Weekly Courier" }) });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.data.helper.name, "Weekly Courier");
    assert.equal(renamed.data.helper.autonomy, "full", "renaming it did not change what it may do");
    assert.equal(readStoreDoc(ctx, "agents.json", {})[made.id].approvalPolicy.unattended.setBy, grantedBy,
      "and the grant is still attributed to whoever actually made it");
  });
});
