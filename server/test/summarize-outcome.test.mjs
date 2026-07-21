// FamiliOS — WP-002 (Honest delivery), slice 1: summarizeOutcome / runOutcomeText
// TRUTH TABLE. Pure unit tests over fabricated run objects — no server, no tenant,
// no AI provider. Proves the old false-success seam is gone: summarizeOutcome used to
// infer "delivered" from `requiresApproval` OR a name-sniffing regex
// (/send|notify|email|sms|post|deliver/i) against the toolId, which is exactly how
// homeops.send_notification_draft — a review-only DRAFT tool whose id merely CONTAINS
// "send_notification" — got reported as delivered when it only ever wrote a draft
// artifact. "Delivered" is now decided by ONE explicit `delivers` flag on the tool's
// own definition (internal-functions.mjs / providers.mjs / connectors.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

// assistant-runs.mjs transitively imports ./store.mjs, which refuses to open the
// live server/.data from a test process unless HOMEOPS_DATA_DIR already points at an
// isolated temp dir (see harness.mjs). This file never actually touches the store
// (summarizeOutcome/runOutcomeText are pure functions over a plain run object), but
// the guard trips on import alone, so satisfy it the same way harness.mjs does.
if (!process.env.HOMEOPS_DATA_DIR) {
  process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-test-proc-"));
}

const { summarizeOutcome, runOutcomeText } = await import("../assistant-runs.mjs");

function run(overrides = {}) {
  return { title: "TG-test run", status: "completed", steps: [], ...overrides };
}

test("draft-only: a succeeded draft step is never reported as delivered", () => {
  const r = run({
    steps: [
      { index: 0, toolId: "homeops.send_notification_draft", title: "Draft a notification", status: "succeeded", requiresApproval: false, result: { id: "art_1", draft: true, to: "coach@example.com" } },
    ],
  });
  const o = summarizeOutcome(r);
  assert.equal(o.delivered.length, 0, "a draft must never count as delivered");
  assert.equal(o.drafted.length, 1, "the draft tool must be classified as drafted");
  assert.equal(o.anyEffect, false);
  assert.equal(o.anyDraft, true);
  const text = runOutcomeText(r);
  assert.doesNotMatch(text, /delivered \d/i, "must never claim a delivered count");
  assert.match(text, /drafted/i);
  assert.match(text, /review/i);
  assert.match(text, /nothing was sent externally/i);
});

test("notify success (in-app): a succeeded notify_contact step counts as delivered and names the channel", () => {
  const r = run({
    steps: [
      { index: 0, toolId: "homeops.notify_contact", title: "Send to a contact method", status: "succeeded", requiresApproval: false, result: { delivered: true, channel: "in_app", methodId: "cm_1", message: "Shown in the app." } },
    ],
  });
  const o = summarizeOutcome(r);
  assert.equal(o.delivered.length, 1);
  assert.equal(o.drafted.length, 0);
  const text = runOutcomeText(r);
  assert.match(text, /delivered 1 step/i);
  assert.match(text, /in-app/i);
  assert.doesNotMatch(text, /nothing was sent externally/i);
});

test("gmail send: a succeeded gmail.send step counts as delivered and names the email channel", () => {
  const r = run({
    steps: [
      { index: 0, toolId: "gmail.send", title: "Send email", status: "succeeded", requiresApproval: true, result: { sent: true, id: "msg_1", to: "family@example.com" } },
    ],
  });
  const o = summarizeOutcome(r);
  assert.equal(o.delivered.length, 1);
  const text = runOutcomeText(r);
  assert.match(text, /delivered 1 step/i);
  assert.match(text, /email/i);
});

test("sms send: a succeeded sms.send step counts as delivered and names the text channel", () => {
  const r = run({
    steps: [
      { index: 0, toolId: "sms.send", title: "Send text", status: "succeeded", requiresApproval: true, result: { sent: true, sid: "SM1", to: "+15550000000" } },
    ],
  });
  const o = summarizeOutcome(r);
  assert.equal(o.delivered.length, 1);
  const text = runOutcomeText(r);
  assert.match(text, /delivered 1 step/i);
  assert.match(text, /text/i);
});

