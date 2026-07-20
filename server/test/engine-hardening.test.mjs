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
