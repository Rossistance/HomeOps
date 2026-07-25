# Jam Triage Addendum — Web Control Plane (Part 1 + Part 2)

Supplements [`jam-triage-2026-07-23.md`](jam-triage-2026-07-23.md) (which covered the iOS calendar Jam,
`7b44f45c`). This addendum covers the web-app walkthrough, re-recorded and split into two parts after
the original 38-minute single recording exceeded the transcription limit.

| Jam | Duration | Content |
|---|---:|---|
| [7631fa90](https://jam.dev/c/7631fa90-c888-43d3-a9d1-c81167c41f45) (Part 1) | 20:01 | Builder/control-plane review: Helper Agents, Capabilities, Skills, Functions |
| [34ef54ca](https://jam.dev/c/34ef54ca-7bf9-4baf-b9ae-894b5c522410) (Part 2) | 18:19 | Runtime review: sign-in, Automations, Templates, Mini Apps, Connections, Memory |

**Evidence note (honesty first):** Part 1's automated intent-extraction returned only one segment
(0:00–1:46) despite two separate extraction attempts, even though the recording runs 20 minutes and its
voiceover text alone reads well beyond that window — the tool's segmentation is unreliable here, not
a signal that nothing else happened. Part 2's extraction was complete (13 segments, full 18:19, verified
by manual chunked read of all 3,260 lines of raw output). Console and network artifacts for both 404'd
from Jam's CDN, same as the original 38-minute recording — every finding below is video/transcript/event
-grounded, not trace-grounded, unless a code citation is given.

## Second-opinion source

The user supplied two independent ChatGPT-authored reports analyzing the same three recordings, saved
in this repo at [`docs/chatgpt-reports/`](chatgpt-reports/). They were not treated as ground truth —
several of their central claims are **verified against actual FamiliOS source below**, with file:line
citations. Where a ChatGPT hypothesis checks out in code, it's marked **CONFIRMED IN CODE**. Where it
doesn't apply cleanly, that's noted too.

---

## Executive summary — this is not a new bug list, it's the same root cause at scale

ChatGPT's framing, independently arrived at from the transcripts alone, matches what my own mission's
retrospective already suspected and what direct code inspection now confirms:

> HomeOps lets declarative objects — agents, skills, functions, templates, automations, mini apps —
> look created or active before the system proves their referenced dependencies (agent, recipient,
> handler, integration) form something actually runnable.

This is the same failure class as **ISS-018** (found by the WP-003 spec author two days ago: ad-hoc
"Run now" runs had no server-verified acting agent) — except the Jam evidence shows it's **broader than
that one fix covered**. WP-002/WP-003 fixed attribution for chat runs and the agent "Run now" button.
It did **not** fix the paths the reporter is hitting here: skills with no `defaultAgentId`, and templates
whose "multi-agent" badges never create the agents they display.

---

## CONFIRMED IN CODE: the exact mechanism behind every `no_acting_agent` failure in these Jams

**[server/orchestrator.mjs:126](../server/orchestrator.mjs):**
```js
const ref = { skillId, agentId: agentId ?? skill.defaultAgentId ?? null, ...sourceRef };
```

`runSkill()` — the function every deterministic skill run goes through — resolves the acting agent as
`agentId ?? skill.defaultAgentId ?? null`. When a skill has no `defaultAgentId` (true for most
skills created via the builder, confirmed by the Jam: "Infer capabilities" never sets one) and no
explicit `agentId` is passed at call time, **the run silently starts with a null acting agent**. Every
downstream send/notify step then fails exactly the way [internal-functions.mjs:487](../server/internal-functions.mjs)
is written to fail it: `no_acting_agent`.

This is ChatGPT's **RC-2 ("execution context permits null acting identity")**, confirmed at the exact
line. It directly explains three things the reporter saw and misread as separate bugs: "no acting
agent," "no recipe found on the morning briefing helper," and the badge/approval failures — all
downstream symptoms of the same null.

## CONFIRMED IN CODE: "multi-agent" templates never create the agents they show you

**[src/data/workflowTemplates.ts:149,882](../src/data/workflowTemplates.ts)** — exactly two templates
carry a `multiAgent: [{name, role, icon}, ...]` array. It is pure display data.

**[src/store/useStore.ts:2234-2259](../src/store/useStore.ts)** — `createAutomationFromTemplate()`, the
function that runs when you tap "Use this template," never reads `tmpl.multiAgent` at all. It resolves
exactly **one** `agentId` via a fallback chain (template's own agent → name match → prompt-based routing
→ first active agent → first agent, period) and assigns the whole automation to that single agent.

So when the Daily Family Briefing template's detail screen lists "Calendar, Inbox, School, Task,
Finance, Parent Coordinator" as its multi-agent workflow, **none of those six get created**. That's not
a data-sync glitch — the client code was never wired to create them. This is exactly the reporter's "I
look at any of these — well, I can go to their capabilities... these agents just don't exist" (Jam
Part 1) and "why would it use the agent to find this week's grocery list if it's searching for daycare"
(Part 2, ~09:57) — the fallback chain's "first active agent" resolves to whatever happens to be active,
not what the template's copy implies will run it.

