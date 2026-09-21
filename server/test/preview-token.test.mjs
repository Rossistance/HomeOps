// A signed link is necessary, and it is nowhere near sufficient.
//
// Famili confirms in the family's group chat that it added something, and a sentence is an
// unverifiable claim, so the confirmation carries a picture of the actual card rendered from
// the actual database. Taking that picture needs a headless browser to open an AUTHENTICATED
// page, and there is no share token in this codebase, so preview-token.mjs is one: a signed,
// single-purpose, two-minute grant naming exactly one record.
//
// The signing half is the easy half, and most of this file is about the other one. The route
// is unauthenticated by construction, so it never calls gate(); gate() is the only thing that
// sets the tenant, so without help every read would land in the resident household whatever
// the token says. And resolvePreview's event/task/file/meal branches gate on canSeeEntity,
// which defaults its session argument to {}, so `entity.ownerId === actorId` compares
// undefined to undefined and returns TRUE, and which never looks at householdId at all.
// Hand that combination a token minted for someone else's household and the naive handler
// hands back the resident family's calendar.
//
// So: the token drives runWithTenant, the synthetic session is complete, the member is
// re-checked, and the household is re-checked on the record itself. The test that matters is
// the one that mints a well-signed, unexpired, correctly-typed token for a household that is
// not the one holding the record, and demands a blank page.
//
// ── FIVE TESTS BELOW ARE RED, AND THE IMPLEMENTATION IS WHY ────────────────────────────
// server/index.mjs calls resolvePreview() in the /api/preview/card handler and never imports
// it. There is no `import { resolvePreview } from "./share-preview.mjs"` anywhere in that
// file; family-messages-routes.mjs is the only module that imports it. So every token that
// gets as far as rendering throws a ReferenceError, is swallowed by the top-level catch, and
// comes back as HTTP 500 {"error":"server_error","message":"resolvePreview is not defined"}.
// The happy path of this feature has never worked. The fix is one import line, and it belongs
// in server/index.mjs, which this file is not allowed to touch. Verified: with that single
// line added and nothing else changed, all 23 tests here pass. See BUG below for the chain.
//
// Two mechanical notes. The token key is derivePurposeKey("preview"), derived from the master
// key, which under HOMEOPS_SECRET_KEY is the same bytes in this process as in the spawned
// server: that is what lets a test hand-mint a token a real server will honour. And the route
// lives under /api/ on purpose: serveStatic refuses /api/* but serves the SPA shell for any
// other extensionless path, so a misspelled route at /preview/card would answer 200 with the
// app shell and a status-code assertion would prove nothing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer, stopServer, makeSession, ORIGIN } from "./harness.mjs";

// The store is imported for derivePurposeKey (preview-token.mjs pulls it in regardless), so
// this process needs its own throwaway data dir before that import, and the SAME master
// secret the harness gives every spawned server; otherwise a token minted here would be
// signed with different bytes and every HTTP case below would pass for the wrong reason.
process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-preview-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
const { derivePurposeKey } = await import("../store.mjs");
const { mintPreviewToken, readPreviewToken, PREVIEW_TTL_MS, PREVIEW_TYPES, renderPreviewCard, renderPreviewGone } =
  await import("../preview-token.mjs");

process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {} });

const NOW = 1_700_000_000_000; // a fixed instant; there is no clock injection in this suite

/* Appended to every assertion that fails for the missing import rather than for anything
 * this file got wrong. Call chain, exactly:
 *   GET /api/preview/card?t=…
 *     → readPreviewToken(t, Date.now())            ok
 *     → householdId is a known tenant              ok
 *     → runWithTenant(tok.householdId, …)
 *         → getMember(tok.actorId)                 ok
 *         → resolvePreview({type,id}, session)     ReferenceError: resolvePreview is not defined
 *     → outer catch in the request handler
 *     → json(res, 500, { error: "server_error", message: "resolvePreview is not defined" })
 * Fix: add `import { resolvePreview } from "./share-preview.mjs";` to server/index.mjs. */
