// WP-004 (ISS-003, DEC-04): Google description fidelity — notes + "Bring: …"
// composed at the single payload-builder choke point, with a LOSSLESS pull.
// Pure fixture tests; NEVER a live Google call (DEC-08).
import test from "node:test";
import assert from "node:assert/strict";
import "./harness.mjs"; // binds HOMEOPS_DATA_DIR before calendar.mjs → store.mjs loads
import { composeGoogleDescription, stripFamiliosBlock, mergeGoogleEdit, FAMILIOS_BLOCK_DELIM } from "../calendar.mjs";

const ev = (over = {}) => ({
  id: "ev_1", title: "Water day at Prek",
  startAt: "2026-07-17T12:25:00.000Z", endAt: "2026-07-17T21:25:00.000Z",
  location: "st. jude catholic school",
  notes: "Bring a change of clothes for after.",
  whatToBring: [{ item: "swimsuit", memberId: null }, { item: "towel", memberId: "m-owner" }],
  updatedAt: "2026-07-01T00:00:00.000Z",
  provenance: { googleEventId: "g1", pushedAt: Date.parse("2026-07-10T00:00:00Z"), lastMergeAt: 0 },
  ...over,
});

test("description carries notes AND the Bring list (TF-003 fixed)", () => {
  const d = composeGoogleDescription(ev());
  assert.ok(d.includes("Bring a change of clothes for after."), "notes present");
  assert.ok(d.includes("Bring: swimsuit, towel"), "what-to-bring present");
  assert.ok(d.includes(FAMILIOS_BLOCK_DELIM), "delimited block");
});

test("no bring → plain notes; nothing → empty string (no stray delimiters)", () => {
  assert.equal(composeGoogleDescription(ev({ whatToBring: [] })), "Bring a change of clothes for after.");
  assert.equal(composeGoogleDescription(ev({ whatToBring: [], notes: "" })), "");
  const onlyBring = composeGoogleDescription(ev({ notes: "" }));
  assert.equal(onlyBring, `${FAMILIOS_BLOCK_DELIM}\nBring: swimsuit, towel`);
});

test("strip(compose(ev)) round-trips to the user's notes exactly (lossless)", () => {
  assert.equal(stripFamiliosBlock(composeGoogleDescription(ev())), "Bring a change of clothes for after.");
  assert.equal(stripFamiliosBlock(composeGoogleDescription(ev({ notes: "" }))), "");
  assert.equal(stripFamiliosBlock("plain google text"), "plain google text");
});

test("pull does NOT re-import the composed Bring block: unchanged round-trip is a no-op", () => {
  const e = ev();
  const gev = {
    summary: e.title, description: composeGoogleDescription(e),
    start: { dateTime: e.startAt }, end: { dateTime: e.endAt },
    location: e.location, updated: "2026-07-09T00:00:00Z",
  };
  assert.equal(mergeGoogleEdit({ ev: e, gev }).action, "none", "re-push is idempotent; no conflict storm");
});

test("a Google-side edit to the NOTES part merges back without the Bring block", () => {
  const e = ev();
  const gev = {
    summary: e.title,
    description: `Bring a change of clothes for after. Gate opens 8am.\n\n${FAMILIOS_BLOCK_DELIM}\nBring: swimsuit, towel`,
    start: { dateTime: e.startAt }, end: { dateTime: e.endAt },
    location: e.location, updated: "2026-07-12T00:00:00Z",
  };
  const d = mergeGoogleEdit({ ev: e, gev });
  assert.equal(d.action, "merge");
  assert.equal(d.fields.notes, "Bring a change of clothes for after. Gate opens 8am.");
  assert.ok(!d.fields.notes.includes("Bring:"), "composed block never lands in notes");
});
