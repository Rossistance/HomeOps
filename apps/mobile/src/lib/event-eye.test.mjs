// The rules beside event-face: a block's time range, when the open eye shows, and what the
// owner reads above their own hidden event's blur (ADR-005).
import test from "node:test";
import assert from "node:assert/strict";
import { timeRangeLabel, blockA11yLabel, showsHideEye as showsHideEyeFor, hiddenCaption } from "./event-eye.ts";
import { eventFace } from "./event-face.ts";

const showsHideEye = (e, subs) => showsHideEyeFor(eventFace(e), e, subs);

const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0).toISOString();
const clock = (iso) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

test("a block reads its time honestly: all day, a range, or a lone start", () => {
  assert.equal(timeRangeLabel({ startAt: local(2026, 9, 24), allDay: true }), "All day");
  assert.equal(timeRangeLabel({ startAt: null }), "All day");
  const s = local(2026, 9, 24, 9), e = local(2026, 9, 24, 17);
  assert.equal(timeRangeLabel({ startAt: s, endAt: e }), `${clock(s)} – ${clock(e)}`);
  assert.equal(timeRangeLabel({ startAt: s, endAt: null }), clock(s));
  assert.equal(timeRangeLabel({ startAt: s, endAt: s }), clock(s), "an end that is not after the start is no range");
});

test("an overnight block names the day it ends on", () => {
  const s = local(2026, 9, 24, 22), e = local(2026, 9, 25, 6);
  const label = timeRangeLabel({ startAt: s, endAt: e });
  const weekday = new Date(e).toLocaleDateString(undefined, { weekday: "short" });
  assert.ok(label.includes(weekday), label);
});

test("the block's accessibility sentence is its label, then its time", () => {
  assert.equal(blockA11yLabel("Beannie working", { startAt: local(2026, 9, 24), allDay: true }), "Beannie working, All day");
});

test("the open eye shows only on my own shared event from a Work calendar", () => {
  const subs = [{ id: "sub_work", isWork: true }, { id: "sub_home", isWork: false }];
  const mine = { id: "ev_1", title: "Standup", ownerId: "m-me", privacy: { obscured: false, canToggle: true }, provenance: { subscriptionId: "sub_work" } };
  assert.equal(showsHideEye(mine, subs), true);
  assert.equal(showsHideEye({ ...mine, provenance: { subscriptionId: "sub_home" } }, subs), false, "not a Work calendar");
  assert.equal(showsHideEye({ ...mine, provenance: {} }, subs), false, "made in FamiliOS: hide it from the form");
  assert.equal(showsHideEye({ ...mine, privacy: undefined }, subs), false, "not mine to hide");
  assert.equal(showsHideEye({ ...mine, privacy: { obscured: true, kind: "work", canToggle: true } }, subs), false, "already hidden: that card has the eye-slash");
  assert.equal(showsHideEye({ id: "blk_1", title: "Bean working", ownerId: "m-b", block: { kind: "work", count: 1 }, provenance: { subscriptionId: "sub_work" } }, subs), false);
});

test("the caption over my own hidden event says why it is hidden", () => {
  assert.equal(hiddenCaption({ mode: "ownHidden", kind: "work", secret: false }), "Work, hidden from the family");
  assert.equal(hiddenCaption({ mode: "ownHidden", kind: "busy", secret: false }), "Hidden from the family");
  assert.equal(hiddenCaption({ mode: "ownHidden", kind: "busy", secret: true }), "A surprise, hidden from the family");
});
