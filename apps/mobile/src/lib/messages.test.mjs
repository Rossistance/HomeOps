// Updates group by who sent them. A helper is a source before its first delivery, a
// deleted helper's past updates stay reachable, and untagged rows land under System.
import test from "node:test";
import assert from "node:assert/strict";
import { notificationSources, sourceKeyOf, notificationTarget } from "./messages.ts";

const note = (over = {}) => ({ id: "n", channel: "in_app", title: "t", body: "b", read: false, createdAt: 0, ...over });

test("every helper gets a chip, even with no rows yet; System only when an untagged row exists", () => {
  const chips = notificationSources([], [{ id: "agt_1", name: "Morning Briefing", conversationId: "conv_1" }]);
  assert.deepEqual(chips.map((c) => c.key), ["all", "helper:agt_1"]);
  assert.equal(chips[1].conversationId, "conv_1");
  const withSystem = notificationSources([note()], [{ id: "agt_1", name: "Morning Briefing" }]);
  assert.deepEqual(withSystem.map((c) => c.key), ["all", "helper:agt_1", "system"]);
});

test("a deleted helper's rows still get a chip named from the row", () => {
  const chips = notificationSources([note({ source: { kind: "helper", id: "agt_old", name: "Week Ahead" }, conversationId: "conv_9" })], []);
  assert.deepEqual(chips.map((c) => c.key), ["all", "helper:agt_old"]);
  assert.equal(chips[1].label, "Week Ahead");
  assert.equal(chips[1].conversationId, "conv_9");
});

test("Famili and Family chips appear only when rows carry those sources, and keys map back", () => {
  const notes = [
    note({ id: "a", source: { kind: "assistant" } }),
    note({ id: "b", source: { kind: "thread", id: "fth_1", name: "Melissa" }, threadId: "fth_1" }),
    note({ id: "c", source: { kind: "member", id: "m-owner" } }),
  ];
  const chips = notificationSources(notes, []);
  assert.deepEqual(chips.map((c) => c.key), ["all", "assistant", "thread", "system"]);
  assert.equal(sourceKeyOf(notes[0]), "assistant");
  assert.equal(sourceKeyOf(notes[1]), "thread");
  assert.equal(sourceKeyOf(notes[2]), "system");
});

test("a tap goes to the thing the notification names", () => {
  assert.deepEqual(notificationTarget(note({ threadId: "fth_1" })), { pathname: "/messages/[id]", params: { id: "fth_1" } });
  assert.deepEqual(notificationTarget(note({ data: { type: "event", id: "ev_1" } })), { pathname: "/event-form", params: { id: "ev_1" } });
  assert.equal(notificationTarget(note()), null);
});

// ---- threads ----
import { canStartWith, threadTitle, groupByDay, dayLabel, formatDuration, receiptsFor } from "./messages.ts";

const member = (actorId, role, displayName = actorId) => ({ actorId, role, displayName, relationship: null, spaceIds: [], isCurrentUser: false });
const nest = (...ids) => ({ id: "n", name: null, label: "", createdBy: ids[0], createdAt: "", members: ids.map((actorId) => ({ actorId, name: null, status: "joined", respondedAt: null })) });

test("the picker mirrors the server: adults↔adults, parents→children, Adult Member→child only in a shared nest, children never, guests never", () => {
  const owner = member("o", "Owner"), admin = member("a", "Adult Admin"), am = member("m", "Adult Member");
  const kid = member("k", "Child View"), lim = member("l", "Limited Member"), guest = member("g", "Guest/Helper");
  assert.equal(canStartWith(owner, admin, []), true);
  assert.equal(canStartWith(am, owner, []), true);
  assert.equal(canStartWith(owner, kid, []), true);
  assert.equal(canStartWith(admin, lim, []), true);
  assert.equal(canStartWith(am, kid, []), false);
  assert.equal(canStartWith(am, kid, [nest("m", "k")]), true);
  assert.equal(canStartWith(kid, owner, []), false);
  assert.equal(canStartWith(owner, guest, []), false);
  assert.equal(canStartWith(owner, owner, []), false);
});

test("thread titles name the others, never me", () => {
  const t = (title, names) => ({ id: "t", kind: "group", title, participantIds: [], createdBy: "", createdAt: "", updatedAt: "", lastMessageAt: null, lastPreview: null, unreadCount: 0, muted: false, left: false, archived: false,
    members: names.map((n, i) => ({ actorId: `m${i}`, displayName: n, role: null, joinedAt: "", leftAt: null, lastReadAt: null, mutedUntil: null })) });
  assert.equal(threadTitle(t(null, ["Ross Hixon", "Melissa Reyes"]), "m0"), "Melissa");
  assert.equal(threadTitle(t(null, ["Ross", "Melissa", "GPop", "Beannie"]), "m0"), "Melissa, GPop, Beannie");
  assert.equal(threadTitle(t(null, ["Ross", "A", "B", "C", "D"]), "m0"), "A, B +2");
  assert.equal(threadTitle(t("Weekend", ["Ross", "Melissa"]), "m0"), "Weekend");
});

test("messages group by local day and receipts land on the last message each reader passed", () => {
  const m = (id, at, from = "a") => ({ id, threadId: "t", fromActorId: from, at, kind: "text", text: id, attachments: [], reactions: {}, suggestions: [], editedAt: null, deletedAt: null });
  const d1 = new Date(2026, 8, 17, 9).toISOString(), d2 = new Date(2026, 8, 17, 18).toISOString(), d3 = new Date(2026, 8, 18, 8).toISOString();
  const days = groupByDay([m("c", d3), m("a", d1), m("b", d2)]);
  assert.deepEqual(days.map((d) => d.items.map((x) => x.id)), [["a", "b"], ["c"]]);
  assert.equal(dayLabel("2026-09-18", "2026-09-18"), "Today");
  assert.equal(dayLabel("2026-09-17", "2026-09-18"), "Yesterday");
  const receipts = receiptsFor([m("a", d1), m("b", d2), m("c", d3)], { b: d2, me: d3, a: d3 }, "me");
  assert.deepEqual(receipts, { b: ["b"] }, "b read up to the second message; a's own messages never carry a's receipt");
  assert.equal(formatDuration(67_000), "1:07");
});