test("toolless step: a reasoning-only step is never delivered or drafted", () => {
  const r = run({
    steps: [
      { index: 0, toolId: null, title: "Compose the briefing", status: "succeeded", result: { text: "Composed the briefing." } },
    ],
  });
  const o = summarizeOutcome(r);
  assert.equal(o.delivered.length, 0);
  assert.equal(o.drafted.length, 0);
  assert.equal(o.composed.length, 1);
  const text = runOutcomeText(r);
  assert.doesNotMatch(text, /delivered \d/i);
  assert.doesNotMatch(text, /drafted/i);
  assert.match(text, /finished \(1\/1/);
});

test("mixed draft+deliver: only the real send counts as delivered, the draft is named separately", () => {
  const r = run({
    steps: [
      { index: 0, toolId: "homeops.send_notification_draft", title: "Draft a notification", status: "succeeded", requiresApproval: false, result: { id: "art_2", draft: true } },
      { index: 1, toolId: "gmail.send", title: "Send email", status: "succeeded", requiresApproval: true, result: { sent: true, id: "msg_2", to: "family@example.com" } },
    ],
  });
  const o = summarizeOutcome(r);
  assert.equal(o.delivered.length, 1, "only the real send is delivered");
  assert.equal(o.drafted.length, 1, "the draft is tracked separately");
  const text = runOutcomeText(r);
  assert.match(text, /delivered 1 step/i);
  assert.doesNotMatch(text, /delivered 2/i, "the draft must never be rolled into the delivered count");
  assert.match(text, /1 more step drafted/i, "the draft must still be named honestly");
});

test("failed deliver step: a failed send is never counted as delivered, and the run reports the failure honestly", () => {
  const r = run({
    status: "failed", error: "provider_error",
    steps: [
      { index: 0, toolId: "gmail.send", title: "Send email", status: "failed", requiresApproval: true, detail: "Gmail rejected the send." },
    ],
  });
  const o = summarizeOutcome(r);
  assert.equal(o.delivered.length, 0, "a failed step must never count as delivered, regardless of the tool");
  assert.equal(o.failed.length, 1);
  const text = runOutcomeText(r);
  assert.doesNotMatch(text, /delivered/i, "a failed run must never claim delivery");
  assert.match(text, /failed at step 1/i);
});

test("the old name-sniffing regex is gone: a toolId merely containing \"send\"/\"notify\" is not enough on its own", () => {
  // homeops.send_notification_draft matches the OLD /send|notify|email|sms|post|deliver/i
  // regex on its id alone — this is the exact false-success bug this WP fixes.
  const r = run({
    steps: [
      { index: 0, toolId: "homeops.send_notification_draft", title: "Draft a notification", status: "succeeded", requiresApproval: false, result: { id: "art_3", draft: true } },
    ],
  });
  const o = summarizeOutcome(r);
  assert.equal(o.anyEffect, false, "a draft-only run must not claim any external effect");
});

test("the old requiresApproval heuristic is gone: an approval-gated but non-delivering step is never counted as delivered", () => {
  // homeops.create_approval is action:"Send"/requiresApproval:true but only records a
  // decision — it reaches nobody. The OLD code counted ANY succeeded requiresApproval
  // step as delivered, independent of the regex.
  const r = run({
    steps: [
      { index: 0, toolId: "homeops.create_approval", title: "Request household sign-off", status: "succeeded", requiresApproval: true, result: { id: "art_4", subject: "Share the briefing", recorded: true } },
    ],
  });
  const o = summarizeOutcome(r);
  assert.equal(o.delivered.length, 0, "requiresApproval alone must never imply delivery");
  const text = runOutcomeText(r);
  assert.doesNotMatch(text, /delivered \d/i);
});

test("CONTROL: a run with only ordinary internal writes (no drafts, no sends) keeps the plain honest finish wording", () => {
  const r = run({
    steps: [
      { index: 0, toolId: "homeops.create_task", title: "Add a task", status: "succeeded", requiresApproval: false, result: { id: "tk_1", title: "Pack bags" } },
      { index: 1, toolId: "homeops.write_memory", title: "Remember it", status: "succeeded", requiresApproval: false, result: { id: "mem_1" } },
    ],
  });
  const o = summarizeOutcome(r);
  assert.equal(o.delivered.length, 0);
  assert.equal(o.drafted.length, 0);
  const text = runOutcomeText(r);
  assert.match(text, /^Done — "TG-test run" finished \(2\/2 steps\)\.$/, "the clean, nothing-to-disclose path must read exactly as before");
});
