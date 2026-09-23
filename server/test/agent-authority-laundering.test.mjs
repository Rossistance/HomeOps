// Buttons that handed out authority nobody granted.
//
// unattended-stamp.test.mjs holds the line at the write path: `unattended.setByRole` is
// written by the server from a real session, never accepted from a body, because that claim is
// the whole basis on which policy.mjs rule 6b lets a helper send without asking.
//
// TWO OF THE THREE DOORS ARE NOW BRICKED UP, and that is the fix rather than a loss of
// coverage. Duplicate spread the source record verbatim, so a copy arrived already holding the
// Owner's blanket send authority, stamped with the Owner's name and a timestamp from before
// the copy existed — created by whoever clicked the button, with no PIN and no re-decision.
// Rollback restored a snapshot verbatim, so because REVOKING the grant is itself recorded as a
// new version, "restore previous version" turned it back on; revocation another button
// silently undoes is not revocation. A helper has no duplicate and no rollback: there is no
// version history to restore, and the autonomy dial is re-derived from the session on every
// write that names it. The history is kept here because the SHAPE of both bugs — a write path
// that copies an authority field instead of deciding it — is what a new one would look like.
//
// THE THIRD DOOR IS STILL A DOOR, and it is the one this file now guards: `sourceRef`. The
// engine reads `sourceRef.agentId` to decide whose tool policy applies and, since WP-005,
// whose standing send consent applies. POST /api/runs/start forwarded the caller's sourceRef
// verbatim, so anyone could name any helper and inherit its authority — after reading the
// allowlists straight off GET /api/contact-methods. That turns "the allowlist IS the approval"
// into "the caller picks their own identity", which is not an allowlist at all.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, owner, kid, helper;

