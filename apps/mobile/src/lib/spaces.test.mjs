// WP-002 / ISS-002 unit cases — run with:  node --test apps/mobile/src/lib/spaces.test.mjs
// (node >= 23 strips types from the imported .ts natively; no RN imports involved)
import test from "node:test";
import assert from "node:assert/strict";
import { spaceOf, spaceLabelOf } from "./spaces.ts";

const file = (name, tags = [], spaceId = "sp-family") => ({ name, tags, spaceId });

test("ISS-002 regex fix: names merely CONTAINING 'id' no longer land in Medical & IDs", () => {
  assert.equal(spaceOf(file("video.mp4")), "home");
  assert.equal(spaceOf(file("Friday.pdf")), "home");
  assert.equal(spaceOf(file("holiday-schedule.png")), "home");
});

test("real medical/ID names still match", () => {
  assert.equal(spaceOf(file("ID card front.jpg")), "medical");
  assert.equal(spaceOf(file("passport-scan.pdf")), "medical");
  assert.equal(spaceOf(file("insurance-card.jpg")), "medical");
  assert.equal(spaceOf(file("kids IDs.pdf")), "medical");
});

test("explicit space tags always win over name keywords", () => {
  assert.equal(spaceOf(file("insurance.pdf", ["home"])), "home");
  assert.equal(spaceOf(file("anything.bin", ["medical-ids"])), "medical");
  assert.equal(spaceOf(file("school photo.jpg", ["bills-receipts"])), "bills");
  assert.equal(spaceOf(file("random.txt", ["school"])), "school");
});

test("untagged heuristics keep working (school/bills), fallback is Home", () => {
  assert.equal(spaceOf(file("permission slip.pdf")), "school");
  assert.equal(spaceOf(file("electricity bill.pdf")), "bills");
  assert.equal(spaceOf(file("garden-notes.txt")), "home");
});

test("sensitive-tagged files categorize as medical via heuristic (unchanged behavior)", () => {
  assert.equal(spaceOf(file("doc.pdf", ["sensitive"])), "medical");
});

test("labels", () => {
  assert.equal(spaceLabelOf("medical"), "Medical & IDs");
  assert.equal(spaceLabelOf("home"), "Home");
});
