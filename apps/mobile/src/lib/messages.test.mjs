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
