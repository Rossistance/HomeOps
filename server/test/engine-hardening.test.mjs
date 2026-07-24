// R1 engine hardening: stalled-run sweeper + approval double-decide race.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner, store, engine;
before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex"); // Owner
  // ISS-001 fix: bind THIS process's store/engine modules to the spawned
  // server's isolated temp data dir — never the live server/.data. The env
  // assignment must precede the first import of ../store.mjs in this process
  // (harness.mjs pre-sets a throwaway dir, but the stall test needs the SAME
  // dir the server under test uses; SQLite WAL is safely multi-process).
  process.env.HOMEOPS_DATA_DIR = ctx.dataDir;
  store = await import("../store.mjs");
  engine = await import("../engine.mjs");
});
after(async () => { await stopServer(ctx); });

test("a run silent for 30+ minutes is swept to failed('stalled'), never spins forever", async () => {
  // Craft a stuck run directly in the store the server under test reads.
  const staleISO = new Date(Date.now() - 45 * 60_000).toISOString();
  store.createRun({
    id: "run_stalltest", householdId: "local", actorId: "m-alex", source: "manual", sourceRef: {},
    title: "Stall test", status: "running", cursor: 0,
    steps: [{ index: 0, toolId: null, title: "hung step", detail: "", status: "running", input: {} }],
  });
  store.patchRun("run_stalltest", { note: "age me" }); // sets updatedAt = now
  // Force the record to look old (patch would refresh updatedAt, so write low-level).
  const run = store.getRun("run_stalltest");
  run.updatedAt = staleISO;
  store.createRun(run); // createRun = put by id (overwrite with aged copy)

  await engine.expireStaleRuns();
  const after1 = store.getRun("run_stalltest");
  assert.equal(after1.status, "failed", JSON.stringify({ status: after1.status, updatedAt: after1.updatedAt }));
  assert.equal(after1.error, "stalled");
  assert.match(String(after1.steps[0].detail ?? ""), /stalled/i);
});

// Each expireStaleRuns job used to end in `.catch(() => {})`, so a job that threw
// vanished completely: the run stayed parked with no log line, no audit entry and
// no retry — the only symptom was that nothing ever happened. (Real trigger: a
// SQLITE_BUSY thrown by patchRun/patchRunStep under a concurrent writer, found via
// a flaky test whose sole evidence was a bare assertion failure. That race can't be
// forced deterministically in-process, so this uses a malformed run record — no
// `steps` — to make the same job throw at the same place.)
test("a sweep job that throws is recorded, and the rest of the sweep still runs", async () => {
  const staleISO = new Date(Date.now() - 45 * 60_000).toISOString();
  // Throws inside the job on `run.steps[run.cursor]`.
  store.createRun({
    id: "run_sweep_thrower", householdId: "local", actorId: "m-alex", source: "manual", sourceRef: {},
    title: "Malformed run", status: "running", cursor: 0, updatedAt: staleISO,
  });
  // Swept in the SAME tick: one bad run must never abort the sweep for the rest.
  store.createRun({
    id: "run_sweep_survivor", householdId: "local", actorId: "m-alex", source: "manual", sourceRef: {},
    title: "Stalled alongside a thrower", status: "running", cursor: 0, updatedAt: staleISO,
    steps: [{ index: 0, toolId: null, title: "hung step", detail: "", status: "running", input: {} }],
  });

  const logged = [];
  const realError = console.error;
  console.error = (...a) => { logged.push(a.map((x) => String(x?.message ?? x)).join(" ")); };
  try {
    await engine.expireStaleRuns(); // must RESOLVE: a throwing job can't reject the sweep
  } finally { console.error = realError; }

  assert.equal(store.getRun("run_sweep_survivor").status, "failed", "a throwing job must not stop other runs from being swept");
  assert.ok(logged.some((l) => l.includes("run_sweep_thrower")), `expected the failure logged with its runId; got ${JSON.stringify(logged)}`);
  const entry = store.readAudit(500).find((e) => e.type === "run.sweep_failed" && e.runId === "run_sweep_thrower");
  assert.ok(entry, "a swallowed sweep failure must leave an audit entry");
  assert.equal(entry.sweep, "stall", JSON.stringify(entry));
  assert.ok(String(entry.error ?? "").length > 0, `the entry must carry the underlying error: ${JSON.stringify(entry)}`);

  store.deleteRun("run_sweep_thrower"); // else every later sweep in this file re-throws
});

test("a half-swept stalled run is finished on the next tick, not hidden by its own write", async () => {
  // The partial-write state: the step patch landed, the run patch threw. That write
  // refreshed `updatedAt`, so the 30-minute silence gate alone would hide this run —
  // still claiming to be running — for a further 30 minutes. The detail is spelled
  // out here on purpose: it IS the contract the sweep reads back, so changing the
  // copy in engine.mjs must break this test loudly.
  const stallDetail = "Run stalled (no progress for 30 minutes) — stopped so it doesn't hang forever. Retry when ready.";
  store.createRun({
    id: "run_half_swept", householdId: "local", actorId: "m-alex", source: "manual", sourceRef: {},
    title: "Half-swept", status: "running", cursor: 0, updatedAt: new Date().toISOString(),
    steps: [{ index: 0, toolId: null, title: "hung step", detail: stallDetail, status: "failed", input: {} }],
  });
  // Control: a genuinely fresh, healthy run must never be caught by that shortcut.
  store.createRun({
    id: "run_fresh_healthy", householdId: "local", actorId: "m-alex", source: "manual", sourceRef: {},
    title: "Fresh and running", status: "running", cursor: 0, updatedAt: new Date().toISOString(),
    steps: [{ index: 0, toolId: null, title: "working", detail: "", status: "running", input: {} }],
  });

  await engine.expireStaleRuns();

  const half = store.getRun("run_half_swept");
  assert.equal(half.status, "failed", "a run the sweep half-expired must be finished, not re-hidden for another 30 minutes");
  assert.equal(half.error, "stalled");
  assert.equal(store.getRun("run_fresh_healthy").status, "running", "the shortcut must never grab a run that is genuinely making progress");
});

test("double-deciding one approval: first decision wins, second is refused", async () => {
  const created = await owner.req("/api/approvals", {
    method: "POST",
    body: JSON.stringify({ toolId: "gmail.send", input: { note: "race" }, category: "Race test", preview: "Race test approval" }),
  });
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const id = created.data.approval.id;
  const [a, b] = await Promise.all([
    owner.req(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision: "deny" }) }),
    owner.req(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify({ decision: "approve" }) }),
  ]);
  const statuses = [a, b].map((r) => r.data.approval?.status ?? r.data.error);
  // Exactly one clean decision; the other must surface an already-decided error
  // (or echo the same final status) — and the record must hold ONE final state.
  const final = await owner.req("/api/approvals");
  const rec = (final.data.approvals ?? []).find((x) => x.id === id);
  assert.ok(["denied", "approved"].includes(rec.status), JSON.stringify(rec));
  const decidedCount = statuses.filter((s) => s === rec.status).length;
  assert.ok(decidedCount >= 1, JSON.stringify(statuses));
  assert.ok(!(statuses[0] === "approved" && statuses[1] === "denied") && !(statuses[0] === "denied" && statuses[1] === "approved"),
    `both decisions were accepted with different outcomes: ${JSON.stringify(statuses)}`);
});
