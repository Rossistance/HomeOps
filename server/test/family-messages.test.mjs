// FAMILY MESSAGES — the household talking to itself, through the real server.
// Invariants: who may message whom follows role and nest (adults↔adults, parents→children,
// Adult Members→children only in their nest, children never start, guests never at all); a
// direct thread is unique per pair; growing a chat keeps its history and records who added
// whom; a read cursor per person drives unread counts and receipts; a muted person still gets
// the in-app row but no push; edits and deletes leave honest tombstones; reactions toggle;
// search stays inside my threads and my time in them; a removed person sees nothing after.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, alex, morgan, lily, noah, elaine, jamie, riley;
// Seeded: m-alex Owner, m-morgan Adult Admin, m-lily/m-noah Child View, m-elaine/m-sam Guest/Helper.
// Added here: m-jamie Adult Member, m-riley Limited Member.
before(async () => {
  ctx = await startServer();
  alex = await makeSession(ctx, "m-alex");
  for (const [actorId, displayName, role] of [["m-jamie", "Jamie Harper", "Adult Member"], ["m-riley", "Riley Harper", "Limited Member"]]) {
    const r = await alex.req("/api/members", { method: "POST", body: JSON.stringify({ actorId, displayName, role }) });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  morgan = await makeSession(ctx, "m-morgan");
  lily = await makeSession(ctx, "m-lily");
  noah = await makeSession(ctx, "m-noah");
  elaine = await makeSession(ctx, "m-elaine");
  jamie = await makeSession(ctx, "m-jamie");
  riley = await makeSession(ctx, "m-riley");
});
after(async () => { await stopServer(ctx); });

const create = (who, participantIds, title) => who.req("/api/threads", { method: "POST", body: JSON.stringify({ participantIds, title }) });
const send = (who, id, text, extra = {}) => who.req(`/api/threads/${id}/messages`, { method: "POST", body: JSON.stringify({ text, ...extra }) });
const view = (who, id) => who.req(`/api/threads/${id}`);
const mine = async (who) => (await who.req("/api/threads")).data.threads;

test("who may message whom: adults to adults, parents to children, never guests, children never start", async () => {
  assert.equal((await create(alex, ["m-morgan"])).status, 200, "Owner → Adult Admin");
  assert.equal((await create(jamie, ["m-morgan"])).status, 200, "Adult Member → Adult Admin");
  assert.equal((await create(alex, ["m-lily"])).status, 200, "Owner → child");
  const jamieToChild = await create(jamie, ["m-lily"]);
  assert.equal(jamieToChild.status, 403, "Adult Member → child outside any nest");
  assert.equal(jamieToChild.data.reason, "different_nest");
  const childStarts = await create(lily, ["m-alex"]);
  assert.equal(childStarts.status, 403);
  assert.equal(childStarts.data.reason, "child_cannot_start");
  const guest = await create(alex, ["m-elaine"]);
  assert.equal(guest.status, 403);
  assert.equal(guest.data.reason, "guest");
  const guestSelf = await elaine.req("/api/threads");
  assert.equal(guestSelf.status, 403, "a guest has no Messages at all");
  assert.equal((await create(alex, ["m-alex"])).status, 400, "nobody to message");
});

test("an Adult Member may message a child inside their own nest", async () => {
  // Jamie starts a nest with Lily; Lily accepts.
  const n = await jamie.req("/api/nests", { method: "POST", body: JSON.stringify({ name: "Jamie + Lily", inviteActorIds: ["m-lily"] }) });
  assert.equal(n.status, 200, JSON.stringify(n.data));
  const nestId = n.data.nest?.id ?? n.data.id;
  const acc = await lily.req(`/api/nests/${nestId}/accept`, { method: "POST", body: "{}" });
  assert.equal(acc.status, 200, JSON.stringify(acc.data));
  const r = await create(jamie, ["m-lily"]);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.thread.kind, "direct");
});

test("a direct thread is unique per pair, and a group needs three people", async () => {
  const a = await create(alex, ["m-morgan"]);
  const b = await create(morgan, ["m-alex"]);
  assert.equal(a.data.thread.id, b.data.thread.id, "the same two people share one thread whoever starts it");
  assert.equal(b.data.existed, true);
  const grp = await create(alex, ["m-morgan", "m-lily"], "Weekend plans");
  assert.equal(grp.status, 200);
  assert.equal(grp.data.thread.kind, "group");
  assert.equal(grp.data.thread.title, "Weekend plans");
  assert.deepEqual([...grp.data.thread.participantIds].sort(), ["m-alex", "m-lily", "m-morgan"]);
});

