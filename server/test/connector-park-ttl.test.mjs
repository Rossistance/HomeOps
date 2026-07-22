// WP-011 (ISS-017): waiting_for_connector runs used to park forever — no TTL at all.
// This pins the sweep added to engine.mjs expireStaleRuns():
//   - a NEW park (updatedAt after the feature epoch) past HOMEOPS_CONNECTOR_PARK_TTL_DAYS
//     is expired with an honest reason + an in-app notification.
//   - a LEGACY park (updatedAt before the feature epoch — e.g. the resident household's
//     long-stuck runs) is grandfathered and left alone UNLESS HOMEOPS_SWEEP_LEGACY_PARKED=1.
//   - approval-parked behavior (the existing sweep) is unchanged.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner, store, engine;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex"); // Owner
  // Same isolation pattern as engine-hardening.test.mjs: bind this process's
  // store/engine modules to the spawned server's temp data dir, never server/.data.
  process.env.HOMEOPS_DATA_DIR = ctx.dataDir;
  store = await import("../store.mjs");
  engine = await import("../engine.mjs");
});
after(async () => {
  delete process.env.HOMEOPS_CONNECTOR_PARK_TTL_DAYS;
  delete process.env.HOMEOPS_SWEEP_LEGACY_PARKED;
  await stopServer(ctx);
});

function parkedRun(id, { ageMs, toolId = "gmail.search" }) {
  store.createRun({
    id, householdId: "local", actorId: "m-alex", source: "manual", sourceRef: {},
    title: `Connector park test ${id}`, status: "waiting_for_connector", cursor: 0,
    steps: [{ index: 0, toolId, title: "check gmail", detail: "Gmail isn't connected yet.", status: "blocked", input: {} }],
  });
  const run = store.getRun(id);
  run.updatedAt = new Date(Date.now() - ageMs).toISOString();
  store.createRun(run); // overwrite with the aged copy, same trick as the stall test
  return run;
}

test("a NEW connector-park past the TTL is expired with an honest reason + in-app notification", async () => {
  // The feature epoch baked into engine.mjs is a fixed calendar date (2026-07-22).
  // To genuinely exercise "parked AFTER the epoch, AND past its TTL" without the
  // test's pass/fail depending on how many real days have elapsed since that date,
  // use a tiny fractional-day TTL (~9s) so a run aged a few minutes past the epoch
  // is unambiguously BOTH post-epoch and TTL-expired.
  process.env.HOMEOPS_CONNECTOR_PARK_TTL_DAYS = "0.0001";
  delete process.env.HOMEOPS_SWEEP_LEGACY_PARKED;
  parkedRun("run_park_new_expired", { ageMs: 5 * 60_000 }); // 5 minutes old

  await engine.expireStaleRuns();

  const run = store.getRun("run_park_new_expired");
  assert.equal(run.status, "expired", JSON.stringify(run));
  assert.equal(run.error, "connector_park_expired");
  assert.match(String(run.steps[0].detail ?? ""), /expired — needed the Google connection/);

  const ntfs = store.listNotifications((n) => n.householdId === "local" && n.actorId === "m-alex");
  const match = ntfs.find((n) => String(n.body ?? "").includes("run_park_new_expired") || String(n.title ?? "").includes("expired waiting for a connection"));
  assert.ok(match, `expected an in-app notification about the expired park; got ${JSON.stringify(ntfs.map((n) => n.title))}`);
});

test("a connector-park inside the TTL window is left alone", async () => {
  process.env.HOMEOPS_CONNECTOR_PARK_TTL_DAYS = "7";
  delete process.env.HOMEOPS_SWEEP_LEGACY_PARKED;
  parkedRun("run_park_new_fresh", { ageMs: 2 * 24 * 60 * 60_000 }); // 2 days old

  await engine.expireStaleRuns();

  const run = store.getRun("run_park_new_fresh");
  assert.equal(run.status, "waiting_for_connector", JSON.stringify(run));
});

test("a LEGACY connector-park (parked before the feature epoch) is grandfathered by default", async () => {
  process.env.HOMEOPS_CONNECTOR_PARK_TTL_DAYS = "7";
  delete process.env.HOMEOPS_SWEEP_LEGACY_PARKED;
  store.createRun({
    id: "run_park_legacy", householdId: "local", actorId: "m-alex", source: "manual", sourceRef: {},
    title: "Legacy connector park", status: "waiting_for_connector", cursor: 0,
    steps: [{ index: 0, toolId: "gmail.search", title: "check gmail", detail: "Gmail isn't connected yet.", status: "blocked", input: {} }],
  });
  const run = store.getRun("run_park_legacy");
  // Predates the 2026-07-22 feature epoch baked into engine.mjs — simulates the
  // resident household's months-old stuck runs.
  run.updatedAt = "2026-01-01T00:00:00.000Z";
  store.createRun(run);

  await engine.expireStaleRuns();

  const after1 = store.getRun("run_park_legacy");
  assert.equal(after1.status, "waiting_for_connector", "a pre-epoch park must not be swept without HOMEOPS_SWEEP_LEGACY_PARKED=1");

  // Now opt in explicitly — the same run becomes eligible.
  process.env.HOMEOPS_SWEEP_LEGACY_PARKED = "1";
  await engine.expireStaleRuns();
  const after2 = store.getRun("run_park_legacy");
  assert.equal(after2.status, "expired", "with HOMEOPS_SWEEP_LEGACY_PARKED=1 the legacy park must be swept");
  assert.match(String(after2.steps[0].detail ?? ""), /expired — needed the Google connection/);
});

test("approval-parked (waiting_for_approval) sweep behavior is unchanged by the connector-park TTL", async () => {
  delete process.env.HOMEOPS_SWEEP_LEGACY_PARKED;
  const created = await owner.req("/api/approvals", {
    method: "POST",
    body: JSON.stringify({ toolId: "gmail.send", input: { note: "ttl-regression" }, category: "TTL regression", preview: "TTL regression approval" }),
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const approvalId = created.data.approval.id;
  // Force the approval itself to look expired (its own 30-min TTL lapsed) via the
  // same readJSON/writeJSON store owns approvals.json with — no other setter exists.
  const approvals = store.readJSON("approvals.json", {});
  approvals[approvalId].expiresAt = Date.now() - 1000;
  store.writeJSON("approvals.json", approvals);

  store.createRun({
    id: "run_approval_ttl_regression", householdId: "local", actorId: "m-alex", source: "manual", sourceRef: {},
    title: "Approval TTL regression", status: "waiting_for_approval", cursor: 0,
    steps: [{ index: 0, toolId: "gmail.send", title: "send", detail: "", status: "waiting_for_approval", approvalId, input: {} }],
  });

  await engine.expireStaleRuns();
  const after1 = store.getRun("run_approval_ttl_regression");
  // The approval's own TTL lapsed, so the existing approval-park sweep should still
  // move this run to expired — proving the new connector-park loop didn't disturb it.
  assert.equal(after1.status, "expired", JSON.stringify(after1));
  assert.equal(after1.error, "approval_expired");
});