This is ChatGPT's **RC-1 (no compile/preflight gate)** and **RC-5 (creation isn't idempotent / doesn't
validate references)**, confirmed: there is no server-side template-instantiation function at all
(`grep -r "useTemplate\|createFromTemplate\|instantiateTemplate" server/` returns nothing) — template
expansion happens entirely client-side, with no dependency graph ever checked before the automation is
marked Active.

---

## New tickets from this pass (continues numbering from the base triage doc)

### BUG-030 — `runSkill` allows a null acting agent when a skill has no `defaultAgentId`
**P0 · web · CONFIRMED IN CODE — this is the mechanism, not just a symptom**

Fix at [orchestrator.mjs:126](../server/orchestrator.mjs): `runSkill` (and the WP-006 orchestration
core it should route through) must refuse to start a run rather than silently proceeding with
`agentId: null`. Either (a) resolve a household-default acting agent the same way chat/Run-now do
post-WP-002, or (b) reject at creation time — a skill with no acting agent assigned should not be
selectable in the New Automation flow at all. Given the existing `orchestrate()` single-entry point from
WP-006 s1/s2, this is a small, surgical fix at the same choke point ISS-018 was fixed at.

**Test:** `runSkill` with a skill carrying no `defaultAgentId` and no caller-supplied `agentId` must
either throw a validation error at creation or resolve a real household agent — never proceed to
`startRun` with `sourceRef.agentId === null`.

### BUG-031 — Multi-agent template badges are decorative; only one agent is ever created
**P0 · web · CONFIRMED IN CODE**

Either (a) make `createAutomationFromTemplate` actually create/link every agent named in
`tmpl.multiAgent`, or (b) stop showing the "multi-agent workflow" UI for templates that don't back it —
showing six named specialist agents and creating zero of them is a direct false-success claim, the same
class of bug WP-002 was built specifically to eliminate.

**Test:** for a template with a `multiAgent` array, after "Use this template," every named role must
resolve to a real agent (existing or newly created) — never a decorative label with no backing entity.

### BUG-032 — "First active agent" fallback picks unrelated agents for unmatched templates
**P1 · web · CONFIRMED IN CODE**

[useStore.ts:2244](../src/store/useStore.ts): `d0.agents.find((a) => a.status === "Active") || d0.agents[0]`
is the last-resort fallback. For a template whose prompt doesn't route cleanly (routeToAgent returns
nothing) and has no `recommendedAgentTemplateId` match, the automation silently gets assigned to
*whatever agent happens to be first/active* — observed live as a grocery-list agent being assigned to
run a daycare-research template. Replace the silent fallback with an explicit "choose an agent" step
when no confident match exists; never guess.

