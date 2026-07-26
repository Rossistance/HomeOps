// Does an attached photo actually reach the model as an IMAGE?
//
// Reported, twice, with a screenshot of the assistant saying it: "I only received the filename
// 'IMG_2975.jpg', with no readable image or extracted text" and "no file ID or extracted
// contents". The upload was fixed; the reading was not. "It's not routing correctly."
//
// Guessing at this from the code was going nowhere — every link looked right in isolation — so
// this is the chain itself, end to end, against a real HTTP provider that records exactly what
// it was sent. It asserts the two things a screenshot can't distinguish:
//
//   the provider RECEIVED image bytes, not just a filename; and
//   what it said about the image reached the assistant's context.
//
// If either breaks again, this fails here instead of in front of a family.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer, makeSession } from "./harness.mjs";

// A 1x1 PNG. Real bytes, real mime, small enough to keep the test honest and fast.
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==";

let ctx, adult, fakeProvider, seen;

before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan");

  // Records every request body so the test can inspect what the provider was actually handed.
  seen = [];
  fakeProvider = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try { seen.push(JSON.parse(body)); } catch { seen.push({ unparsed: body }); }
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(JSON.stringify({ message: { content: "A red bicycle leaning on a fence. Text reads: SOCCER 4:15 TUESDAY." } }) + "\n");
    });
  });
  await new Promise((r) => fakeProvider.listen(0, r));
  const port = fakeProvider.address().port;
  await adult.req("/api/ai/providers/ollama/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "test-vision" }) });
  await adult.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "ollama" }) });
});
after(async () => { await stopServer(ctx); await new Promise((r) => fakeProvider.close(r)); });

const uploadPhoto = async (name = "IMG_2975.jpg") => {
  const r = await adult.req("/api/files", {
    method: "POST",
    body: JSON.stringify({ name, contentBase64: PNG_B64, mime: "image/jpeg", visibility: "household" }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.file.id;
};

/* ------------------------- the link that was in doubt -------------------------
 * Everything here goes through HTTP. An earlier draft imported understandFile directly and
 * asserted on it — which passed and proved nothing: the test process has its own store, so
 * `getFileRec` couldn't see a file the SERVER had just written, and "unreadable file reports
 * why" was really "missing file reports why". A test that passes for the wrong reason is worse
 * than no test, so the only way in is the way the app uses.
 */

test("reading a photo sends the actual IMAGE BYTES to the provider, not the filename", async () => {
  const fileId = await uploadPhoto();
  seen.length = 0;
  // The preview route reads a file server-side — the same understandFile the chat turn uses.
  const r = await adult.req(`/api/files/${fileId}/preview`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(String(r.data.text ?? ""), /red bicycle/i, "the description has to come back as text");

  assert.equal(seen.length, 1, "exactly one provider call");
  const payload = JSON.stringify(seen[0]);
  // The load-bearing assertion. A filename-only request is exactly the failure he screenshotted,
  // and it is indistinguishable from success at every layer above this one.
  assert.ok(payload.includes(PNG_B64.slice(0, 40)), "the image's base64 must be in the request body");
  assert.ok(!payload.includes("IMG_2975.jpg"), "a filename is not an image; sending it instead is the bug");
});

/* ---------------- and the whole way through the chat route ---------------- */

test("a photo attached in chat arrives at the assistant as CONTENT, on the streaming route", async () => {
  // The streaming route specifically: it's the one the app really uses, so an attachment that
  // only worked on POST /api/assistant would still look broken to every user.
  const fileId = await uploadPhoto("schedule.jpg");
  seen.length = 0;
  const res = await ctx.fetch("/api/assistant/stream", {
    method: "POST",
    headers: { Cookie: adult.cookie, "x-homeops-csrf": adult.csrf, "content-type": "application/json" },
    body: JSON.stringify({
      message: "Tell me what the attached photo is about",
      context: { attachedFileId: fileId, attachedFileName: "schedule.jpg" },
    }),
  });
  assert.equal(res.status, 200);
  await res.text();

  assert.ok(seen.length >= 2, `expected a vision call AND an assistant call, got ${seen.length}`);
  assert.ok(JSON.stringify(seen[0]).includes(PNG_B64.slice(0, 40)), "the first call is the image being looked at");

  /* And the description has to be IN the assistant's prompt. Two bugs used to break this:
   * the client context was nested under `clientHints` while the prompt documented it at the top
   * level, and the whole context blob was cut at 4000 chars — which sliced a page of transcribed
   * text off the end and left invalid JSON behind. The model was then asked about a photo it had
   * never been shown, which is when it starts apologising for an emptiness it can't explain. */
  const assistantCall = JSON.stringify(seen.slice(1));
  assert.match(assistantCall, /red bicycle|SOCCER 4:15/i,
    "what the vision model saw must reach the assistant, or it answers about nothing");
  assert.match(assistantCall, /ATTACHED IMAGE/,
    "the contents travel as their own labelled section, not inside the truncated context JSON");
});

test("a long transcription is NOT cut off by the household-context budget", async () => {
  // The regression that mattered most: the old code put this inside a 4000-char slice of the
  // context JSON, so a full page of text vanished and took the JSON's validity with it.
  const marker = "ZEBRACROSSING9471";
  const long = `${"Soccer practice Tuesday 4:15pm. ".repeat(300)}${marker}`;
  const prev = seen.length;
  const res = await ctx.fetch("/api/assistant/stream", {
    method: "POST",
    headers: { Cookie: adult.cookie, "x-homeops-csrf": adult.csrf, "content-type": "application/json" },
    body: JSON.stringify({
      message: "What's in this?",
      // Contents supplied directly: this is about the PROMPT budget, not about reading a file.
      context: { attachedFileName: "long.txt", attachedFileKind: "text", attachedFileText: long },
    }),
  });
  assert.equal(res.status, 200);
  await res.text();
  const sent = JSON.stringify(seen.slice(prev));
  assert.ok(sent.includes(marker), "the tail of a long attachment has to survive into the prompt");
});

test("a file that can't be read says why, in the reply's context", async () => {
  const up = await adult.req("/api/files", {
    method: "POST",
    body: JSON.stringify({ name: "mystery.bin", contentBase64: PNG_B64, mime: "application/octet-stream", visibility: "household" }),
  });
  const r = await adult.req(`/api/files/${up.data.file.id}/preview`);
  // Honest either way: a real reason, never an empty success that leaves the model to invent one.
  if (r.data.text) assert.ok(r.data.text.length > 0);
  else assert.ok((r.data.message ?? r.data.error ?? "").length > 5, "a refusal has to say something usable");
});
