// MERGE-BACK (Phase 9) — Google → HomeOps edits for pushed canonical events.
// The decision logic is pure (mergeGoogleEdit) and fully covered by fixtures; the
// route is covered for role gating + the no-account guard (a live Google account
// is required to exercise the network half and isn't available in this env).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";
import { mergeGoogleEdit } from "../calendar.mjs";

let ctx, adult, child;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-noah");   // Child View
});
after(async () => { await stopServer(ctx); });

const PUSHED_AT = Date.parse("2026-07-01T12:00:00Z");
const baseEv = {
  id: "ev_x", title: "Dentist", startAt: "2026-07-10T15:00:00.000Z", endAt: "2026-07-10T16:00:00.000Z",
  location: "Main St", updatedAt: new Date(PUSHED_AT).toISOString(), // untouched since push
  provenance: { googleEventId: "g1", pushedAt: PUSHED_AT },
};
const gev = (over = {}) => ({
  id: "g1", status: "confirmed", summary: "Dentist", location: "Main St",
  start: { dateTime: "2026-07-10T15:00:00.000Z" }, end: { dateTime: "2026-07-10T16:00:00.000Z" },
  updated: new Date(PUSHED_AT + 1000).toISOString(), // ≈ our own push echo
  ...over,
});

test("no differences → none", () => {
  assert.equal(mergeGoogleEdit({ ev: baseEv, gev: gev() }).action, "none");
});

test("Google-side edit with no local change → merge with Google's fields", () => {
  const d = mergeGoogleEdit({ ev: baseEv, gev: gev({ summary: "Dentist (moved)", start: { dateTime: "2026-07-10T17:00:00.000Z" }, updated: new Date(PUSHED_AT + 3600e3).toISOString() }) });
  assert.equal(d.action, "merge");
  assert.equal(d.fields.title, "Dentist (moved)");
  assert.equal(d.fields.startAt, "2026-07-10T17:00:00.000Z");
});

test("both sides changed since push → conflict, never a silent overwrite", () => {
  const ev = { ...baseEv, title: "Dentist for Noah", updatedAt: new Date(PUSHED_AT + 1800e3).toISOString() }; // local edit
  const d = mergeGoogleEdit({ ev, gev: gev({ summary: "Dentist (moved)", updated: new Date(PUSHED_AT + 3600e3).toISOString() }) });
  assert.equal(d.action, "conflict");
  assert.equal(d.fields.title, "Dentist (moved)", "Google's version is captured for review");
});

test("local-only edit (Google unchanged since push) → none — pull never clobbers pending local edits", () => {
  const ev = { ...baseEv, title: "Dentist for Noah", updatedAt: new Date(PUSHED_AT + 1800e3).toISOString() };
  assert.equal(mergeGoogleEdit({ ev, gev: gev({ summary: "Dentist" }) }).action, "none");
});

test("Google deletion/cancellation → unlink (HomeOps event survives as canonical)", () => {
  assert.equal(mergeGoogleEdit({ ev: baseEv, gev: null }).action, "unlinked");
  assert.equal(mergeGoogleEdit({ ev: baseEv, gev: gev({ status: "cancelled" }) }).action, "unlinked");
});

test("a previous merge resets the baseline: same Google update doesn't re-apply", () => {
  const mergedAt = PUSHED_AT + 3600e3;
  const ev = { ...baseEv, title: "Dentist (moved)", updatedAt: new Date(mergedAt).toISOString(), provenance: { ...baseEv.provenance, lastMergeAt: mergedAt, lastGoogleUpdated: new Date(mergedAt - 5e3).toISOString() } };
  const d = mergeGoogleEdit({ ev, gev: gev({ summary: "Dentist (moved)", updated: new Date(mergedAt - 5e3).toISOString() }) });
  assert.equal(d.action, "none");
});

test("route: child is refused; adult without a Google account gets the guided 422", async () => {
  const denied = await child.req("/api/calendar/pull-google-edits", { method: "POST" });
  assert.equal(denied.status, 403);
  const r = await adult.req("/api/calendar/pull-google-edits", { method: "POST" });
  assert.equal(r.status, 422);
  assert.equal(r.data.error, "no_account");
});
