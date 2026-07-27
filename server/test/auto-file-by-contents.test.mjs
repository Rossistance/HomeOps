// Where does a document go when you let Famili decide?
//
// "I uploaded a receipt from Home Depot for a Ryobi drill as a PDF. I let Famili decide, and
//  Famili decided to put it into Home — which would make sense if it were NOT a receipt. So this
//  is wrong. It should have gone into Bills & Receipts."
//
// TWO TRAPS, and the second is why the obvious fix wouldn't have worked.
//
// One: it decided from the FILENAME. A PDF off a camera roll is called IMG_3011.pdf, which
// matches no keyword, so it fell through to Home — whose pattern is /./ and matches everything.
//
// Two: a receipt from HOME DEPOT contains the word "home". Naively reading the contents and
// taking the first match would file it right back where it was wrongly filed, and the fix would
// have looked like it worked on any receipt from anywhere else.
//
// So Home is excluded from scoring entirely — it can only ever be the fallback — and the rest
// are scored rather than first-matched. That's what these tests pin.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { startServer, stopServer, makeSession } from "./harness.mjs";

const HOME_DEPOT_RECEIPT = [
  "THE HOME DEPOT",
  "STORE #1234  CHATTANOOGA TN",
  "RYOBI 18V ONE+ CORDLESS DRILL",
  "SUBTOTAL   99.00",
  "SALES TAX   9.16",
  "TOTAL  $108.16",
  "RETURN POLICY: 90 DAYS WITH RECEIPT",
].join("\n");

let ctx, adult, fakeProvider;

before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan");
  // Vision isn't needed for a text file, but the provider has to exist for the read path.
  fakeProvider = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/x-ndjson" });
      res.end(JSON.stringify({ message: { content: HOME_DEPOT_RECEIPT } }) + "\n");
    });
  });
  await new Promise((r) => fakeProvider.listen(0, r));
  const port = fakeProvider.address().port;
  await adult.req("/api/ai/providers/ollama/config", { method: "POST", body: JSON.stringify({ baseUrl: `http://localhost:${port}`, model: "t" }) });
  await adult.req("/api/ai/active", { method: "POST", body: JSON.stringify({ providerId: "ollama" }) });
});
after(async () => { await stopServer(ctx); await new Promise((r) => fakeProvider.close(r)); });

const upload = (name, text, extra = {}) =>
  adult.req("/api/files", {
    method: "POST",
    body: JSON.stringify({
      name,
      contentBase64: Buffer.from(text, "utf8").toString("base64"),
      mime: "text/plain",
      visibility: "household",
      ...extra,
    }),
  });

test("THE REPORTED CASE: a Home Depot receipt files to Bills & Receipts, not Home", async () => {
  // The filename is deliberately useless, exactly as a camera-roll PDF's is.
  const r = await upload("IMG_3011.pdf", HOME_DEPOT_RECEIPT, { autoFile: true });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.autoFiled, "bills-receipts",
    "a receipt is a receipt wherever it was bought — 'home' in the merchant name must not win");
  assert.ok(r.data.file.tags.includes("bills-receipts"));
});

test("…and the decision is made BEFORE the response, so the toast can't name the wrong space", async () => {
  // Filing a second later would leave the confirmation saying "Saved to Home", which is the
  // exact complaint. The tag has to be on the record that comes back.
  const r = await upload("IMG_9999.pdf", HOME_DEPOT_RECEIPT, { autoFile: true });
  assert.ok(r.data.file.tags.includes(r.data.autoFiled), "the returned record already carries its space");
});

/* The above two tests passed for a WHOLE RELEASE while the bug was still on screen.
 *
 * Both assert `autoFiled`, and `autoFiled` was right. What neither asked was what the app
 * READS: the client sends its filename guess as a fallback tag ("home", because home's
 * pattern matches everything) alongside autoFile, the server APPENDED the decision to it, and
 * spaceOf (apps/mobile/src/lib/spaces.ts) returns the FIRST space tag it finds. So the record
 * was tagged ["home","bills-receipts"], the response said bills-receipts, and the toast said
 * "Saved to Home".
 *
 * A test that reads the field the server is proud of instead of the field the app renders is
 * the same defect as a success signal that never checks the outcome — just aimed inward. The
 * three below assert on the rendered answer. */

