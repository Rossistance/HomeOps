// CONFLICT RESOLUTION — the human half of two-way Google sync. When a pull flags
// provenance.conflict (both sides changed), POST /api/events/:id/resolve-conflict
// applies the user's choice: adopt Google's version or keep the FamiliOS one. Either
// way the flag clears and the baseline resets so the next pull doesn't re-flag.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";
import { resolveConflictPatch, mergeGoogleEdit } from "../calendar.mjs";

let ctx, adult, child;
before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan"); // Adult Admin
  child = await makeSession(ctx, "m-noah");   // Child View
});
after(async () => { await stopServer(ctx); });

const CONFLICT = {
  at: Date.parse("2026-07-03T12:00:00Z"),
  googleUpdated: "2026-07-03T11:59:00.000Z",
  google: { title: "Dentist (moved)", startAt: "2026-07-10T17:00:00.000Z", endAt: "2026-07-10T18:00:00.000Z", location: "Elm St" },
};

test("pure: choice=google adopts Google's fields and clears the flag", () => {
  const ev = { title: "Dentist", provenance: { googleEventId: "g1", conflict: CONFLICT } };
  const p = resolveConflictPatch(ev, "google");
  assert.equal(p.title, "Dentist (moved)");
  assert.equal(p.startAt, "2026-07-10T17:00:00.000Z");
  assert.equal(p.provenance.conflict, null);
  assert.equal(p.provenance.lastGoogleUpdated, CONFLICT.googleUpdated);
  assert.ok(p.provenance.lastMergeAt > 0, "baseline reset so the next pull is clean");
});

test("pure: choice=local keeps FamiliOS fields, clears the flag, resets the baseline", () => {
  const ev = { title: "Dentist for Noah", provenance: { googleEventId: "g1", conflict: CONFLICT } };
  const p = resolveConflictPatch(ev, "local");
  assert.equal(p.title, undefined, "no field changes — local version stands");
  assert.equal(p.provenance.conflict, null);
  // The decision engine must NOT re-flag the same Google state after a local keep.
  const after1 = { ...ev, ...p, updatedAt: new Date(p.provenance.lastMergeAt).toISOString() };
  const gev = { id: "g1", status: "confirmed", summary: "Dentist (moved)", location: "Elm St",
    start: { dateTime: "2026-07-10T17:00:00.000Z" }, end: { dateTime: "2026-07-10T18:00:00.000Z" },
    updated: CONFLICT.googleUpdated };
  assert.equal(mergeGoogleEdit({ ev: after1, gev }).action, "none");
});

test("pure: no conflict or bad choice → null (route turns this into a 400)", () => {
  assert.equal(resolveConflictPatch({ provenance: {} }, "google"), null);
  assert.equal(resolveConflictPatch({ provenance: { conflict: CONFLICT } }, "both"), null);
});

test("route: resolves a real flagged event end-to-end (google choice)", async () => {
  const created = await adult.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Dentist", startAt: "2026-07-10T15:00:00.000Z" }) });
  assert.equal(created.status, 200);
  const id = created.data.event.id;
  // Flag it the way pullGoogleEdits does (PATCH carries provenance in this build).
  const flagged = await adult.req(`/api/events/${id}`, { method: "PATCH", body: JSON.stringify({ provenance: { googleEventId: "g1", conflict: CONFLICT } }) });
  assert.equal(flagged.status, 200);

  const denied = await child.req(`/api/events/${id}/resolve-conflict`, { method: "POST", body: JSON.stringify({ choice: "google" }) });
  assert.equal(denied.status, 403, "children can't resolve sync conflicts");

  const r = await adult.req(`/api/events/${id}/resolve-conflict`, { method: "POST", body: JSON.stringify({ choice: "google" }) });
  assert.equal(r.status, 200);
  assert.equal(r.data.event.title, "Dentist (moved)");
  assert.equal(r.data.event.provenance.conflict, null);

  const again = await adult.req(`/api/events/${id}/resolve-conflict`, { method: "POST", body: JSON.stringify({ choice: "google" }) });
  assert.equal(again.status, 400);
  assert.equal(again.data.error, "no_conflict");
});