const PLAN = (input) => ({
  title: "TG-laundering",
  summary: "",
  steps: [{ toolId: "homeops.notify_contact", title: "Send", detail: "", input, requiresApproval: false }],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitTerminal(as, runId, extra = [], timeoutMs = 25000) {
  const terminal = ["completed", "failed", "cancelled", "expired", ...extra];
  const t0 = Date.now();
  let run = null;
  while (Date.now() - t0 < timeoutMs) {
    run = (await as.req(`/api/runs/${runId}`)).data?.run ?? null;
    if (run && terminal.includes(run.status)) return run;
    await sleep(200);
  }
  return run;
}

before(async () => {
  ctx = await startServer();
  owner = await makeSession(ctx, "m-alex");      // Owner
  kid = await makeSession(ctx, "m-noah");        // Child View
  const h = await owner.req("/api/helpers", {
    method: "POST",
    body: JSON.stringify({
      name: "Errand runner",
      instructions: "Send the family's briefing to the contact method they named, and nowhere else.",
      autonomy: "full",
    }),
  });
  assert.equal(h.status, 200, JSON.stringify(h.data));
  helper = h.data.helper;
});
after(async () => { await stopServer(ctx); });

test("the grant this suite is about is real to begin with", async () => {
  // No household PIN is set here, so the Owner's grant lands unobstructed — which is the
  // starting condition every laundering route below would be trying to copy.
  assert.equal(helper.autonomy, "full");
  assert.equal(helper.autonomyText, "Does everything on its own, including sending and spending");
});

test("SOURCEREF: a hand-rolled plan lands with NO acting helper", async () => {
  const r = await owner.req("/api/runs/start", {
    method: "POST",
    body: JSON.stringify({
      plan: PLAN({ to: "somebody@example.invalid", subject: "TG", body: "TG laundering attempt body, long enough." }),
      sourceRef: { agentId: helper.id },
    }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const run = await waitTerminal(owner, r.data.run.id, ["waiting_for_approval", "waiting_for_connector"]);
  assert.equal(run.sourceRef?.agentId ?? null, null,
    "helper identity is server-assigned only — set by a helper run or a schedule, never taken from a body");
  assert.equal(run.steps[0].status, "failed");
  assert.match(String(run.steps[0].detail), /needs to run as a specific helper/i,
    "and with no identity the per-helper consent gate cannot be satisfied by anyone");
});

test("SOURCEREF: every authority-bearing field is stripped, not just agentId", async () => {
  // agentId decides whose policy and whose send consent apply; skillId is the attribution the
  // policy path keys off; triggerId/automationId decide which automation's status this run
  // writes back to. All four are server-assigned, so all four have to be dropped — a strip
  // that covers one of them is a strip somebody will route around.
  const r = await owner.req("/api/runs/start", {
    method: "POST",
    body: JSON.stringify({
      plan: PLAN({ to: "somebody@example.invalid", subject: "TG", body: "TG laundering attempt body, long enough." }),
      sourceRef: {
        agentId: helper.id, skillId: "skl_anything", triggerId: "trg_anything", automationId: "aut_anything",
        conversationId: "conv_keepme", via: "chat", isRepair: true,
      },
    }),
  });
  const run = await waitTerminal(owner, r.data.run.id, ["waiting_for_approval", "waiting_for_connector"]);
  for (const field of ["agentId", "skillId", "triggerId", "automationId"]) {
    assert.ok(run.sourceRef?.[field] == null, `${field} must not survive from a request body`);
  }
  // …while the benign correlation fields the chat layer depends on DO survive. A blanket
  // allow-list here would have broken repair and thread attribution, which is why the strip
  // names exactly the four fields the server reads to decide what a run MAY DO.
  assert.equal(run.sourceRef.conversationId, "conv_keepme", "correlation metadata is not authority");
  assert.equal(run.sourceRef.isRepair, true);
});

test("SOURCEREF (ADR-004 Stage 2): what a queued chat step was JUDGED ON is server-assigned too", async () => {
  /* channel, actorIsAdult and actorRole decide whether policy rule 4b applies when a run
   * re-judges a parked step, whether a native write waits for an adult, and the role a native
   * step runs as. A body that could set them could clear a child's park (actorIsAdult:true) or
   * run a native step as an Owner, so they are stripped with the other four. */
  const r = await owner.req("/api/runs/start", {
    method: "POST",
    body: JSON.stringify({
      plan: { title: "TG-verdict", summary: "", steps: [{ toolId: "homeops.write_memory", title: "Note", detail: "", input: { text: "TG verdict forgery probe", scope: "household" } }] },
      sourceRef: { channel: "personal", actorIsAdult: true, actorRole: "Owner", conversationId: "conv_keepme_2" },
    }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const run = await waitTerminal(owner, r.data.run.id, ["waiting_for_approval", "waiting_for_connector"]);
  for (const field of ["channel", "actorIsAdult", "actorRole"]) {
    assert.ok(run.sourceRef?.[field] == null, `${field} must not survive from a request body: ${JSON.stringify(run.sourceRef)}`);
  }
  assert.equal(run.sourceRef.conversationId, "conv_keepme_2", "and the correlation field beside them still does");
});

test("a member with no standing cannot launder the Owner's grant into a run of their own", async () => {
  // The original attack in its most direct form: read the allowlists, name the helper that is
  // on them, and post a plan. The role floor stops this one before the strip even matters —
  // both have to hold, because either alone is a single point of failure.
  const r = await kid.req("/api/runs/start", {
    method: "POST",
    body: JSON.stringify({
      plan: PLAN({ to: "somebody@example.invalid", subject: "TG", body: "TG laundering attempt body, long enough." }),
      sourceRef: { agentId: helper.id },
    }),
  });
  assert.equal(r.status, 403);
  assert.equal(r.data.error, "insufficient_role");
});

test("the strip is not vacuous — a real helper run DOES carry its identity", async () => {
  /* The failure mode a blanket strip would hide: if nothing ever had an acting helper, every
   * test above would pass and the per-helper allowlist would be dead code that always
   * refuses. A helper's own thread is where its identity shows, so this reads it back from
   * the audit trail the server writes for a helper run rather than from a request. */
  const before = (await owner.req("/api/audit")).data.events ?? [];
  await owner.req(`/api/helpers/${helper.id}/run`, { method: "POST" });
  const after = (await owner.req("/api/audit")).data.events ?? [];
  assert.ok(after.length > before.length, "the run was recorded");
  const ran = after.find((a) => a.type === "helper.run" && a.agentId === helper.id);
  assert.ok(ran, "a helper run is attributed to the helper that ran — the identity the allowlist reads");
});

test("REVOCATION IS ONE-WAY: nothing restores a grant the family turned off", async () => {
  /* What rollback used to undo. There is no snapshot to restore any more, so the property is
   * asserted where it now lives: lowering the dial removes the grant outright, and no later
   * edit that does not name autonomy can bring it back. */
  const down = await owner.req(`/api/helpers/${helper.id}`, { method: "PATCH", body: JSON.stringify({ autonomy: "ask" }) });
  assert.equal(down.data.helper.autonomy, "ask");
  const unrelated = await owner.req(`/api/helpers/${helper.id}`, { method: "PATCH", body: JSON.stringify({ purpose: "Run the errands" }) });
  assert.equal(unrelated.data.helper.autonomy, "ask", "an unrelated edit must not resurrect a revoked grant");
  assert.equal(unrelated.data.helper.purpose, "Run the errands", "…while the edit itself really did apply");
});

test("…and the mirror-image error: an unrelated edit does not silently STRIP a grant either", async () => {
  // The reason rollback could not simply derive authority from its caller. An Owner who
  // reverts a wording change has not revoked anything, and a quiet downgrade nobody asked for
  // is the same class of bug pointed the other way.
  const up = await owner.req(`/api/helpers/${helper.id}`, { method: "PATCH", body: JSON.stringify({ autonomy: "full" }) });
  assert.equal(up.data.helper.autonomy, "full");
  const rename = await owner.req(`/api/helpers/${helper.id}`, { method: "PATCH", body: JSON.stringify({ name: "Errand runner v2" }) });
  assert.equal(rename.data.helper.autonomy, "full", "the live grant survives an unrelated edit");
  assert.equal(rename.data.helper.name, "Errand runner v2");
});
