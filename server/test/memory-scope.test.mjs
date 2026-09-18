// A MEMORY ABOUT ONE PERSON IS THAT PERSON'S — even when it was said in the family room.
// The capture judge now answers who a memory is about and whether it is sensitive; a
// personal or sensitive fact from a household chat is stored as personal (author only) and
// the author is told it was kept. A household fact from the same room stays household.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";
import { useFakeModel } from "./fake-model.mjs";

let ctx, alex, morgan, fake;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
before(async () => {
  ctx = await startServer();
  alex = await makeSession(ctx, "m-alex");
  morgan = await makeSession(ctx, "m-morgan");
  fake = await useFakeModel(alex);
});
after(async () => { await stopServer(ctx); fake.server.close(); });

async function askInHouseholdChat(text) {
  const c = await alex.req("/api/conversations", { method: "POST", body: JSON.stringify({ title: "Family", visibility: "household" }) });
  fake.state.script = [{ text: "Noted." }];
  const r = await alex.req("/api/assistant", { method: "POST", body: JSON.stringify({ message: text, conversationId: c.data.conversation.id }) });
  assert.equal(r.status, 200, JSON.stringify(r.data));
}
async function memoryWith(who, needle) {
  for (let i = 0; i < 40; i++) {
    const mem = (await who.req("/api/memory")).data.memory;
    const hit = mem.find((m) => String(m.text).includes(needle));
    if (hit) return hit;
    await sleep(100);
  }
  return null;
}

test("a sensitive fact said in the family chat is kept for its author alone, and they are told", async () => {
  fake.state.memoryJudge = { remember: true, type: "fact", text: "Alex takes a Repatha injection on Sundays.", about: "person", sensitive: true };
  await askInHouseholdChat("Remind me my Repatha injection is on Sundays, it's important I don't skip it.");
  const mine = await memoryWith(alex, "Repatha");
  assert.ok(mine, "the author can see it");
  assert.equal(mine.scope, "personal");
  assert.equal(mine.sensitive, true);
  await sleep(200);
  assert.equal(await memoryWith(morgan, "Repatha"), null, "another adult in the household cannot");
  const notes = (await alex.req("/api/notifications")).data.notifications;
  const told = notes.find((n) => n.data?.type === "memory" && n.data?.id === mine.id);
  assert.ok(told, "the author is notified");
  assert.match(told.body, /Kept for you only/);
});

test("a household fact said in the family chat stays household", async () => {
  fake.state.memoryJudge = { remember: true, type: "fact", text: "The house has a Nest thermostat.", about: "household", sensitive: false };
  await askInHouseholdChat("What's the temperature on our Nest thermostat right now?");
  const mine = await memoryWith(alex, "Nest thermostat");
  assert.ok(mine);
  assert.equal(mine.scope, "household");
  assert.ok(await memoryWith(morgan, "Nest thermostat"), "everyone sees a household fact");
  const notes = (await alex.req("/api/notifications")).data.notifications;
  assert.ok(!notes.some((n) => n.data?.type === "memory" && n.data?.id === mine.id), "no notification for an ordinary household fact");
});