const BUG = "\n\n  RED BECAUSE OF AN IMPLEMENTATION BUG, NOT A TEST BUG:\n"
  + "  server/index.mjs uses resolvePreview() in the /api/preview/card handler and never imports it.\n"
  + "  Add: import { resolvePreview } from \"./share-preview.mjs\";\n";

/** Sign an arbitrary payload the way mintPreviewToken does, to forge what mint refuses. */
function forge(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", derivePurposeKey("preview")).update(body).digest().toString("base64url");
  return `${body}.${sig}`;
}

/** Flip one character of a base64url chunk, keeping the length identical. */
const flip = (s, i = 0) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);

/* ─────────────────────── the signature, in process ─────────────────────── */

test("a minted token round-trips with its payload intact", () => {
  const m = mintPreviewToken({ householdId: "hh_round00001", actorId: "m-alex", role: "Owner", type: "event", id: "ev-42", nowMs: NOW });
  assert.equal(m.ok, true, JSON.stringify(m));
  assert.equal(m.expiresAt, NOW + PREVIEW_TTL_MS, "two minutes from the instant it was minted");

  const r = readPreviewToken(m.token, NOW);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.householdId, "hh_round00001", "the household survives the trip");
  assert.equal(r.actorId, "m-alex");
  assert.equal(r.role, "Owner", "the role is signed too: the page renders AS this person");
  assert.equal(r.type, "event");
  assert.equal(r.id, "ev-42");
  assert.equal(r.expiresAt, m.expiresAt);
});

test("an omitted role does not become an empty one", () => {
  const m = mintPreviewToken({ householdId: "hh_round00001", actorId: "m-noah", type: "task", id: "t-1", nowMs: NOW });
  assert.equal(readPreviewToken(m.token, NOW).role, "Adult Member", "a default the visibility tiers can actually use");
});

test("a tampered BODY fails: the payload is not a field a caller may edit", () => {
  const { token } = mintPreviewToken({ householdId: "hh_tamper0001", actorId: "m-alex", role: "Owner", type: "event", id: "ev-1", nowMs: NOW });
  const [body, sig] = token.split(".");
  const r = readPreviewToken(`${flip(body, 3)}.${sig}`, NOW);
  assert.equal(r.ok, false, "a rewritten household or record id must not verify");
  assert.equal(r.error, "preview_invalid");
});

test("a tampered SIGNATURE fails, and fails identically", () => {
  const { token } = mintPreviewToken({ householdId: "hh_tamper0001", actorId: "m-alex", role: "Owner", type: "event", id: "ev-1", nowMs: NOW });
  const [body, sig] = token.split(".");
  const r = readPreviewToken(`${body}.${flip(sig, 2)}`, NOW);
  assert.equal(r.ok, false);
  assert.equal(r.error, "preview_invalid", "one error shape, so this is never an oracle for what exists");
});

test("a token with no dot at all is refused rather than parsed optimistically", () => {
  for (const junk of ["", "notatoken", "abc.", ".abc", null, undefined]) {
    const r = readPreviewToken(junk, NOW);
    assert.equal(r.ok, false, `refused: ${JSON.stringify(junk)}`);
    assert.equal(r.error, "preview_invalid", `and refused the same way: ${JSON.stringify(junk)}`);
  }
});

/* ─────────────────────── the two minutes ─────────────────────── */

test("EXPIRY: a link that leaks out of a log is not a standing grant", () => {
  const { token } = mintPreviewToken({ householdId: "hh_exp000001", actorId: "m-alex", role: "Owner", type: "event", id: "ev-1", nowMs: NOW });
  assert.equal(readPreviewToken(token, NOW + PREVIEW_TTL_MS - 1).ok, true, "still good a millisecond inside the window");
  const r = readPreviewToken(token, NOW + PREVIEW_TTL_MS + 1);
  assert.equal(r.ok, false);
  assert.equal(r.error, "preview_expired", "and expired is its own answer, distinct from forged");
});