/** What the app shows: the first space tag on the record. Mirrors spaceOf's precedence. */
const SPACE_TAGS = ["home", "school", "medical-ids", "bills-receipts"];
const spaceShown = (file) => (file.tags ?? []).find((t) => SPACE_TAGS.includes(String(t).toLowerCase())) ?? null;

test("THE ACTUAL SYMPTOM: with the client's filename guess attached, the app still shows Bills & Receipts", async () => {
  // This is the real payload. "Let Famili decide" on a camera-roll PDF sends tags:["home"]
  // AND autoFile:true — the guess is a fallback for a file that can't be read.
  const r = await upload("IMG_5150.pdf", HOME_DEPOT_RECEIPT, { autoFile: true, tags: ["home"] });
  assert.equal(r.data.autoFiled, "bills-receipts");
  assert.equal(spaceShown(r.data.file), "bills-receipts",
    "the app takes the FIRST space tag — a superseded guess left in front of the answer is the bug");
  assert.ok(!r.data.file.tags.includes("home"), "a guess that has been overruled must not survive");
});

test("a superseded guess goes; a tag that has nothing to do with filing stays", async () => {
  // "sensitive" controls visibility, not category. Losing it while re-filing would silently
  // widen who can see a medical document.
  const r = await upload("IMG_4020.pdf", HOME_DEPOT_RECEIPT, { autoFile: true, tags: ["home", "sensitive"] });
  assert.equal(spaceShown(r.data.file), "bills-receipts");
  assert.ok(r.data.file.tags.includes("sensitive"), "visibility is not a filing decision");
});

test("when the contents say nothing, the client's guess is left exactly as it was", async () => {
  // The fallback has to still work. Auto-filing replaces a guess it can BEAT — it doesn't
  // clear the record just because it was asked to look.
  const r = await upload("notes2.txt", "Paint colours for the hallway. Ask about the gutters.", { autoFile: true, tags: ["home"] });
  assert.equal(r.data.autoFiled, undefined, "nothing matched, so nothing was claimed");
  assert.equal(spaceShown(r.data.file), "home", "and the guess survives as the fallback it is");
});

test("a school note still goes to School", async () => {
  const r = await upload("scan.pdf", "PERMISSION SLIP — Mrs. Alvarez's class field trip. Please sign and return to the school office by Friday.", { autoFile: true });
  assert.equal(r.data.autoFiled, "school");
});

test("a prescription still goes to Medical", async () => {
  const r = await upload("scan2.pdf", "PRESCRIPTION — Patient: A. Harper. Prescribing doctor: Dr. Nguyen. Refills: 2. Pharmacy copy.", { autoFile: true });
  assert.equal(r.data.autoFiled, "medical-ids");
});

test("something genuinely about the house is left alone, not forced into a category", async () => {
  // The fallback still has to work: not everything is a receipt, and a wrong confident answer
  // is worse than the honest default.
  const r = await upload("notes.txt", "Paint colours for the hallway and the spare room. Ask about the gutters.", { autoFile: true });
  assert.equal(r.data.autoFiled, undefined, "nothing matched, so nothing was claimed");
});

test("an EXPLICIT choice is never second-guessed", async () => {
  // Auto-filing only runs for "let Famili decide". Overriding someone who picked a space would
  // be the app deciding it knows better than the person who filed it.
  const r = await upload("receipt.pdf", HOME_DEPOT_RECEIPT, { tags: ["home"] });
  assert.equal(r.data.autoFiled, undefined);
  assert.deepEqual(r.data.file.tags, ["home"]);
});

test("a file that can't be read still uploads — filing is a convenience, not a gate", async () => {
  const r = await adult.req("/api/files", {
    method: "POST",
    body: JSON.stringify({ name: "blob.bin", contentBase64: "AAAA", mime: "application/octet-stream", autoFile: true }),
  });
  assert.equal(r.status, 200, "the upload must survive a failed read");
  assert.ok(r.data.file.id);
});
