// "The Daily Household Briefing has some odd characters in it."
//
// The file was stored as `Daily Household Briefing ÃÂÂ July 13, 2026.pdf`. The original had an
// em-dash.
//
// The request body used to be accumulated with `b += chunk`, which coerces each Buffer to a
// string SEPARATELY. A multi-byte UTF-8 character straddling a chunk boundary is therefore
// decoded as two half-characters — so every accent, dash and emoji in a large enough request
// came out mangled. Small bodies arrive in one chunk and look perfect, which is exactly why it
// survived: it only bites once a request is big enough for the network to split it, i.e. an
// upload.
//
// The test that matters is the second one. The first would have passed the whole time.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession, ORIGIN } from "./harness.mjs";

let ctx, alex;
before(async () => { ctx = await startServer(); alex = await makeSession(ctx, "m-alex"); });
after(async () => { await stopServer(ctx); });

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

test("a small body keeps its em-dash (this always worked)", async () => {
  const name = "Daily Household Briefing — July 13, 2026.pdf";
  const r = await alex.req("/api/files", { method: "POST", body: JSON.stringify({ name, contentBase64: b64("x") }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.file.name, name);
});

test("THE BUG: a LARGE body keeps its em-dash too — a character split across chunks", async () => {
  // Big enough that node delivers it in several chunks. The multi-byte characters are placed
  // throughout, so at least one lands on a boundary.
  const name = "Daily Household Briefing — July 13, 2026.pdf";
  const filler = "Ünïcøde — ✅ 🎉 ".repeat(40_000);      // ~2 MB of multi-byte text
  const r = await alex.req("/api/files", {
    method: "POST",
    body: JSON.stringify({ name, contentBase64: b64("x"), tags: ["ok"], notes: filler }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.data.file.name, name, "the name must survive being sent in a body big enough to be split");
  assert.ok(!/Ã|Â|â€/.test(r.data.file.name), "no mojibake — that pattern IS the double-decode signature");
});

test("multi-byte content survives a large body, not just the name", async () => {
  // The same failure would corrupt a note, a message, or a person's name.
  const notes = "café — naïve — 日本語 — 🎂";
  const big = "x".repeat(3_000_000);
  const r = await alex.req("/api/knowledge", {
    method: "POST",
    body: JSON.stringify({ title: "Encoding check", type: "note", content: `${notes}\n${big}` }),
  });
  assert.equal(r.status, 200);
  assert.ok(r.data.item.content.startsWith(notes), "every accent and emoji intact");
});

test("a body over the ceiling is refused rather than accumulated forever", async () => {
  // readRaw had no size limit at all before this — any caller could stream an unbounded
  // string into memory.
  const r = await ctx.fetch("/api/files", {
    method: "POST",
    headers: { "content-type": "application/json", Origin: ORIGIN, Cookie: alex.cookie, "x-homeops-csrf": alex.csrf },
    body: JSON.stringify({ name: "huge.bin", contentBase64: "A".repeat(70 * 1024 * 1024) }),
  }).catch(() => ({ status: 0 }));
  assert.notEqual(r.status, 200, "an over-ceiling body must not be accepted");
});
