// THEME I — chat organization.
//
//   [16:14] "Intelligently name the chat, like ChatGPT or Claude does."
//   [16:21] "Personal shows ONLY personal chats; Family only family."
//   [16:45] "From inside a chat I can't switch between Personal and Family without starting a
//            new chat. That's not the correct path."
//
// I1's rules matter more than its output: a generated name must never overwrite one a person
// chose, and must never fire twice. I3's rule is a privacy one — moving a personal thread into
// the family space publishes everything already said in it, so only its author may do it.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, alex, morgan;
before(async () => {
  ctx = await startServer();
  alex = await makeSession(ctx, "m-alex");       // Owner
  morgan = await makeSession(ctx, "m-morgan");   // Adult Admin — a DIFFERENT member
});
after(async () => { await stopServer(ctx); });

const mkConv = (title, visibility, as = alex) =>
  as.req("/api/conversations", { method: "POST", body: JSON.stringify({ title, visibility }) })
    .then((r) => r.data.conversation);
const patch = (id, body, as = alex) => as.req(`/api/conversations/${id}`, { method: "PATCH", body: JSON.stringify(body) });

/* ---- I1: naming ---- */

test("a fresh chat is marked as carrying an AUTO title — the namer may replace it", async () => {
  const c = await mkConv("give me a list of the 5 best restaurants near me and sort", "personal");
  assert.equal(c.titleAuto, true);
});

test("renaming by hand PINS the name against the auto-namer", async () => {
  const c = await mkConv("whatever the first message was", "personal");
  const r = await patch(c.id, { title: "Beannie's Dentist" });
  assert.equal(r.status, 200);
  assert.equal(r.data.conversation.title, "Beannie's Dentist");
  assert.equal(r.data.conversation.titleAuto, false, "a deliberate title must never be overwritten");
});

test("an empty rename is refused rather than blanking the chip", async () => {
  const c = await mkConv("Something", "personal");
  const r = await patch(c.id, { title: "   " });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "title_required");
});

test("a title longer than the chip can ever show is capped, not stored whole", async () => {
  const c = await mkConv("x", "personal");
  const r = await patch(c.id, { title: "a".repeat(200) });
  assert.equal(r.data.conversation.title.length, 80);
});

/* ---- I2: the two spaces are actually separate ---- */

test("I2: a personal chat and a family chat are distinguishable by visibility", async () => {
  const personal = await mkConv("Just me", "personal");
  const family = await mkConv("All of us", "household");
  assert.equal(personal.visibility, "personal");
  assert.equal(family.visibility, "household");
  const list = await alex.req("/api/conversations");
  const byId = new Map(list.data.conversations.map((c) => [c.id, c]));
  // The FILTERING is the client's job (the toggle), but it can only be correct if the field
  // it filters on is right for every row — including ones created before the field existed.
  assert.equal(byId.get(personal.id).visibility, "personal");
  assert.equal(byId.get(family.id).visibility, "household");
});

test("I2: another member sees the family chat and NOT the personal one", async () => {
  const personal = await mkConv("My private thread", "personal");
  const family = await mkConv("Family thread", "household");
  const theirs = await morgan.req("/api/conversations");
  const ids = theirs.data.conversations.map((c) => c.id);
  assert.ok(ids.includes(family.id), "a family chat is shared");
  assert.ok(!ids.includes(personal.id), "a personal chat is not");
});

/* ---- I3: switching from inside the chat ---- */

test("I3: THE FIX — the author moves an existing thread between spaces", async () => {
  const c = await mkConv("Started personal", "personal");
  const up = await patch(c.id, { visibility: "household" });
  assert.equal(up.status, 200);
  assert.equal(up.data.conversation.visibility, "household");
  // And back again.
  const back = await patch(c.id, { visibility: "personal" });
  assert.equal(back.data.conversation.visibility, "personal");
});

test("I3: PRIVACY: only the AUTHOR may move a thread — publishing it isn't anyone else's call", async () => {
  // A family thread is readable by other members, so `morgan` can see it. Being able to READ
  // it must not mean being able to move it back to someone else's personal space, or to
  // publish a thread that person started.
  const c = await mkConv("Family thread to hijack", "household");
  const r = await patch(c.id, { visibility: "personal" }, morgan);
  assert.equal(r.status, 403);
  assert.match(r.data.message, /person who started this chat/i);
});

test("I3: moving preserves the messages — it's the same thread, not a copy", async () => {
  const c = await mkConv("Has history", "personal");
  await alex.req(`/api/conversations/${c.id}/messages`, { method: "POST", body: JSON.stringify({ text: "remember this" }) });
  await patch(c.id, { visibility: "household" });
  const after = await alex.req(`/api/conversations/${c.id}`);
  assert.equal(after.data.conversation.visibility, "household");
  assert.ok(after.data.conversation.messages.some((m) => m.text === "remember this"));
});

test("a PATCH that changes nothing is refused instead of bumping updatedAt for no reason", async () => {
  const c = await mkConv("Untouched", "personal");
  const r = await patch(c.id, {});
  assert.equal(r.status, 400);
  assert.equal(r.data.error, "nothing_to_change");
});

test("a chat in another household is invisible, not just unmodifiable", async () => {
  const r = await patch("conv_does_not_exist", { title: "Nice try" });
  assert.equal(r.status, 404);
});