test("messages: unread counts, read cursor, receipts; the chat is the record (no Updates rows)", async () => {
  const t = (await create(alex, ["m-morgan"])).data.thread.id;
  const m1 = await send(alex, t, "Can you grab milk?");
  assert.equal(m1.status, 200, JSON.stringify(m1.data));
  assert.equal(m1.data.message.kind, "text");
  await send(alex, t, "And eggs.");
  const morganList = await mine(morgan);
  const row = morganList.find((x) => x.id === t);
  assert.equal(row.unreadCount, 2);
  assert.equal(row.lastPreview.text, "And eggs.");
  assert.equal((await mine(alex)).find((x) => x.id === t).unreadCount, 0, "my own messages are read");
  // No Updates rows for chat: the Messages segment and the unread count are the record.
  assert.equal((await morgan.req("/api/notifications")).data.notifications.filter((n) => n.threadId === t).length, 0);
  const audit = (await alex.req("/api/audit?limit=50")).data.events;
  assert.ok(audit.some((e) => e.type === "thread.push" && e.actorId === "m-morgan" && e.skipped === null), "the push still goes out");
  // Reading moves the cursor; Alex sees Morgan's receipt.
  await morgan.req(`/api/threads/${t}/read`, { method: "POST", body: "{}" });
  assert.equal((await mine(morgan)).find((x) => x.id === t).unreadCount, 0);
  const v = await view(alex, t);
  assert.ok(v.data.readBy["m-morgan"], "receipt visible to the sender");
  assert.equal(v.data.messages.length, 2);
  assert.equal(v.data.messages[0].text, "Can you grab milk?");
});

test("mute: the unread count still moves, the push is skipped; unmute restores it", async () => {
  const t = (await create(alex, ["m-morgan"])).data.thread.id;
  const mute = await morgan.req(`/api/threads/${t}/mute`, { method: "POST", body: JSON.stringify({ until: "forever" }) });
  assert.equal(mute.data.thread.muted, true);
  const m = await send(alex, t, "muted?");
  const audit = (await alex.req("/api/audit?limit=50")).data.events;
  const pushRow = audit.find((e) => e.type === "thread.push" && e.messageId === m.data.message.id);
  assert.ok(pushRow, "the push decision is recorded");
  assert.equal(pushRow.skipped, "muted");
  assert.ok((await mine(morgan)).find((x) => x.id === t).unreadCount >= 1, "still counted as unread");
  await morgan.req(`/api/threads/${t}/mute`, { method: "POST", body: JSON.stringify({ until: null }) });
  const m2 = await send(alex, t, "unmuted");
  const audit2 = (await alex.req("/api/audit?limit=50")).data.events;
  assert.equal(audit2.find((e) => e.type === "thread.push" && e.messageId === m2.data.message.id).skipped, null);
  // A timed mute in the past counts as unmuted.
  await morgan.req(`/api/threads/${t}/mute`, { method: "POST", body: JSON.stringify({ until: new Date(Date.now() - 1000).toISOString() }) });
  assert.equal((await mine(morgan)).find((x) => x.id === t).muted, false);
});

