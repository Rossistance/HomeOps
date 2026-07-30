// "Run now" runs for the family that pressed it.
//
// schedulers-per-tenant.test.mjs pins forEachTenant's contract. This pins the CALL SITE, which
// is where the bug actually lived: runJob read `CURRENT_TENANT` — a constant, not a lookup —
// for both its kill-switch check and its tool execution. A signed-up household pressing "Run
// now" therefore ran the job against the RESIDENT household's connectors and wrote the result
// into the resident's job state. Nothing errored; the screen just never changed.
//
// Job state is tenant-scoped storage, so "whose lastRun moved" is the honest observable.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, resident, signedUp;

async function signup(email, householdName) {
  const res = await ctx.fetch("/api/signup", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery", ownerName: "Sam", householdName }),
  });
  const cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  const data = await res.json();
  return {
    householdId: data.session?.householdId,
    async req(path, init = {}) {
      const headers = { Cookie: cookie, ...(init.headers || {}) };
      if (init.method && init.method !== "GET") { headers["x-homeops-csrf"] = data.session.csrf; headers["content-type"] ??= "application/json"; }
      const r = await ctx.fetch(path, { ...init, headers });
      let out = null; try { out = await r.json(); } catch { /* non-JSON */ }
      return { status: r.status, data: out };
    },
  };
}

const jobs = async (as) => (await as.req("/api/jobs")).data?.jobs ?? [];
const lastRunOf = (list, id) => list.find((j) => j.id === id)?.lastRun ?? null;

before(async () => {
  ctx = await startServer();
  resident = await makeSession(ctx, "m-alex");
  signedUp = await signup(`jobs-${Date.now()}@example.test`, "The Rivera Family");
});
after(async () => { await stopServer(ctx); });

test("a signed-up household is a different household from the resident one", () => {
  assert.ok(signedUp.householdId, "signup returned a household");
  assert.notEqual(signedUp.householdId, "local", "…and it isn't the resident tenant");
});

test("both households can see the job catalogue", async () => {
  assert.ok((await jobs(resident)).some((j) => j.id === "rss-poll"));
  assert.ok((await jobs(signedUp)).some((j) => j.id === "rss-poll"), "a paying family's jobs screen isn't empty");
});

test("\"Run now\" records the run against the household that pressed it, not another", async () => {
  // Weaker than it reads, and worth saying so: setJobState follows the AMBIENT tenant context,
  // which an HTTP request already sets correctly, so this half was never broken. It's here to
  // hold the isolation, not to demonstrate the fix. The next test is the one that does.
  const mineBefore = lastRunOf(await jobs(signedUp), "rss-poll");
  const theirsBefore = lastRunOf(await jobs(resident), "rss-poll");
  const r = await signedUp.req("/api/jobs/rss-poll/run", { method: "POST", body: "{}" });
  assert.ok(r.status === 200 || r.status === 422, `expected a real outcome, got ${r.status}`);
  // 422 is fine and expected: the RSS connector isn't configured in a fresh household, so the
  // job legitimately refuses. What matters is WHOSE record it touched on the way.
  assert.notEqual(lastRunOf(await jobs(signedUp), "rss-poll"), mineBefore);
  assert.equal(lastRunOf(await jobs(resident), "rss-poll"), theirsBefore);
});

test("THE FIX: a household's OWN kill switch stops its OWN job", async () => {
  // This is what `CURRENT_TENANT` broke, and the assertion that fails without the fix. runJob
  // asked `externalActionsEnabled(CURRENT_TENANT)` — a constant — so it consulted the RESIDENT
  // household's kill switch on behalf of whichever family pressed the button. A family could
  // hit the master stop, watch it turn off, and have their scheduled jobs keep running against
  // the outside world, because the switch being read was somebody else's.
  const off = await signedUp.req("/api/settings", { method: "POST", body: JSON.stringify({ externalActionsEnabled: false }) });
  assert.equal(off.status, 200, JSON.stringify(off.data));

  const r = await signedUp.req("/api/jobs/rss-poll/run", { method: "POST", body: "{}" });
  assert.equal(r.status, 422);
  assert.equal(r.data.result.error, "external_actions_disabled",
    "the refusal must cite THIS family's switch");
  assert.equal((await jobs(signedUp)).find((j) => j.id === "rss-poll")?.lastStatus, "blocked_kill_switch");
});

test("…and does not stop anybody else's", async () => {
  // The mirror error: one family pausing everything must not pause the whole deployment.
  const r = await resident.req("/api/jobs/rss-poll/run", { method: "POST", body: "{}" });
  const status = (await jobs(resident)).find((j) => j.id === "rss-poll")?.lastStatus;
  assert.notEqual(status, "blocked_kill_switch", `the resident household never turned its switch off (got ${status}, http ${r.status})`);
});
