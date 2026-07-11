// FILES — server-owned household file library (Phase 5): upload/list/content/delete,
// role + visibility gating, size cap.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, adult, child;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-noah");   // Child View
});
after(async () => { await stopServer(ctx); });

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

test("a child cannot upload a file (below Limited Member)", async () => {
  const r = await child.req("/api/files", { method: "POST", body: JSON.stringify({ name: "note.txt", contentBase64: b64("hi") }) });
  assert.equal(r.status, 403);
});

test("upload → list → content round-trips the exact bytes", async () => {
  const up = await adult.req("/api/files", { method: "POST", body: JSON.stringify({ name: "permission-slip.txt", mime: "text/plain", contentBase64: b64("Field trip Friday. Sign and return."), tags: ["school"] }) });
  assert.equal(up.status, 200);
  const f = up.data.file;
  assert.equal(f.name, "permission-slip.txt");
  assert.equal(f.sizeBytes, Buffer.byteLength("Field trip Friday. Sign and return."));
  // Listed for the household (child can see household-visibility files too).
  const childList = (await child.req("/api/files")).data.files;
  assert.ok(childList.some((x) => x.id === f.id), "household file visible to child");
  // Content round-trip.
  const dl = await adult.req(`/api/files/${f.id}/content`);
  assert.equal(dl.status, 200);
  assert.equal(Buffer.from(dl.data.contentBase64, "base64").toString("utf8"), "Field trip Friday. Sign and return.");
});

test("adults-only visibility hides a file from a child", async () => {
  const up = await adult.req("/api/files", { method: "POST", body: JSON.stringify({ name: "tax-doc.txt", contentBase64: b64("secret"), visibility: "adults" }) });
  assert.equal(up.status, 200);
  const id = up.data.file.id;
  const childList = (await child.req("/api/files")).data.files;
  assert.ok(!childList.some((x) => x.id === id), "adults file hidden from child list");
  const dl = await child.req(`/api/files/${id}/content`);
  assert.equal(dl.status, 404, "content 404s for a child (not 403 — existence not leaked)");
});

test("oversize upload is refused with 413", async () => {
  const big = "A".repeat(7_000_001);
  const r = await adult.req("/api/files", { method: "POST", body: JSON.stringify({ name: "big.bin", contentBase64: big }) });
  assert.equal(r.status, 413);
});

test("a child cannot delete an adult's file; an adult can", async () => {
  const f = (await adult.req("/api/files", { method: "POST", body: JSON.stringify({ name: "todel.txt", contentBase64: b64("x") }) })).data.file;
  const denied = await child.req(`/api/files/${f.id}`, { method: "DELETE" });
  assert.equal(denied.status, 403);
  const ok = await adult.req(`/api/files/${f.id}`, { method: "DELETE" });
  assert.equal(ok.status, 200);
  const gone = await adult.req(`/api/files/${f.id}/content`);
  assert.equal(gone.status, 404);
});

// Multi-page uploads (item 4): front+back of an ID card as ONE logical file, each page a
// separate blob, retrievable independently via ?page=N. Single-base64 uploads stay 1-page.
test("a 2-page upload stores each page as its own blob and fetches back per page", async () => {
  const up = await adult.req("/api/files", { method: "POST", body: JSON.stringify({
    name: "id-card", mime: "image/png",
    pages: [{ name: "front", base64: b64("FRONT-of-card") }, { name: "back", base64: b64("BACK-of-card") }],
  }) });
  assert.equal(up.status, 200);
  const f = up.data.file;
  assert.equal(f.pageCount, 2);
  assert.equal(f.pageBlobIds.length, 2);
  assert.equal(f.sizeBytes, Buffer.byteLength("FRONT-of-card") + Buffer.byteLength("BACK-of-card"), "sizeBytes sums the pages");

  // Page 0 is the default.
  const p0 = await adult.req(`/api/files/${f.id}/content`);
  assert.equal(p0.status, 200);
  assert.equal(p0.data.page, 0);
  assert.equal(p0.data.pageCount, 2);
  assert.equal(Buffer.from(p0.data.contentBase64, "base64").toString("utf8"), "FRONT-of-card");

  // Page 1 by query.
  const p1 = await adult.req(`/api/files/${f.id}/content?page=1`);
  assert.equal(p1.status, 200);
  assert.equal(Buffer.from(p1.data.contentBase64, "base64").toString("utf8"), "BACK-of-card");

  // Out-of-range page 404s.
  const p2 = await adult.req(`/api/files/${f.id}/content?page=2`);
  assert.equal(p2.status, 404);
  assert.equal(p2.data.error, "page_not_found");
});

test("a single-base64 upload is a 1-page file (back-compat)", async () => {
  const up = await adult.req("/api/files", { method: "POST", body: JSON.stringify({ name: "single.txt", contentBase64: b64("just one") }) });
  assert.equal(up.status, 200);
  assert.equal(up.data.file.pageCount, 1);
  const p0 = await adult.req(`/api/files/${up.data.file.id}/content`);
  assert.equal(Buffer.from(p0.data.contentBase64, "base64").toString("utf8"), "just one");
  const p1 = await adult.req(`/api/files/${up.data.file.id}/content?page=1`);
  assert.equal(p1.status, 404, "there is no second page");
});

test("an oversized page is refused with 413 (per-page cap)", async () => {
  const big = "A".repeat(7_000_001);
  const r = await adult.req("/api/files", { method: "POST", body: JSON.stringify({ name: "big", pages: [{ base64: b64("ok") }, { base64: big }] }) });
  assert.equal(r.status, 413);
});