### BUG-033 — Toggling an automation's status can trigger "Run paused for approval" as a side effect
**P1 · web · needs discriminating check**

Jam Part 2 (~63-70s): disabling then re-enabling the "School Correspondence Organizer" automation's
status toggle produced toast sequence "Automation paused" → **"Run paused for approval"** → "Automation
enabled." A status toggle should not itself start or pause a run. **Check:** does the status-toggle
handler call the same code path as a manual run trigger? If so, that's the bug — toggling `active` must
be a pure metadata write, never a run side-effect.

### BUG-034 — Duplicating a mini app silently lands it in Archived
**P2 · web · confirms BUG-014 from the base triage, now with exact evidence**

Jam Part 2 (~81-91s): "Duplicate" on Family Chore Board → toasts "Mini app created" / "Mini app added" →
user finds it only by discovering an "Archived" section later, with no toast or indicator explaining why
a just-created duplicate starts archived.

### BUG-035 — Files marked "Not indexed" even after a "File processed" toast
**P2 · web**

`IMG_1490.JPG` shows a "File processed" toast, but the file's own badge still reads "Not indexed."
Either the toast fires before indexing actually completes (premature success signal — same false-success
class as WP-002 targeted), or "processed" and "indexed" are genuinely different pipeline stages that
need distinct, honestly-labeled statuses instead of one ambiguous toast.

### BUG-036 — Second Google Calendar account shows `needs_reconnect`; may explain earlier merge confusion
**P2 · web · new data point for the base triage's BUG-001/anniversary finding**

Connections page: `wrhixon@gmail.com` shows "Connected, 36 events synced"; a second account
(`melissareyesm@gmail.com`) shows `needs_reconnect`. The reporter's Jam 1 comment "I'm not sure where it
got that information from" about the anniversary event's two-day span may be compounded by this: a
stale/disconnected second account's cached events could be merging unpredictably with the first
account's. Worth checking whether a `needs_reconnect` account's stale local copies still render.

### BUG-037 — Approvals page truthfully shows "Nothing to approve" even while runs fail with `no_acting_agent`
**P2 · web · confirms the WP-001 fix is working correctly, but exposes the real gap**

This is *not* a regression of the Inbox-truth fix shipped in the mission — runs that die with
`no_acting_agent` never reach the approval gate at all (BUG-030 above), so there's genuinely nothing
pending to show. Filed here only so the two are not confused during triage: fixing BUG-030 is the actual
fix; the Approvals page is behaving honestly given what it's fed.

### BUG-038 — Grocery item count on Dashboard disagrees with the Shared Grocery List's contents
**P1 · web · matches ChatGPT's REP-07 exactly**

The reporter recalls the dashboard indicating pending groceries, but Shared Grocery List's "To Buy"
section shows nothing. Needs the discriminating check ChatGPT specifies: read both surfaces' data
sources directly — do they query the same list ID/household scope, or two different projections?

---

## Design research synthesis

