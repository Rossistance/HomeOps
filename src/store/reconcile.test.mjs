// Regression suite for the hydrate-merge duplication bug — run with:
//   node --test src/store/reconcile.test.mjs
// (node >= 23 strips types from the imported .ts natively; no browser imports)
//
// Root cause reproduced here: on production, the server returned 41 clean events
// while the persisted client store held 511 — the SAME event (title + exact time)
// under up to 4 different ids, because Google Calendar re-syncs re-key events and
// the old merge only dropped locals whose id matched a CURRENT server id. Stale
// server-originated copies accumulated forever. mergeServerAuthoritative fixes it.
import test from "node:test";
import assert from "node:assert/strict";
import { mergeServerAuthoritative, mergeById } from "./reconcile.ts";

const srv = (id, title, at) => ({ id, serverId: id, title, startAt: at });
const local = (id, title, at, serverId) => ({ id, serverId, title, startAt: at });

test("server re-key: a churned event id is dropped, not duplicated", () => {
  // Server has ONE "Chattanooga DBT" today; the local store has 4 stale copies
  // from prior syncs (same title/time, different ids — the production symptom).
  const server = [srv("ev_new", "Chattanooga DBT", "2026-07-20T18:00:00-04:00")];
  const localStore = [
    local("ev_old1", "Chattanooga DBT", "2026-07-20T18:00:00-04:00", "ev_old1"),
    local("ev_old2", "Chattanooga DBT", "2026-07-20T18:00:00-04:00", "ev_old2"),
    local("ev_old3", "Chattanooga DBT", "2026-07-20T18:00:00-04:00", "ev_old3"),
    local("ev_new", "Chattanooga DBT", "2026-07-20T18:00:00-04:00", "ev_new"),
  ];
  const merged = mergeServerAuthoritative(server, localStore);
  assert.equal(merged.length, 1, "all stale server-originated copies drop; only the current server event remains");
  assert.equal(merged[0].id, "ev_new");
});

test("offline-created local event (no serverId) is preserved", () => {
  const server = [srv("ev_a", "Synced", "2026-07-20T10:00:00-04:00")];
  const localStore = [
    local("ev_a", "Synced", "2026-07-20T10:00:00-04:00", "ev_a"), // already synced → server copy wins
    local("event_local", "Made offline", "2026-07-21T09:00:00-04:00", undefined), // never synced → keep
  ];
  const merged = mergeServerAuthoritative(server, localStore);
  assert.equal(merged.length, 2);
  assert.ok(merged.some((e) => e.id === "event_local"), "an un-synced local draft survives");
  assert.equal(merged.filter((e) => e.id === "ev_a").length, 1, "the synced event is not duplicated");
});

test("idempotent: re-merging the server set over the result never grows it", () => {
  const server = [srv("ev1", "A", "t1"), srv("ev2", "B", "t2")];
  let store = [];
  for (let i = 0; i < 10; i++) store = mergeServerAuthoritative(server, store);
  assert.equal(store.length, 2, "ten hydrations still yield exactly the server set — no accumulation");
});

test("create-then-sync edge: the synced local copy collapses into the server copy", () => {
  // createEvent pushes a local record, then assigns serverId back onto it. Next
  // hydrate must show ONE event, not the local id + the server id.
  const server = [srv("ev_server", "Dentist", "2026-07-22T14:00:00-04:00")];
  const localStore = [local("event_localid", "Dentist", "2026-07-22T14:00:00-04:00", "ev_server")];
  const merged = mergeServerAuthoritative(server, localStore);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "ev_server");
});

test("the OLD mergeById behavior demonstrates the bug (guards against regressing back to it)", () => {
  const server = [srv("ev_new", "Chattanooga DBT", "2026-07-20T18:00:00-04:00")];
  const localStore = [
    local("ev_old1", "Chattanooga DBT", "2026-07-20T18:00:00-04:00", "ev_old1"),
    local("ev_new", "Chattanooga DBT", "2026-07-20T18:00:00-04:00", "ev_new"),
  ];
  // mergeById keeps ev_old1 (its serverId isn't in the current set) — this is the
  // exact duplication we shipped the fix to kill.
  assert.equal(mergeById(server, localStore).length, 2, "mergeById leaves the stale copy — do not use it for churn-prone records");
  assert.equal(mergeServerAuthoritative(server, localStore).length, 1, "mergeServerAuthoritative drops it");
});