test("expiry at the exact boundary is closed, not open", () => {
  const { token } = mintPreviewToken({ householdId: "hh_exp000001", actorId: "m-alex", role: "Owner", type: "event", id: "ev-1", nowMs: NOW });
  assert.equal(readPreviewToken(token, NOW + PREVIEW_TTL_MS).error, "preview_expired", "e <= now, so the last instant is already gone");
});

/* ─────────────────────── the closed set of types ─────────────────────── */

test("a type outside PREVIEW_TYPES is refused at MINT", () => {
  for (const type of ["notification", "member", "run", "helper_update", ""]) {
    const m = mintPreviewToken({ householdId: "hh_type000001", actorId: "m-alex", role: "Owner", type, id: "x-1", nowMs: NOW });
    assert.equal(m.ok, false, `mint refused ${JSON.stringify(type)}`);
    assert.equal(m.error, "invalid_input", `and said so plainly for ${JSON.stringify(type)}`);
  }
  assert.ok(!PREVIEW_TYPES.has("notification"), "notification is resolvable by resolvePreview and still not previewable");
});

test("…and refused again at READ, even when the signature is genuine", () => {
  // The whole point of the closed set is that this link cannot be walked into a
  // general-purpose reader. A mint-side check alone would leave that to whoever calls mint.
  const token = forge({ h: "hh_type000001", a: "m-alex", r: "Owner", t: "notification", i: "n-1", e: NOW + PREVIEW_TTL_MS });
  const r = readPreviewToken(token, NOW);
  assert.equal(r.ok, false, "a genuinely signed but off-menu type must not open");
  assert.equal(r.error, "preview_invalid");
  for (const type of [...PREVIEW_TYPES]) {
    const ok = forge({ h: "hh_type000001", a: "m-alex", r: "Owner", t: type, i: "x-1", e: NOW + PREVIEW_TTL_MS });
    assert.equal(readPreviewToken(ok, NOW).ok, true, `${type} is on the menu`);
  }
});

/* ─────────────────────── the page itself ─────────────────────── */

test("the card is a complete document: no script, no external subresource", () => {
  // The in-process renderer aborts every loopback request the page makes, so anything the
  // browser would have to fetch comes back as an empty frame with no error worth reading.
  const html = renderPreviewCard({ title: "Dentist", when: "Tue 9:00 AM", where: "Maple St", who: "Noah", status: null, kindLabel: "On the calendar" });
  assert.ok(!html.includes("<script"), "no script tag");
  assert.ok(!/src=["']?http/i.test(html), "no external subresource");
  assert.ok(!html.includes("<link"), "not even a stylesheet link: the tokens are inlined");
});

test("the card escapes what it renders, because a title is family-typed text", () => {
  const html = renderPreviewCard({ title: "<img onerror=alert(1)>", kindLabel: "On the calendar" });
  assert.ok(!html.includes("<img"), "the angle brackets came back as entities");
  assert.ok(html.includes("&lt;img"), "…escaped, not stripped");
});

test("the gone page says nothing about what it refused", () => {
  const html = renderPreviewGone();
  assert.match(html, /expired/i);
  for (const leak of ["household", "hh_", "not found", "forbidden", "signature", "invalid"]) {
    assert.ok(!html.toLowerCase().includes(leak), `the failure page must not explain itself: ${leak}`);
  }
  assert.ok(!html.includes("<script"), "and it is a complete document too");
});

/* ─────────────────────── the route, against a real server ─────────────────────── */

let ctx, owner, eventId, EVENT_TITLE = "Noah orthodontist checkup";
let other; // a second REAL household, signed up through the front door

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");
  const made = await owner.req("/api/events", {
    method: "POST",
    body: JSON.stringify({
      title: EVENT_TITLE, startAt: new Date(2026, 7, 12, 16, 0).toISOString(), endAt: null,
      allDay: false, notes: "", location: "Elm Street Dental", driverId: null, whatToBring: [], visibility: "household",
    }),
  });
  assert.equal(made.status, 200, JSON.stringify(made.data));
  eventId = made.data.event.id;

  const res = await ctx.fetch("/api/signup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "stranger@example.com", password: "correct horse battery", ownerName: "Nina", householdName: "Other Family" }),
  });
  const body = await res.json();
  other = { householdId: body.session?.householdId, actorId: body.session?.actorId };
  assert.match(String(other.householdId ?? ""), /^hh_/, `a second real tenant exists: ${JSON.stringify(body)}`);
});
after(async () => { await stopServer(ctx); });