**Method:** Video review (3 recordings, ~54 min total) + voiceover transcription + structured intent/event
extraction. **Participant:** 1 (product owner, dogfooding own family's data). **Date:** 2026-07-23.

### Theme 1 — "I can't tell what's real"
**Prevalence:** dominant theme, present in all 3 recordings, ~40+ distinct utterances.
**Summary:** Every surface that reports state (run status, approval count, sync status, file-processed
toast, capability counts, memory) told the reporter something that turned out to be incomplete or
contradicted by another surface.
**Supporting evidence:**
- "It's showing two days for my anniversary... I'm not sure where it got that information from." (Jam 1)
- "Six executed now, six permitted. Okay, five permitted. That doesn't make any sense." (Jam Part 1)
- "Sure, it says it completed... Provider error, no." (Jam Part 2)
**Implication:** No amount of individual bug fixes restores trust while status surfaces can independently
disagree. This is the mission's own "engine works, family can't see it" finding from three days ago,
recurring at the builder/config layer instead of the execution layer.

### Theme 2 — "The system lets me build things it can't run"
**Prevalence:** primary theme of Part 1 + Part 2 (builder review).
**Summary:** Skills, agents, and templates can be created, saved, and marked Active without any check
that their dependencies (acting agent, recipe, function handler, connected integration) actually exist.
**Supporting evidence:**
- "These agents just don't exist... almost all don't exist." (multi-agent template review)
- "Infer capabilities — shouldn't [it] just automatically do that for me?" then a failed real-test run.
- "I'm not supposed to have to do this" (re: skills needing manual configuration before they'd run).
**Implication:** This is the single highest-leverage fix available — a pre-activation validation gate
would prevent the majority of the other symptoms from ever reaching the user. (See BUG-030/031 above,
now code-confirmed as the mechanism.)

### Theme 3 — "Every control needs to be set in multiple places"
**Prevalence:** secondary, concentrated in the approvals/permissions review.
**Summary:** Approval policy exists per-helper, per-agent, and per-skill, with no single authoritative
view of what a given action will actually require.
**Supporting evidence:** "There's too many control surfaces to either approve or not approve... if the
engine creates multiple different agents, then they all have to be manually set." "So that means every
single one of these skills also needs to be changed. And functions."
**Implication:** Matches BUG-006/BUG-007 from the base triage — a household-level effective-policy view
(ChatGPT's HO-003) would collapse this into one comprehensible surface.

### Insights → Opportunities

| Insight | Opportunity | Impact | Effort |
|---|---|---|---|
| Runs die on a null acting agent that's resolvable at creation time | Add the BUG-030 preflight check at the existing `runSkill`/`orchestrate()` choke point | High | Low |
| Multi-agent templates are pure decoration | Either wire real agent creation or remove the claim from template copy | High (trust) | Low–Med |
| No single view of effective approval policy | Household-level policy view, per-entity as inherited override | Med | Med |
| Status surfaces can independently disagree | Extend the mission's "one run world" pattern to the builder layer (skills/functions/templates) | High | Med–High |

### Recommendations, priority order
1. **BUG-030** (null acting agent) — smallest fix, directly explains the largest share of observed failures, sits at a choke point already touched by the recent mission.
2. **BUG-031/032** (template agent creation vs. decoration) — second highest-leverage; directly answers "these agents don't exist."
3. **HO-003-style unified policy view** (from ChatGPT's report, endorsed) — addresses the approval-sprawl theme structurally rather than per-screen.
4. Everything in the base triage doc's change plan (production-data cleanup, calendar off-by-one, keyboard/text-wrap) proceeds unchanged — this addendum doesn't reprioritize those, it adds parallel-track web-control-plane findings.

### Questions for further research
- Does the grocery-list/dashboard mismatch (BUG-038) share a root cause with the Files/Knowledge "not
  indexed" contradiction (BUG-035) — i.e., is there a general pattern of toasts firing before their
  underlying async work actually completes?
- Is the `needs_reconnect` second Google account (BUG-036) contributing to the calendar merge confusion
  from the base triage, or unrelated?

### Methodology notes / limitations
- Single participant, who is also the product owner — findings are directionally strong but not
  validated against a broader user base.
- Part 1's intent extraction under-covered its own recording (see Evidence note above); its findings here
  draw on the one returned segment's very long embedded voiceover text rather than structured per-moment
  data.
- ChatGPT's two reports were read in full and used as a cross-check, not a primary source; every
  "CONFIRMED IN CODE" claim above was independently verified by reading the actual FamiliOS source in
  this session, not by trusting either AI's inference.

---

## Tooling note: CodeRabbit unavailable

The user's request to also run `/coderabbit:coderabbit-review` could not proceed — the `coderabbit` CLI
is not installed in this environment (`coderabbit: command not found`). Install from
<https://www.coderabbit.ai/cli>, then `coderabbit auth login`, then this review can run for a proper
static-analysis pass alongside the behavioral findings above.
