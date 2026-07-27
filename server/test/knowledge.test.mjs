// KNOWLEDGE — user-authored household knowledge (custom instructions, family facts,
// preferences, rules, reference notes). Real CRUD, role + visibility gated, tenant-scoped.
// Mirrors meals.test.mjs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, adult, owner, child, limited;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin
  owner = await makeSession(ctx, "m-alex");    // Owner (also an adult role)
  child = await makeSession(ctx, "m-noah");    // Child View — below Limited Member
  // A real Limited Member to exercise creator-vs-adult edit gating.
  const created = await adult.req("/api/members", { method: "POST", body: JSON.stringify({ displayName: "Robin", role: "Limited Member" }) });
  limited = await makeSession(ctx, created.data.member.actorId);
});
after(async () => { await stopServer(ctx); });

test("a child (below Limited Member) cannot create knowledge", async () => {
  const r = await child.req("/api/knowledge", { method: "POST", body: JSON.stringify({ title: "Nope" }) });
  assert.equal(r.status, 403);
});

test("create → list → patch → delete round-trips a household item", async () => {
  const created = await adult.req("/api/knowledge", { method: "POST", body: JSON.stringify({ title: "WiFi network", type: "Family Fact", content: "Harper-5G", tags: ["home", "wifi"], fileIds: ["file_abc"] }) });
  assert.equal(created.status, 200);
  const item = created.data.item;
  assert.equal(item.title, "WiFi network");
  assert.equal(item.type, "Family Fact");
  assert.equal(item.visibility, "household");
  assert.equal(item.sensitive, false);
  assert.deepEqual(item.tags, ["home", "wifi"]);
  assert.deepEqual(item.fileIds, ["file_abc"]);
  assert.equal(item.createdBy, "m-morgan");

  // Household visibility — a child sees the item in the list.
  const childList = (await child.req("/api/knowledge")).data.items;
  assert.ok(childList.some((k) => k.id === item.id), "child sees the household knowledge item");

  // Patch a couple of fields; untouched fields persist.
  const patched = await adult.req(`/api/knowledge/${item.id}`, { method: "PATCH", body: JSON.stringify({ content: "Harper-5G-new", sensitive: true }) });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.item.content, "Harper-5G-new");
  assert.equal(patched.data.item.sensitive, true);
  assert.equal(patched.data.item.title, "WiFi network", "unedited fields persist");

  const del = await adult.req(`/api/knowledge/${item.id}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  const after = (await adult.req("/api/knowledge")).data.items;
  assert.ok(!after.some((k) => k.id === item.id), "gone after delete");
});

/* CHANGED DELIBERATELY. This test used to assert "creator + ANY ADULT", which is what the old
 * inline filter did — behind a chip labelled "Just me" and a badge with a padlock on it.
 *
 * "It needs to read just me, my nest, then everyone. The actual logic of who sees what needs
 *  to extend throughout the app."
 *
 * Just me now means just me. The scope is stored as `private` (the old `personal` is kept as
 * an alias so existing records are honoured rather than reinterpreted), and it is enforced by
 * the same canSeeEntity every task and file goes through — so the answer no longer depends on
 * which code path happens to be asking. */
test("knowledge marked Just me is visible ONLY to its creator", async () => {
  const id = (await adult.req("/api/knowledge", { method: "POST", body: JSON.stringify({ title: "Morgan's note", visibility: "personal", content: "just for me" }) })).data.item.id;
  assert.ok((await adult.req("/api/knowledge")).data.items.some((k) => k.id === id), "creator sees own private item");
  assert.ok(!(await owner.req("/api/knowledge")).data.items.some((k) => k.id === id),
    "another adult must NOT see it — that was the leak, and role is not a way in");
  assert.ok(!(await child.req("/api/knowledge")).data.items.some((k) => k.id === id), "nor a child");
});

test("gating: a peer can't edit/delete another member's item; the creator or an adult can", async () => {
  const mine = (await limited.req("/api/knowledge", { method: "POST", body: JSON.stringify({ title: "Robin's rule" }) })).data.item;
  assert.equal(mine.createdBy, limited.actorId);

  // The child (neither adult nor the creator) is refused.
  const childEdit = await child.req(`/api/knowledge/${mine.id}`, { method: "PATCH", body: JSON.stringify({ title: "hijack" }) });
  assert.equal(childEdit.status, 403);

  // The creator can edit their own item.
  const own = await limited.req(`/api/knowledge/${mine.id}`, { method: "PATCH", body: JSON.stringify({ title: "Robin's rule v2" }) });
  assert.equal(own.status, 200);
  assert.equal(own.data.item.title, "Robin's rule v2");

  // An adult can delete anyone's item.
  const adultDel = await adult.req(`/api/knowledge/${mine.id}`, { method: "DELETE" });
  assert.equal(adultDel.status, 200);
});

test("optimistic concurrency: a stale ifUpdatedAt is refused with 409 stale_write", async () => {
  const item = (await adult.req("/api/knowledge", { method: "POST", body: JSON.stringify({ title: "Concurrent" }) })).data.item;
  const stale = item.updatedAt;
  const first = await adult.req(`/api/knowledge/${item.id}`, { method: "PATCH", body: JSON.stringify({ content: "first", ifUpdatedAt: stale }) });
  assert.equal(first.status, 200);
  const second = await adult.req(`/api/knowledge/${item.id}`, { method: "PATCH", body: JSON.stringify({ content: "second", ifUpdatedAt: stale }) });
  assert.equal(second.status, 409);
  assert.equal(second.data.error, "stale_write");
});
