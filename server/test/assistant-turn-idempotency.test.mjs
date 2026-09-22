/* ONE CHAT TURN RUNS AT MOST ONCE, however many times its request arrives.
 *
 * Production, 2026-09-22 05:04–05:07Z. The phone streamed "yes, make these four changes
 * and set a test reminder": the stream finished a five-tool turn (four helper updates,
 * one task). The same message arrived again three minutes later; that stream failed in
 * 3s with 458 bytes, the client fell back to the non-streaming route exactly as designed,
 * and the server ran all five tools a second time. Two test tasks, four helpers flipped
 * twice, and a family reading two "Done" answers for one request.
 *
 * runAssistantAgent's own retry guards were not wrong — they only ever see one request.
 * The fix sits one level up: a client NAMES its turn, and a named turn executes once.
 * These tests drive the real routes through the harness with a scripted model, and the
 * thing they assert is always the same: how many tasks exist afterwards.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-turn-idem-"));
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { startServer, stopServer, makeSession } = await import("./harness.mjs");
const { useFakeModel, streamFrames } = await import("./fake-model.mjs");
const { turnClaimState, ASSISTANT_TURN_LEASE_MS } = await import("../store.mjs");

let ctx, adult, fake;
before(async () => {
  // A local provider gets a relevance-pruned catalog; the budget is raised so the create
  // tool is always on the menu regardless of how the ranker scores a short message.
  ctx = await startServer({ env: { HOMEOPS_PLANNER_CATALOG_BUDGET: "400" } });
  adult = await makeSession(ctx, "m-morgan");
  fake = await useFakeModel(adult);
});
after(async () => { await stopServer(ctx); try { fake.server.close(); } catch { /* best effort */ } });

/** A turn that WRITES: the model creates a task, then answers. */
function scriptCreateTask(title, first = {}) {
  fake.state.script.push({ toolCalls: [{ name: "homeops__create_task", args: { title } }], ...first });
  fake.state.script.push({ text: `Added ${title}.` });
}
const tasksTitled = async (title) => ((await adult.req("/api/tasks")).data.tasks ?? []).filter((t) => t.title === title);
const newConv = async () => (await adult.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Idempotency" }) })).data.conversation.id;
const ask = (message, extra = {}) => adult.req("/api/assistant", { method: "POST", body: JSON.stringify({ message, ...extra }) });

test("THE SAME NAMED TURN, TWICE, EXECUTES ONCE — and the second caller gets the first answer", async () => {
  const convId = await newConv();
  scriptCreateTask("Buy milk");
  const before = fake.state.requests.length;

  const a = await ask("Add a task: buy milk", { conversationId: convId, clientTurnId: "turn-1" });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.ok, true, JSON.stringify(a.data));
  assert.equal((await tasksTitled("Buy milk")).length, 1, "the first arrival really created the task");
  const modelCalls = fake.state.requests.length - before;
  assert.ok(modelCalls >= 2, `the turn ran through the model (${modelCalls} calls)`);

  const b = await ask("Add a task: buy milk", { conversationId: convId, clientTurnId: "turn-1" });
  assert.equal(b.status, 200, JSON.stringify(b.data));
  assert.equal(b.data.replayed, true, "the second arrival is a replay, and says so");
  assert.equal(b.data.answer, a.data.answer, "…of the FIRST answer, verbatim");
  assert.equal((await tasksTitled("Buy milk")).length, 1, "THE ASSERTION: nothing was created a second time");
  assert.equal(fake.state.requests.length - before, modelCalls, "the model was not consulted again");
  const conv = (await adult.req(`/api/conversations/${convId}`)).data.conversation;
  assert.equal(conv.messages.length, 2, "the thread holds one exchange, not two");
});

test("STREAM, THEN THE NON-STREAM FALLBACK, same id — the production shape — is one execution", async () => {
  const convId = await newConv();
  scriptCreateTask("Book the dentist");
  const frames = await streamFrames(adult, "Add a task: book the dentist", { conversationId: convId, clientTurnId: "turn-2" });
  const done = frames.find((f) => f.type === "done");
  assert.ok(done?.result?.ok, `the stream finished the turn: ${JSON.stringify(done)}`);
  assert.equal((await tasksTitled("Book the dentist")).length, 1);

  // What the phone does on ANY stream failure: re-send to POST /api/assistant.
  const fb = await ask("Add a task: book the dentist", { conversationId: convId, clientTurnId: "turn-2" });
  assert.equal(fb.status, 200, JSON.stringify(fb.data));
  assert.equal(fb.data.replayed, true);
  assert.equal((await tasksTitled("Book the dentist")).length, 1, "the fallback did not run the tools again");
});