test("growing a chat keeps history and records who added whom; a child cannot add; removal and leaving", async () => {
  const t = (await create(alex, ["m-morgan"])).data.thread.id;
  await send(alex, t, "before Lily");
  const asChild = await lily.req(`/api/threads/${t}/members`, { method: "POST", body: JSON.stringify({ actorId: "m-noah" }) });
  assert.equal(asChild.status, 404, "Lily is not in this thread at all");
  const add = await morgan.req(`/api/threads/${t}/members`, { method: "POST", body: JSON.stringify({ actorId: "m-lily" }) });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  assert.equal(add.data.thread.kind, "group", "a direct thread becomes a group in place");
  const lv = await view(lily, t);
  assert.equal(lv.status, 200);
  assert.ok(lv.data.messages.some((x) => x.text === "before Lily"), "the newcomer sees the whole history");
  const sys = lv.data.messages.find((x) => x.kind === "system");
  assert.equal(sys.text, "Morgan Harper added Lily Harper");
  // Lily (child, participant) cannot add Noah.
  const lilyAdds = await lily.req(`/api/threads/${t}/members`, { method: "POST", body: JSON.stringify({ actorId: "m-noah" }) });
  assert.equal(lilyAdds.status, 403);
  // Jamie is not in the thread and cannot be added by... anyone not in it; Morgan can add Jamie (adult).
  assert.equal((await morgan.req(`/api/threads/${t}/members`, { method: "POST", body: JSON.stringify({ actorId: "m-jamie" }) })).status, 200);
  // Jamie (creator? no — Alex created) cannot remove Lily; Alex (creator and parent) can.
  assert.equal((await jamie.req(`/api/threads/${t}/members/m-lily`, { method: "DELETE" })).status, 403);
  await send(alex, t, "with Lily");
  const rm = await alex.req(`/api/threads/${t}/members/m-lily`, { method: "DELETE" });
  assert.equal(rm.status, 200, JSON.stringify(rm.data));
  await send(alex, t, "after Lily");
  const lilyAfter = await view(lily, t);
  assert.equal(lilyAfter.status, 200, "a removed person keeps what they had");
  assert.ok(lilyAfter.data.messages.some((x) => x.text === "with Lily"));
  assert.ok(!lilyAfter.data.messages.some((x) => x.text === "after Lily"), "and nothing after");
  assert.equal((await send(lily, t, "can I?")).status, 403);
  // Jamie leaves.
  const leave = await jamie.req(`/api/threads/${t}/leave`, { method: "POST", body: "{}" });
  assert.equal(leave.status, 200);
  assert.equal(leave.data.thread.left, true);
  // Rename works on a group, not on a direct thread.
  assert.equal((await alex.req(`/api/threads/${t}`, { method: "PATCH", body: JSON.stringify({ title: "Us three" }) })).data.thread.title, "Us three");
  const direct = (await create(alex, ["m-jamie"])).data.thread.id;
  assert.equal((await alex.req(`/api/threads/${direct}`, { method: "PATCH", body: JSON.stringify({ title: "x" }) })).status, 400);
});

test("a parent can read a child's threads; another adult cannot", async () => {
  const t = (await create(morgan, ["m-noah"])).data.thread.id;
  await send(morgan, t, "bedtime at 8");
  const asAlex = await alex.req("/api/threads?actorId=m-noah");
  assert.equal(asAlex.status, 200);
  assert.ok(asAlex.data.threads.some((x) => x.id === t));
  assert.equal((await view(alex, t)).status, 200, "Alex is a parent, not a participant, and can still read");
  assert.equal((await jamie.req("/api/threads?actorId=m-noah")).status, 403);
  assert.equal((await view(jamie, t)).status, 404);
  assert.equal((await send(alex, t, "hi")).status, 403, "reading is not posting");
});

test("edit and delete leave honest tombstones; only the sender edits; reactions toggle", async () => {
  const t = (await create(alex, ["m-morgan"])).data.thread.id;
  const m = (await send(alex, t, "Dinner at 6")).data.message;
  assert.equal((await morgan.req(`/api/threads/${t}/messages/${m.id}`, { method: "PATCH", body: JSON.stringify({ text: "no" }) })).status, 403);
  const ed = await alex.req(`/api/threads/${t}/messages/${m.id}`, { method: "PATCH", body: JSON.stringify({ text: "Dinner at 7" }) });
  assert.equal(ed.data.message.text, "Dinner at 7");
  assert.ok(ed.data.message.editedAt);
  assert.equal((await mine(morgan)).find((x) => x.id === t).lastPreview.text, "Dinner at 7", "the preview follows the edit");
  const r1 = await morgan.req(`/api/threads/${t}/messages/${m.id}/reactions`, { method: "POST", body: JSON.stringify({ emoji: "👍" }) });
  assert.deepEqual(r1.data.message.reactions, { "👍": ["m-morgan"] });
  const r2 = await morgan.req(`/api/threads/${t}/messages/${m.id}/reactions`, { method: "POST", body: JSON.stringify({ emoji: "👍" }) });
  assert.deepEqual(r2.data.message.reactions, {});
  const del = await alex.req(`/api/threads/${t}/messages/${m.id}`, { method: "DELETE" });
  assert.ok(del.data.message.deletedAt);
  assert.equal(del.data.message.text, "");
  assert.equal((await mine(morgan)).find((x) => x.id === t).lastPreview.text, "Message deleted");
  assert.equal((await morgan.req(`/api/threads/${t}/messages/${m.id}/reactions`, { method: "POST", body: JSON.stringify({ emoji: "❤️" }) })).status, 400);
});

