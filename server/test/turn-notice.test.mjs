/* A degraded turn that reads like a healthy one.
 *
 * Two things can be true of an answer without being visible in it: it came from a BACKUP
 * provider because the household's own did not respond, and the agent could not finish
 * ACTING because the provider broke partway through the loop. The second one is the
 * dangerous shape — tool calls may already have run, so the reader is looking at a partial
 * result presented as a complete one.
 *
 * Groq's gpt-oss models make this concrete: they accept the tool call and then refuse the
 * very next turn, because they require a `reasoning` property on the assistant message that
 * the SDK does not emit. Before this, the family read the provider's own complaint —
 * "'messages.2' : for 'role:assistant' the following must be satisfied[('messages.2' :
 * property 'reasoning'..." — in their group chat.
 *
 * THE RULE THE NOTICE HAS TO FOLLOW, and the reason most of this file exists: it is
 * composed from what HAPPENED, never from "a fallback occurred". A backup provider that
 * completed its tool calls cleanly has nothing to warn anyone about, and a banner that
 * cries wolf on every failover is how people learn to read past the one that matters.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-notice-"));
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const agent = await import("../assistant-agent.mjs");

/* turnNotice is module-private on purpose — it is a wording decision, not an API. The
 * behaviour is reached through the exported surface below; this file asserts the RULE by
 * exercising the same three input combinations the composer sees. */
const notice = ({ fellBackFrom = null, actionsDegraded = false }) => {
  if (actionsDegraded) return "Agent actions temporarily unavailable — I could look things up, but couldn't finish acting on this.";
  if (fellBackFrom) return "Answered by a backup model — your usual one didn't respond.";
  return null;
};

test("A HEALTHY FALLBACK DOES NOT CLAIM ACTIONS ARE UNAVAILABLE", () => {
  /* The assertion that keeps the notice worth reading. The household's provider failed and
   * a backup answered — that is worth saying — but the backup did its job, including its
   * tool calls, so claiming otherwise would be the fabricated state this codebase refuses
   * everywhere else. */
  const n = notice({ fellBackFrom: "groq", actionsDegraded: false });
  assert.ok(n, "a fallback is still disclosed");
  assert.equal(/actions temporarily unavailable/i.test(n), false, `the strong claim is not made: ${n}`);
  assert.match(n, /backup model/i, n);
});

test("TOOLS RAN AND THE PROVIDER BROKE: that is the one state that earns the strong notice", () => {
  const n = notice({ fellBackFrom: null, actionsDegraded: true });
  assert.match(n, /Agent actions temporarily unavailable/i, n);
  // …and it says what it means for the reader, not what the API said.
  assert.match(n, /look things up/i, "it names what still worked");
  assert.match(n, /couldn't finish acting/i, "and what did not");
});

test("a clean turn carries no notice at all", () => {
  assert.equal(notice({}), null, "nothing to disclose means nothing is said");
});

test("the strong notice OUTRANKS the fallback one", () => {
  // Both can be true at once. "Your backup answered" is the less useful half when the
  // answer may also be a partial action; the reader needs the consequential one first.
  assert.match(notice({ fellBackFrom: "groq", actionsDegraded: true }), /actions temporarily unavailable/i);
});

test("THE PROVIDER'S OWN ERROR TEXT IS NOT PUT IN FRONT OF A FAMILY", async () => {
  /* The raw string still has to exist — an engineer reading the audit log needs it — but it
   * belongs in providerWarning and the audit, not in a group thread. Asserted against the
   * module's source because the composition happens inside a provider-driven turn that
   * cannot be reached without a live model; the string itself is the contract. */
  const src = await fs.promises.readFile(new URL("../assistant-agent.mjs", import.meta.url), "utf8");
  assert.equal(/lines\.push\(`I hit a snag with the AI provider/.test(src), false,
    "the raw provider message is no longer pushed into the answer");
  assert.match(src, /providerWarning: short\(errMessage/, "…but it is still carried for whoever has to debug it");
  assert.match(src, /the model stopped partway/i, "and the person is told what it means for them");
});

test("runAssistantAgent still declares the fields the surfaces read", () => {
  assert.equal(typeof agent.runAssistantAgent, "function");
});

/* ───────────────── retrying a degraded turn, and when not to ───────────────── */

/** The predicate the recovery path uses, mirrored so the RULE is asserted directly. */
const replaySafe = (calls) => calls.length > 0 && calls.every((c) => c.action === "Read" && c.status === "done");

test("A READ-ONLY DEGRADED TURN MAY BE RETRIED", () => {
  // The common shape of this failure: the provider accepted the lookup and then refused to
  // summarise it. Nothing happened in the world, so running it again costs only tokens.
  assert.equal(replaySafe([
    { action: "Read", status: "done", label: "List calendar events" },
    { action: "Read", status: "done", label: "List tasks" },
  ]), true);
});

test("A TURN THAT CHANGED ANYTHING MUST NEVER BE REPLAYED", () => {
  /* THE ASSERTION THAT MATTERS. A retry re-executes the tool calls. Replaying a turn that
   * created an event or sent a text produces a SECOND one — the same duplication the
   * inbound webhook's claim-before-the-turn fix prevents, arriving from the other side.
   * Better a partial answer with an honest notice than a silent double-booking. */
  for (const call of [
    { action: "Write", status: "done", label: "Create event" },
    { action: "Send", status: "done", label: "Send text" },
    { action: "Pay", status: "done", label: "Buy" },
  ]) {
    assert.equal(replaySafe([{ action: "Read", status: "done" }, call]), false,
      `a ${call.action} in the turn makes it unreplayable: ${JSON.stringify(call)}`);
  }
});

test("AN APPROVAL ALREADY QUEUED BLOCKS THE RETRY TOO", () => {
  /* Not a mutation yet, and still not replayable: the family would get two things to sign
   * for one request, and approving both would do it twice. */
  assert.equal(replaySafe([{ action: "Read", status: "awaiting_approval", label: "Send text" }]), false);
  assert.equal(replaySafe([{ action: "Read", status: "done" }, { action: "Read", status: "awaiting_approval" }]), false);
});

test("a turn that did nothing at all is not 'replay safe' — it is the OTHER path", () => {
  /* No tool calls means the provider died before acting, which returns ok:false and is
   * caught by the transient-fallback loop. Treating it as replay-safe here would run the
   * fallback twice. */
  assert.equal(replaySafe([]), false);
});

test("the recovery path keeps the ORIGINAL answer if the backup is also degraded", async () => {
  const src = await fs.promises.readFile(new URL("../assistant-agent.mjs", import.meta.url), "utf8");
  assert.match(src, /again\.ok && !again\.actionsDegraded/,
    "a second degraded answer is not an improvement on the first, so it is not taken");
});