test("a second STREAM with the same id is answered as a one-frame stream, not re-run", async () => {
  const convId = await newConv();
  scriptCreateTask("Renew the passports");
  await streamFrames(adult, "Add a task: renew the passports", { conversationId: convId, clientTurnId: "turn-2b" });
  const again = await streamFrames(adult, "Add a task: renew the passports", { conversationId: convId, clientTurnId: "turn-2b" });
  const done = again.find((f) => f.type === "done");
  assert.equal(done?.result?.replayed, true, JSON.stringify(again));
  assert.equal((await tasksTitled("Renew the passports")).length, 1);
});

test("a DIFFERENT id with the same words is a new turn — the guard is the id, not the text", async () => {
  const convId = await newConv();
  scriptCreateTask("Water the plants");
  scriptCreateTask("Water the plants");
  await ask("Add a task: water the plants", { conversationId: convId, clientTurnId: "turn-3a" });
  await ask("Add a task: water the plants", { conversationId: convId, clientTurnId: "turn-3b" });
  assert.equal((await tasksTitled("Water the plants")).length, 2, "asking twice on purpose still asks twice");
});

test("a twin arriving MID-TURN is refused, not queued behind it — and is answered once the turn exists", async () => {
  const convId = await newConv();
  scriptCreateTask("Call the vet", { delayMs: 1500 });
  const first = ask("Add a task: call the vet", { conversationId: convId, clientTurnId: "turn-4" });
  await new Promise((r) => setTimeout(r, 400));
  const twin = await ask("Add a task: call the vet", { conversationId: convId, clientTurnId: "turn-4" });
  assert.equal(twin.status, 409, JSON.stringify(twin.data));
  assert.equal(twin.data.error, "turn_in_progress");
  const a = await first;
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal((await tasksTitled("Call the vet")).length, 1);
  const later = await ask("Add a task: call the vet", { conversationId: convId, clientTurnId: "turn-4" });
  assert.equal(later.data.replayed, true, "once finished, the same id replays");
  assert.equal((await tasksTitled("Call the vet")).length, 1);
});

test("the streaming route refuses a mid-turn twin as JSON, which is what sends the phone to the fallback", async () => {
  const convId = await newConv();
  scriptCreateTask("Fix the gate", { delayMs: 1500 });
  const first = streamFrames(adult, "Add a task: fix the gate", { conversationId: convId, clientTurnId: "turn-5" });
  await new Promise((r) => setTimeout(r, 400));
  const twin = await adult.req("/api/assistant/stream", { method: "POST", body: JSON.stringify({ message: "Add a task: fix the gate", conversationId: convId, clientTurnId: "turn-5" }) });
  assert.equal(twin.status, 409, JSON.stringify(twin.data));
  assert.equal(twin.data.error, "turn_in_progress", "a plain JSON refusal — not an event stream");
  await first;
  assert.equal((await tasksTitled("Fix the gate")).length, 1);
});

test("an UNNAMED turn behaves exactly as before — the protection is something a client asks for", async () => {
  const convId = await newConv();
  scriptCreateTask("Unnamed");
  scriptCreateTask("Unnamed");
  await ask("Add a task: unnamed", { conversationId: convId });
  await ask("Add a task: unnamed", { conversationId: convId });
  assert.equal((await tasksTitled("Unnamed")).length, 2);
});

test("THE LEASE: a claim left behind by a restart mid-turn does not refuse that message forever", () => {
  const now = 1_000_000_000;
  assert.equal(turnClaimState(null, now), "free");
  assert.equal(turnClaimState({ status: "done", at: now - 1 }, now), "done");
  assert.equal(turnClaimState({ status: "running", at: now - 1000 }, now), "running");
  assert.equal(turnClaimState({ status: "running", at: now - ASSISTANT_TURN_LEASE_MS - 1 }, now), "free",
    "a running claim older than the lease belongs to a dead process, not a busy one");
  assert.equal(turnClaimState({ status: "failed", at: now - 1 }, now), "free", "a turn that threw may be tried again");
});
