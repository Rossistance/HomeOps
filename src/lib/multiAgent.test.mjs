// Regression suite for the multi-agent honesty predicate — run with:
//   node --test src/lib/multiAgent.test.mjs
// (node >= 23 strips types from the imported .ts natively; no browser imports)
//
// The defect this guards: a template that names six specialists ("Calendar Agent",
// "Inbox Agent", …) is browsed in a household that has none of them, so a single
// arbitrary agent actually runs it. Every surface that mentions the roster — the
// Templates grid chip, the template detail roster, and compileTemplate's decision to
// send multiAgentRoles to the server preflight — reads THIS predicate, so they cannot
// disagree with each other or with server/automation-preflight.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { multiAgentRosterResolved, roleResolvesToAgent } from "./multiAgent.ts";

const agent = (name, status = "Active") => ({ name, status });
const role = (name) => ({ name });

// The two templates that ship with a roster today, against the sample household's
// seeded agent names ("Family Briefing Agent", "Inbox Helper Agent", …).
const SEEDED = ["Family Briefing Agent", "School & Daycare Agent", "Bill & Receipt Agent", "Inbox Helper Agent"].map((n) => agent(n));
const BRIEFING_ROSTER = ["Calendar Agent", "Inbox Agent", "School Agent", "Task Agent", "Finance Agent", "Parent Coordinator Agent"].map(role);

test("sample household: the shipped rosters do not resolve", () => {
  assert.equal(multiAgentRosterResolved(SEEDED, BRIEFING_ROSTER), false);
  assert.equal(multiAgentRosterResolved(SEEDED, ["Research Agent", "File Agent", "Summary Agent", "Memory Agent"].map(role)), false);
});

test("every named role must resolve — one miss is not resolved", () => {
  const all = BRIEFING_ROSTER.map((r) => agent(r.name));
  assert.equal(multiAgentRosterResolved(all, BRIEFING_ROSTER), true);
  assert.equal(multiAgentRosterResolved(all.slice(0, -1), BRIEFING_ROSTER), false, "5 of 6 present is still a false claim");
});

test("matching is case- and whitespace-insensitive, mirroring the server", () => {
  assert.equal(multiAgentRosterResolved([agent("  calendar AGENT ")], [role("Calendar Agent")]), true);
});

test("archived agents don't count", () => {
  assert.equal(multiAgentRosterResolved([agent("Calendar Agent", "Archived")], [role("Calendar Agent")]), false);
  assert.equal(multiAgentRosterResolved([agent("Calendar Agent", "Paused")], [role("Calendar Agent")]), true, "only Archived is excluded; a paused agent still exists");
});

test("no roster / empty roster / blank role name never resolves", () => {
  assert.equal(multiAgentRosterResolved([agent("Calendar Agent")], undefined), false);
  assert.equal(multiAgentRosterResolved([agent("Calendar Agent")], []), false);
  assert.equal(multiAgentRosterResolved([agent("Calendar Agent")], [role("  ")]), false);
  assert.equal(roleResolvesToAgent([agent("")], ""), false);
});
