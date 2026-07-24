// Feed rendering suite for WP-107 / ISS-114 — run with:
//   node --test src/lib/activityCopy.test.mjs
//
// "A helper did something technical." The hand-written allowlist covered 38 event types;
// the server writes 160. So ~122 of them — most of what a household actually does — hit
// that one line, and the Activity log couldn't be used to audit anything.
//
// This suite reads the audit types out of the SERVER SOURCE rather than hardcoding a
// list, so it stays true as the server grows: add an event type that renders generically
// and this fails. Enumerating templates by hand is exactly how the gap opened, and a
// frozen fixture list would let it reopen quietly.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { plainLanguageAudit, routeForAudit } from "./activityCopy.ts";

const SERVER_DIR = path.resolve(import.meta.dirname, "../../server");

/** Every `audit({type:"…"})` / `appendAudit({type:"…"})` the server can emit. */
function serverAuditTypes() {
  const types = new Set();
  for (const file of fs.readdirSync(SERVER_DIR).filter((f) => f.endsWith(".mjs"))) {
    const src = fs.readFileSync(path.join(SERVER_DIR, file), "utf8");
    for (const m of src.matchAll(/\b(?:append)?[Aa]udit\(\{\s*type:\s*"([a-z0-9_.]+)"/g)) types.add(m[1]);
  }
  return [...types].sort();
}

const GENERIC = /something technical|^undefined|^null/i;

test("the server's audit vocabulary is actually discoverable (guards the guard)", () => {
  const types = serverAuditTypes();
  assert.ok(types.length > 100, `expected the real vocabulary, found ${types.length} types`);
  assert.ok(types.includes("run.step"), "sanity: a known type is present");
});

test("ISS-114: NO server audit type renders generic copy", () => {
  const offenders = [];
  for (const type of serverAuditTypes()) {
    for (const ok of [true, false]) {
      const line = plainLanguageAudit({ type, ok });
      if (GENERIC.test(line) || line.trim().length < 8) offenders.push(`${type} (ok=${ok}) → ${line}`);
    }
  }
  assert.deepEqual(offenders, [], `these still render generic copy:\n${offenders.join("\n")}`);
});

test("ISS-114: every line names its subject and ends as a sentence", () => {
  const bad = [];
  for (const type of serverAuditTypes()) {
    const line = plainLanguageAudit({ type, ok: true });
    if (!/[.!]$/.test(line)) bad.push(`${type} → ${line}`);
    if (/^[a-z]/.test(line)) bad.push(`${type} → not capitalised: ${line}`);
  }
  assert.deepEqual(bad, []);
});

test("ISS-114: a failure reads as a failure, never as a success", () => {
  for (const type of ["agent.create", "skill.promote", "contact_method.verify", "meal.update"]) {
    const failed = plainLanguageAudit({ type, ok: false });
    assert.match(failed, /didn't succeed|didn't work|could not|couldn't/i, `${type}: ${failed}`);
  }
});

test("ISS-114: the compositional floor says something SPECIFIC, not a shrug", () => {
  // The exact types that used to fall through — now each names its own subject and action.
  assert.equal(plainLanguageAudit({ type: "agent.create", ok: true }), "A helper was created.");
  assert.equal(plainLanguageAudit({ type: "skill.promote", ok: true }), "A skill was published.");
  assert.equal(plainLanguageAudit({ type: "knowledge.delete", ok: true }), "A knowledge note was deleted.");
  assert.equal(plainLanguageAudit({ type: "contact_method.verify", ok: true }), "A contact method was verified.");
  assert.equal(plainLanguageAudit({ type: "meal.to_grocery", ok: true }), "A meal — to grocery.");
});

test("ISS-114: hand-written nuance still wins over the floor", () => {
  const line = plainLanguageAudit({ type: "run.step", ok: false, toolId: "gmail.search", error: "not_connected" });
  assert.match(line, /Gmail|Google/, "the connector is named");
  assert.match(line, /isn't connected yet/, "and why it failed");
});

test("ISS-114: an unknown FUTURE type still reports its subject rather than a shrug", () => {
  const line = plainLanguageAudit({ type: "widget.frobnicated", ok: true });
  assert.ok(!GENERIC.test(line), line);
  assert.match(line, /[Ww]idget/, "names the subject it was given");
});

/* ---- deep links ---- */

test("ISS-114: entries deep-link to the entity they are about", () => {
  assert.deepEqual(routeForAudit({ type: "agent.run", agentId: "ag_1" }), { screen: "agents", params: { id: "ag_1" } });
  assert.deepEqual(routeForAudit({ type: "skill.test", skillId: "sk_1" }), { screen: "skills", params: { id: "sk_1" } });
  assert.deepEqual(routeForAudit({ type: "approval.decide", approvalId: "ap_1" }), { screen: "messages", params: { tab: "approvals", approval: "ap_1" } });
  assert.deepEqual(routeForAudit({ type: "trigger.fire", triggerId: "tr_1" }), { screen: "automations", params: { id: "tr_1" } });
});

test("ISS-114: the most specific entity wins when several are present", () => {
  // A run step carries runId AND agentId AND connectorId; the approval is what a human
  // can actually act on, so it must not be buried behind the run it belongs to.
  const r = routeForAudit({ type: "run.await_approval", runId: "r1", agentId: "ag_1", approvalId: "ap_1" });
  assert.deepEqual(r, { screen: "messages", params: { tab: "approvals", approval: "ap_1" } });
});

test("ISS-114: an event naming no navigable entity returns null, not a wrong link", () => {
  assert.equal(routeForAudit({ type: "server.shutdown" }), null);
  assert.equal(routeForAudit({ type: "rate.limited" }), null);
});