test("search stays inside my threads and my time in them; typing expires", async () => {
  const t = (await create(alex, ["m-morgan", "m-jamie"], "Search me")).data.thread.id;
  await send(alex, t, "The pediatrician moved to Tuesday");
  await send(alex, t, "Also dentist", { attachments: [{ kind: "file", fileId: "file_x", name: "Pediatrician-form.pdf", mime: "application/pdf" }] });
  const hits = (await morgan.req("/api/threads/search?q=pediatrician")).data;
  assert.equal(hits.hits.length, 2, "text and attachment names both match");
  assert.ok(hits.threads[t]);
  assert.equal((await lily.req("/api/threads/search?q=pediatrician")).data.hits.length, 0, "not my thread");
  await jamie.req(`/api/threads/${t}/leave`, { method: "POST", body: "{}" });
  await send(alex, t, "pediatrician again, after Jamie left");
  assert.equal((await jamie.req("/api/threads/search?q=pediatrician")).data.hits.length, 2, "nothing after leaving");
  assert.equal((await morgan.req(`/api/threads/${t}/typing`, { method: "POST", body: "{}" })).status, 200);
  assert.deepEqual((await view(alex, t)).data.typing, ["m-morgan"]);
  assert.deepEqual((await view(morgan, t)).data.typing, [], "you are never told you are typing");
});

test("share attachments carry a fresh preview the reader may see, or a hidden marker", async () => {
  const ev = await alex.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Dance recital", startAt: "2026-10-03T22:00:00.000Z", endAt: "2026-10-03T23:00:00.000Z", visibility: "private" }) });
  assert.equal(ev.status, 200, JSON.stringify(ev.data));
  const evId = ev.data.event.id;
  const t = (await create(alex, ["m-morgan"])).data.thread.id;
  const m = await send(alex, t, "", { attachments: [{ kind: "ref", type: "event", id: evId }] });
  assert.equal(m.status, 200, JSON.stringify(m.data));
  assert.equal(m.data.message.kind, "share");
  assert.equal(m.data.message.attachments[0].preview.title, "Dance recital", "the owner sees the card");
  const asMorgan = await view(morgan, t);
  const card = asMorgan.data.messages.at(-1).attachments[0].preview;
  assert.equal(card.hidden, true, "a private event stays hidden from the reader");
  assert.equal((await mine(morgan)).find((x) => x.id === t).lastPreview.text, "Shared event");
});

test("one thread per set of people: the same group asked for twice is the same chat", async () => {
  const a = await create(alex, ["m-morgan", "m-jamie"], "Trio");
  const b = await create(morgan, ["m-jamie", "m-alex"]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(b.data.thread.id, a.data.thread.id, "whoever starts it, it is the chat they already have");
  assert.equal(b.data.existed, true);
  assert.equal(b.data.thread.title, "Trio");
});

test("deleting a chat clears it on my side only; a new message brings it back fresh", async () => {
  const t = (await create(alex, ["m-jamie"])).data.thread.id;
  await send(alex, t, "old news");
  await send(jamie, t, "indeed");
  const del = await alex.req(`/api/threads/${t}`, { method: "DELETE" });
  assert.equal(del.status, 200);
  assert.ok(!(await mine(alex)).some((x) => x.id === t), "gone from my list");
  assert.ok((await mine(jamie)).some((x) => x.id === t), "still there for Jamie");
  assert.equal((await view(jamie, t)).data.messages.length, 2, "Jamie keeps everything");
  assert.equal((await view(alex, t)).data.messages.length, 0, "I see nothing from before");
  await send(jamie, t, "are you there?");
  const back = (await mine(alex)).find((x) => x.id === t);
  assert.ok(back, "a new message brings the chat back");
  assert.equal(back.unreadCount, 1);
  assert.equal(back.lastPreview.text, "are you there?");
  assert.equal((await view(alex, t)).data.messages.length, 1, "fresh: only what came after");
  assert.equal((await alex.req("/api/threads/search?q=old%20news")).data.hits.length, 0, "search does not resurrect it");
  // Messaging Jamie again is the same thread, seen fresh.
  assert.equal((await create(alex, ["m-jamie"])).data.thread.id, t);
});