/** GET the card page as the headless renderer would: no cookie, no CSRF, nothing but a link. */
async function getCard(token) {
  const r = await ctx.fetch(`/api/preview/card?t=${encodeURIComponent(token ?? "")}`, { headers: { Origin: ORIGIN } });
  return { status: r.status, type: r.headers.get("content-type") ?? "", html: await r.text() };
}

test("a valid token for a real record in ITS OWN household renders the card", async () => {
  const { token } = mintPreviewToken({ householdId: "local", actorId: "m-alex", role: "Owner", type: "event", id: eventId });
  const page = await getCard(token);
  assert.equal(page.status, 200, `the renderer gets a page, not a redirect or an error; got ${page.status} ${page.html.slice(0, 200)}${BUG}`);
  assert.match(page.type, /^text\/html/, `and it is HTML it can screenshot${BUG}`);
  assert.ok(page.html.includes(EVENT_TITLE), `the actual record, from the actual database:\n${page.html.slice(0, 400)}${BUG}`);
  assert.ok(page.html.includes("Elm Street Dental"), `including where, which is the part a claim cannot fake${BUG}`);
});

test("THE POINT: a signed token naming a DIFFERENT household does not open this one", async () => {
  // Well-signed, unexpired, on-menu type, real record id. The ONLY thing wrong with it is the
  // household. Nothing in the generic path catches that: gate() never runs, so no tenant is
  // set; canSeeEntity(entity, {}) compares undefined to undefined on ownerId and returns true;
  // and canSeeEntity never reads householdId at all. If the handler does not drive
  // runWithTenant off the token and re-check the record's owner household, this renders the
  // resident family's calendar to a stranger holding a link.
  const { token } = mintPreviewToken({ householdId: "hh_notreal0001", actorId: "m-alex", role: "Owner", type: "event", id: eventId });
  const page = await getCard(token);
  assert.ok(!page.html.includes(EVENT_TITLE), `a token for another household must not render this one's record:\n${page.html.slice(0, 600)}`);
  assert.ok(!page.html.includes("Elm Street Dental"), "nor any other field of it");
  assert.match(page.html, /expired/i, "it gets the gone page, which explains nothing");
});

test("…and the same holds for a household that really exists", async () => {
  // hh_notreal0001 is stopped by the "is this a tenant at all" check. A REAL second household
  // gets past that one, so this is the case that actually exercises the tenant switch: the
  // token drives runWithTenant, getEvent reads the OTHER family's database, and the resident
  // event simply is not in it.
  const { token } = mintPreviewToken({ householdId: other.householdId, actorId: other.actorId, role: "Owner", type: "event", id: eventId });
  const page = await getCard(token);
  assert.ok(!page.html.includes(EVENT_TITLE), `a real stranger household must not read the resident one:\n${page.html.slice(0, 600)}`);
  // The confinement above currently holds for the WRONG reason: the handler crashes before it
  // can confine anything, so the assertion above passes vacuously. Asserting the gone page is
  // what keeps that distinction visible.
  assert.match(page.html, /expired/i, `it must be confined, not merely crashed; got ${page.status} ${page.html.slice(0, 200)}${BUG}`);
});

test("…nor does naming the OTHER household with THIS household's member", async () => {
  // The synthetic session has to be complete AND consistent: m-alex is nobody in hh_other.
  const { token } = mintPreviewToken({ householdId: other.householdId, actorId: "m-alex", role: "Owner", type: "event", id: eventId });
  const page = await getCard(token);
  assert.ok(!page.html.includes(EVENT_TITLE), "a member id from the wrong household is not a member");
  assert.match(page.html, /expired/i);
});

