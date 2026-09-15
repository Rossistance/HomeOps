// The "informed inward" half of the Adult Member silo.
//
// "Their chat specifically will be siloed and isolated from the rest of the household,
//  however they will be able to pick up on context on things that are happening in the
//  entire household, and the family chats, but not be able to edit those capabilities."
//
// So the silo is about AUTHORSHIP, not ignorance. Two things have to hold at once:
//   - a personal thread is never read as context by anyone, including its own author's
//     other threads (that's the isolation), and
//   - the household's SHARED chats are, for everyone (that's the context).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-famctx-"));
const { buildServerContext } = await import("../context.mjs");
const { putConversation, putAgent, runWithTenant } = await import("../store.mjs");

const HH = "local";
const T = (fn) => runWithTenant(HH, fn);
const ross = { householdId: HH, actorId: "m-ross", role: "Owner" };
const mel = { householdId: HH, actorId: "m-mel", role: "Adult Member" };

after(() => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {} });

let n = 0;
const conv = (over) => T(async () => putConversation({
  id: `conv_${++n}`, householdId: HH, actorId: "m-ross", title: "Untitled",
  visibility: "personal", messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  ...over,
}));

const FAMILY = {
  visibility: "household", title: "Saturday plan",
  messages: [
    { role: "user", text: "Are we still doing the lake on Saturday?", at: new Date().toISOString() },
    { role: "assistant", text: "Yes — leaving at 9, GPop is driving.", at: new Date().toISOString() },
  ],
};

test("a FAMILY chat is context for everyone, including a plain Adult Member", async () => {
  await conv(FAMILY);
  const ctx = await T(() => buildServerContext(mel));
  assert.ok(ctx.familyChats?.length, "the assistant should know what the family has been discussing");
  assert.equal(ctx.familyChats[0].title, "Saturday plan");
  assert.ok(ctx.familyChats[0].recent.some((l) => /GPop is driving/.test(l)));
});

test("THE ISOLATION: a personal chat is never context — not even the caller's own", async () => {
  await conv({ actorId: "m-mel", visibility: "personal", title: "Melissa's private thread",
    messages: [{ role: "user", text: "a secret about a surprise party", at: new Date().toISOString() }] });
  const mine = await T(() => buildServerContext(mel));
  const theirs = await T(() => buildServerContext(ross));
  const all = JSON.stringify([mine.familyChats ?? [], theirs.familyChats ?? []]);
  assert.ok(!/surprise party/.test(all), "a personal thread must not leak, in either direction");
  assert.ok(!/Melissa's private thread/.test(all));
});

test("an empty family chat isn't offered as context — a title with nothing under it is noise", async () => {
  await conv({ visibility: "household", title: "Started and abandoned", messages: [] });
  const ctx = await T(() => buildServerContext(ross));
  assert.ok(!(ctx.familyChats ?? []).some((c) => c.title === "Started and abandoned"));
});

test("the household's data is all still visible to an Adult Member", async () => {
  const ctx = await T(() => buildServerContext(mel));
  // The silo restricts what they can WRITE. An assistant that can't see the family calendar
  // is useless to the person asking about it.
  for (const key of ["members", "upcomingEvents", "openTasks", "upcomingMeals", "householdSize"]) {
    assert.ok(key in ctx, `an Adult Member's assistant must still see ${key}`);
  }
});

/* One list, not three: the model used to be handed existingAgents AND existingSkills AND
 * existingAutomations. The privacy rule survives the collapse into `existingHelpers`
 * unchanged, and matters MORE now — an Adult Member's helpers are personal by default. */
test("PRIVACY: another member's PERSONAL helper is not named in your context", async () => {
  await T(async () => {
    putAgent({ id: "agt_rossonly", householdId: HH, name: "Ross's private helper", visibility: "personal", createdBy: "m-ross", status: "Active", createdAt: Date.now(), updatedAt: new Date().toISOString() });
    putAgent({ id: "agt_shared", householdId: HH, name: "Family briefing", visibility: "household", createdBy: "m-ross", status: "Active", createdAt: Date.now(), updatedAt: new Date().toISOString() });
  });
  const ctx = await T(() => buildServerContext(mel));
  const names = (ctx.existingHelpers ?? []).map((a) => a.name);
  assert.ok(names.includes("Family briefing"), "shared helpers are everyone's business");
  assert.ok(!names.includes("Ross's private helper"),
    "a personal helper belongs to whoever made it — the assistant should not name it to anyone else");
});

test("…and your own personal helper IS in your context", async () => {
  await T(() => putAgent({ id: "agt_melonly", householdId: HH, name: "Melissa's helper", visibility: "personal", createdBy: "m-mel", status: "Active", createdAt: Date.now(), updatedAt: new Date().toISOString() }));
  const ctx = await T(() => buildServerContext(mel));
  assert.ok((ctx.existingHelpers ?? []).some((a) => a.name === "Melissa's helper"));
});
