// Every screen draws hidden events the same way (ADR-005): someone else's hidden time is a
// block; the owner's own hidden event is blurred with an eye; everything else is a card.
import test from "node:test";
import assert from "node:assert/strict";
import { eventFace, isBlock, canToggleSharing, eyeLabel } from "./event-face.ts";

test("someone else's hidden time is a block, by its marker or its id", () => {
  const b = { id: "blk_1234", title: "Beannie working", ownerId: "m-bean", block: { kind: "work" } };
  assert.deepEqual(eventFace(b), { mode: "block", kind: "work", label: "Beannie working", ownerId: "m-bean" });
  assert.equal(isBlock({ id: "blk_abc" }), true, "an older server without the marker still reads as a block by id");
  assert.equal(eventFace({ id: "blk_x", title: "Gpop busy", ownerId: "m-g", block: { kind: "busy" } }).kind, "busy");
  assert.equal(canToggleSharing(b), false);
});

test("the owner's own hidden event is blurred with an eye; a withheld one is not a card to blur", () => {
  const own = { id: "ev_1", title: "1:1 with Pat", ownerId: "m-bean", privacy: { obscured: true, kind: "work", secret: false, canToggle: true } };
  assert.deepEqual(eventFace(own), { mode: "ownHidden", kind: "work", secret: false });
  assert.equal(canToggleSharing(own), true);
  assert.equal(eyeLabel(eventFace(own)), "Share with family");
  assert.equal(eventFace({ id: "ev_2", title: "Private event", ownerId: "m-bean", privacy: { obscured: true, kind: "busy", secret: true, withheld: true } }).mode, "full");
});

test("an ordinary event is a card; the owner's carries the hide option and the surprise hint", () => {
  assert.deepEqual(eventFace({ id: "ev_3", title: "Soccer", ownerId: "m-kid" }), { mode: "full", canHide: false, secret: false });
  const mine = { id: "ev_4", title: "Anniversary dinner", ownerId: "m-bean", privacy: { obscured: false, secret: true, canToggle: true } };
  assert.deepEqual(eventFace(mine), { mode: "full", canHide: true, secret: true });
  assert.equal(eyeLabel(eventFace(mine)), "Hide from family");
});