test("a token for the right household but a record that does not exist renders nothing", async () => {
  const { token } = mintPreviewToken({ householdId: "local", actorId: "m-alex", role: "Owner", type: "event", id: "ev-does-not-exist" });
  const page = await getCard(token);
  assert.match(page.html, /expired/i, `a missing record is a missing preview, not a crash; got ${page.status} ${page.html.slice(0, 200)}${BUG}`);
  assert.equal(page.status, 200, `and not a 500${BUG}`);
});

test("an expired token gets the gone page over HTTP too", async () => {
  const { token } = mintPreviewToken({ householdId: "local", actorId: "m-alex", role: "Owner", type: "event", id: eventId, nowMs: Date.now() - PREVIEW_TTL_MS - 1000 });
  const page = await getCard(token);
  assert.ok(!page.html.includes(EVENT_TITLE), "two minutes is two minutes");
  assert.match(page.html, /expired/i);
});

test("a forged signature over a real event id gets the gone page", async () => {
  const { token } = mintPreviewToken({ householdId: "local", actorId: "m-alex", role: "Owner", type: "event", id: eventId });
  const [body, sig] = token.split(".");
  const page = await getCard(`${body}.${flip(sig, 5)}`);
  assert.ok(!page.html.includes(EVENT_TITLE), "signing is not decoration");
});

/* ─────────────────────── why it lives under /api/ ─────────────────────── */

test("a missing token answers with the gone page, NOT the app shell", async () => {
  // serveStatic returns false for /api/*, but serves index.html for any other extensionless
  // path. A preview route at /preview/card that was misspelled or registered after the static
  // handler would answer 200 with the SPA shell, and a status-code assertion would pass while
  // the renderer screenshotted a loading spinner. So assert on the BODY.
  const page = await getCard("");
  assert.equal(page.status, 200);
  assert.match(page.type, /^text\/html/);
  assert.match(page.html, /expired/i, "this is the preview module's own page");
  assert.ok(!page.html.includes("<script"), "the app shell would be nothing but script tags");
  assert.ok(!/id=["']root["']/.test(page.html), "and it would carry the mount point");
  assert.ok(page.html.length < 2000, `a one-line document, not a bundle host: ${page.html.length} bytes`);
});

test("an unknown path under /api/ 404s as JSON rather than falling into the SPA", async () => {
  const r = await ctx.fetch("/api/preview/nonexistent", { headers: { Origin: ORIGIN } });
  assert.equal(r.status, 404, "the /api/ prefix is what makes a misspelling loud");
  const text = await r.text();
  assert.match(r.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(JSON.parse(text).error, "not_found");
  assert.ok(!text.includes("<html"), "no app shell in sight");
});

test("the rendered card carries no script and no external subresource over the wire", async () => {
  // Same rule as the unit assertion above, but on what the server actually sent: the renderer
  // aborts every loopback subresource, so a page that grew a script or a stylesheet link
  // would screenshot as an empty frame and the failure would look like a browser problem.
  const { token } = mintPreviewToken({ householdId: "local", actorId: "m-alex", role: "Owner", type: "event", id: eventId });
  const page = await getCard(token);
  assert.ok(page.html.includes(EVENT_TITLE), `precondition: this is the real card, not the gone page; got ${page.status} ${page.html.slice(0, 200)}${BUG}`);
  assert.ok(!page.html.includes("<script"), "no script tag");
  assert.ok(!/src=["']?http/i.test(page.html), "no external subresource");
  assert.equal(page.html.match(/<link/g), null, "and no stylesheet link either");
});

test("the card is never cached or indexed", async () => {
  const { token } = mintPreviewToken({ householdId: "local", actorId: "m-alex", role: "Owner", type: "event", id: eventId });
  const r = await ctx.fetch(`/api/preview/card?t=${encodeURIComponent(token)}`, { headers: { Origin: ORIGIN } });
  const body = await r.text();
  assert.match(r.headers.get("cache-control") ?? "", /no-store/,
    `a two-minute grant must not sit in a shared cache; got ${r.status} ${body.slice(0, 200)}${BUG}`);
  assert.match(r.headers.get("x-robots-tag") ?? "", /noindex/, `and it is not for search engines${BUG}`);
});
