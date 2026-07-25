// "The profile images are being stored as home files instead of in a dedicated location."
//
// They were: an avatar went through the same upload path as a school form, so every family
// member's face turned up in the household document library next to insurance paperwork.
//
// The fix is a record that says what it IS, not a second storage system — the blob still has
// to live somewhere that can serve the picture. What changed is that the Library lists
// DOCUMENTS. The test that matters most is the last one: an avatar uploaded before this
// existed must not vanish from the library it's currently sitting in, because "we tidied up
// and your file disappeared" is a worse bug than the one being fixed.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

let ctx, alex;
before(async () => { ctx = await startServer(); alex = await makeSession(ctx, "m-alex"); });
after(async () => { await stopServer(ctx); });

const upload = (over) => alex.req("/api/files", {
  method: "POST",
  body: JSON.stringify({ name: "thing.png", contentBase64: PNG, mime: "image/png", ...over }),
});
const library = async (q = "") => (await alex.req(`/api/files${q}`)).data.files;

test("an avatar is not listed in the family document library", async () => {
  const r = await upload({ name: "avatar-123.jpg", kind: "avatar", visibility: "private" });
  assert.equal(r.status, 200);
  assert.equal(r.data.file.kind, "avatar");
  const files = await library();
  assert.ok(!files.some((f) => f.id === r.data.file.id),
    "a face is chrome, not a household document");
});

test("a real document still is", async () => {
  const r = await upload({ name: "school-form.pdf" });
  assert.equal(r.data.file.kind, "document");
  const files = await library();
  assert.ok(files.some((f) => f.id === r.data.file.id));
});

test("the avatar's bytes are still there and still serve — it was hidden, not deleted", async () => {
  const r = await upload({ name: "avatar-me.jpg", kind: "avatar", visibility: "private" });
  const content = await alex.req(`/api/files/${r.data.file.id}/content`);
  assert.equal(content.status, 200, "the picture must still render on every screen that shows it");
});

test("?include=all still shows them — the app doesn't pretend the bytes aren't there", async () => {
  const r = await upload({ name: "avatar-hidden.jpg", kind: "avatar", visibility: "private" });
  const all = await library("?include=all");
  assert.ok(all.some((f) => f.id === r.data.file.id));
});

test("a client can't smuggle in a third kind", async () => {
  const r = await upload({ name: "odd.bin", kind: "something-else" });
  assert.equal(r.data.file.kind, "document", "anything unrecognised is a document");
});

test("BACK-COMPAT: a file stored before `kind` existed stays a document", async () => {
  // Every file already in a real household has no `kind` at all. If the filter treated a
  // missing kind as anything but "document", the fix would empty people's libraries.
  const r = await upload({ name: "legacy.pdf" });
  const { writeStoreDoc, readStoreDoc } = await import("./harness.mjs");
  const files = readStoreDoc(ctx, "household_files.json", {});
  const key = Object.keys(files).find((k) => files[k]?.id === r.data.file.id);
  assert.ok(key, "seeded a file to age");
  delete files[key].kind;
  writeStoreDoc(ctx, "household_files.json", files);
  const listed = await library();
  assert.ok(listed.some((f) => f.id === r.data.file.id),
    "a file with no kind is a document — anything else would make existing libraries vanish");
});
