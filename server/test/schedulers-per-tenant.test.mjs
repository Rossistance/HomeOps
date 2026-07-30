// The scheduled half of the product did not run for anyone who paid for it.
//
// `forEachTenant` hands its callback the household it is running as. Two loops ignored that and
// used the RESIDENT constant instead, so they faithfully visited every household and did the
// same one N times:
//
//   sweepAccountHealth({ householdId: CURRENT_TENANT })  — so for every signed-up family an
//     account's status went on describing the last thing that happened to touch it. That is
//     exactly the "needs reconnect" that outlives the problem it names, which is the bug
//     accounts.mjs sweepAccountHealth was written to prevent.
//
//   runJob → executeTool(..., { householdId: CURRENT_TENANT })  — so rss-poll,
//     weather-morning and every connector_event trigger downstream fired only for the resident
//     household. The old comment said so and pointed at a ticket.
//
// Neither failed. Neither logged. Both looked correct at the call site, which is why this test
// asserts on the ARGUMENT each iteration receives rather than on any observable outcome — the
// defect was invisible precisely because there was no outcome to observe.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-sched-"));
const { forEachTenant, runWithTenant, currentTenant, CURRENT_TENANT, putMember } = await import("../store.mjs");

// Three households: the resident plus two that signed up.
const OTHERS = ["hh_aaaa1111", "hh_bbbb2222"];
for (const hh of OTHERS) {
  await runWithTenant(hh, () => putMember({ actorId: "m-owner", displayName: "Owner", role: "Owner", householdId: hh }));
}

test("forEachTenant visits every household and names each one", async () => {
  const seen = [];
  await forEachTenant((t) => { seen.push(t); });
  assert.ok(seen.includes(CURRENT_TENANT), "the resident household is included");
  for (const hh of OTHERS) assert.ok(seen.includes(hh), `${hh} is visited`);
  assert.equal(new Set(seen).size, seen.length, "and each exactly once");
});

test("THE BUG: a callback that ignores its argument sweeps the resident N times", async () => {
  // The shape of both defects, written out so the fix below has something to be measured
  // against. This is what the code did, and it is quiet, plausible and wrong.
  const swept = [];
  await forEachTenant(() => { swept.push(CURRENT_TENANT); });
  assert.equal(new Set(swept).size, 1, "every iteration targeted the same household…");
  assert.equal(swept.length >= 3, true, "…while the loop reported doing the work for all of them");
});

test("THE FIX: taking the argument targets each household in turn", async () => {
  const swept = [];
  await forEachTenant((t) => { swept.push(t); });
  assert.equal(new Set(swept).size, swept.length);
  for (const hh of OTHERS) assert.ok(swept.includes(hh), `${hh} is actually swept`);
});

test("the ambient tenant context matches the argument, so store reads follow too", async () => {
  // runJob's other tenant-sensitive calls — setJobState, getJobState, appendAudit,
  // connectorById — take no household and read the ambient context. They only come out right
  // if the context agrees with the id being passed explicitly.
  const mismatches = [];
  await forEachTenant((t) => { if (currentTenant() !== t) mismatches.push([t, currentTenant()]); });
  assert.deepEqual(mismatches, [], "a job that writes its state to one household and runs as another is worse than one that doesn't run");
});

test("one household throwing does not stop the rest — a per-tenant loop must be resilient", async () => {
  const done = [];
  await forEachTenant((t) => { if (t === OTHERS[0]) throw new Error("boom"); done.push(t); });
  assert.ok(done.includes(OTHERS[1]), "the household after the failure still got its turn");
  assert.ok(done.includes(CURRENT_TENANT));
});

process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch {} });
