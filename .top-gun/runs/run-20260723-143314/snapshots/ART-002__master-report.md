# Universal Convergent 360-Degree Product Experience and Full-Stack Truth Audit — Brownfield PRD and Implementation Mandate

Run `run-20260723-143314` · FamiliOS (D:\FamiliOS\FamiliOS, HEAD `711f56c`) · 2026-07-23
Synthesis audit over three Jam recordings, 38 triage tickets, an independent second-opinion analysis, and
the completed 2026-07-21/22 mission's registers. Companion registers under `audit/` are canonical for
detail; this report is sufficient to decide.

---

## 1. Executive verdict and highest-value decision

**Verdict: the product can now *do* things; it still cannot prove them — and two days ago it was told it
had been cleaned when only a copy of it was.**

The prior mission genuinely fixed the execution layer: honest delivery wording, server-truth Inbox,
unified run history, a 22-use-case benchmark passing three times. Those wins are real and preserved.
What the three new recordings show is that **the same failure class simply moved up a layer** — from
"the engine ran but you couldn't see it" to "**you can create things the engine can never run, and the
UI calls them Active.**"

Three findings are confirmed in source this run, not inferred:

1. **`runSkill` starts runs with a null acting agent** (`orchestrator.mjs:126`). Every `no_acting_agent`
   and "no recipe found" failure the owner narrated traces here. The mission's ISS-018 fix covered chat
   and the "Run now" button — **not** skills, automations, or templates, which is exactly where he was.
2. **"Multi-agent" templates never create the agents they advertise** (`useStore.ts:2234`,
   `workflowTemplates.ts:149,882`). The template detail screen lists six named specialists; the code
   assigns one agent chosen by a fallback chain ending in "first active agent." Hence "these agents just
   don't exist," and a grocery agent running a daycare search.
3. **The approved data cleanup ran against the local dev tenant, never production** (`render.yaml`
   `HOMEOPS_DATA_DIR=/data` vs the migration report's `Resident tenant: local`). Code deployed; data
   untouched. The duplicate Morning Briefing helpers he counted on screen are precisely what the
   migration would have merged. This was a **reporting failure as much as a technical one.**

**Highest-value decision: select the Recommended bundle (menu items 1 + 2).** WP-101 makes execution
truthful at the one choke point all three confirmed defects pass through; WP-102 then makes the
already-approved cleanup land on production *and stay clean*. Sequencing matters: migrating before
idempotency exists means watching the same cleanup fail twice (DEC-104).

---

## 2. Scope, environments, authorization, evidence limits, and production/source parity

- **Scope:** synthesis audit and brownfield PRD. Read-only on product source, production data, and remote
  systems. No implementation is authorized until the S5 selection gate is answered.
- **Environments:** local worktree at HEAD `711f56c`; production Render service `homeops-ai`
  (node v24.18.0, env production, memory backend `sqlite-fts5`, `browserRuntime:false` — EV-122);
  recordings captured on a real iPhone 13 Pro Max, iOS 27.0, 428×926.
- **Baseline health (this run):** `npm test` → 549 tests, 548 pass, 0 fail, 1 honest skip; `npm run
  typecheck` → exit 0 (EV-115, EV-116).
- **Evidence limits — stated plainly:**
  - Jam's processed console/network artifacts returned **HTTP 404** for all three recordings, so no
    request/response traces exist. Findings are video-, transcript-, and source-grounded.
  - Part 1's automated intent extraction covered only **0:00–1:46 of 20:01** across two attempts
    (EV-102). Its long embedded voiceover was mined, but per-moment structured data is missing —
    **additional distinct defects may be unrecorded** (HYP-105).
  - No live persona journeys were executed this run by design (DEC-101); persona cards and journeys are
    carried forward from the prior mission and relabeled as such.
- **Production/source parity:** production runs the shipped **code** (EV-122). Production **data** is a
  separate database that has never received the approved cleanup (EV-121). This split is ISS-101 and is
  the single most important parity fact in this report.
- **Authorization:** no production writes, no deploys, no external sends performed or implied by this
  document.

---

## 3. Capability inventory and agent topology

**Used this run:** Jam MCP (details, transcripts, intent analysis, evidence enumeration), Read/Grep over
the FamiliOS worktree (7 new CODE evidence items), Bash (baseline suites, git, curl to production
health), computer-use (read the owner's ChatGPT window), filesystem extraction of the supplied report
zip, mem + convergent-360 scripts.

**Available but not used, with reason:** CodeRabbit CLI — **not installed** (`command not found`); a
static-analysis pass remains available once installed. Playwright/browser automation — not needed for a
synthesis audit over existing recordings. Subagent fan-out — the evidence was already gathered; parallel
agents would have added coordination cost without new evidence (DEC-101).

**Agent topology:** single orchestrator holding all mandate roles in separated passes (product/UX,
full-stack, evidence QA, synthesis). No concurrent writers to canonical registers. **Limitation
disclosed:** no independent specialist review of these conclusions was performed.

---

## 4. Application understanding

- **Product purpose:** a family operating system where approval-gated AI helpers do household admin.
- **Target users:** the owning adult (technical), a second adult, children with scoped views, external
  recipients (grandparents), and unattended schedules.
- **Core jobs:** ask in plain English → work happens → it is visibly done, with sign-off on anything
  risky.
- **Architecture and authority:** React/Vite SPA + Expo iOS client over a Node ESM server with
  per-household SQLite tenancy, a durable run engine with approval gates and idempotent steps, six AI
  provider adapters, tz-anchored scheduling, and a connector sandbox. Execution truth is server-owned;
  household content is mirrored client-side. **Template instantiation, however, is entirely
  client-owned** — the structural cause of ISS-103.
- **Primary workflows:** chat → plan → run → approve → result; scheduled automations; helper/skill
  authoring; calendar and Google sync; mini apps; memory.
- **Strengths worth preserving:** the approval architecture is genuinely fail-closed (per-helper
  recipient allowlists, verified + opted-in contact methods — FEAT-209 verified PASS); the server-truth
  Inbox shipped in the last mission behaves honestly (FEAT-208 PASS — it correctly shows "nothing to
  approve" because failed runs never reach the gate); the durable engine's idempotency, recovery, and
  TTL machinery; the honest empty states; the warm, coherent visual system; the tenancy model.
- **Unresolved assumptions:** that "Active" implies runnable (PI-110); that clients share a canonical
  schema (ISS-118); that a green server suite indicates product health (EV-115 — it does not).

---

## 5. Observed product intent, inferred vision, success measures, and contradictions

Full register: `audit/product-intent-register.md` (PI-101…PI-112).

The owner states the success measure himself, repeatedly and unambiguously: *"hey can you do this" →
"done, as you requested"* — **and it visibly is** (PI-102). Everything else in the product is
instrumental to that sentence.

**Three contradictions dominate:**
- **PI-110:** creation is presented as activation while nothing validates runnability. This is the
  architectural contradiction the whole audit converges on.
- **PI-111:** the owner was told his data was cleaned; only a local copy was (ISS-101).
- **PI-105 vs ISS-117:** helpers are meant to be self-configuring ("the app should be doing this by
  itself"), yet the builder requires hand-authoring handlers it implied it would infer.

---

## 6. App Functionality Inventory and coverage

26 features inventoried with statuses, plus the trace matrix, in `audit/functionality-inventory.md`.

```
Execution coverage: 26/26 = 100%   (exercised in a recording or traced in source this run)
Verified coverage:  10/26 = 38%    (UI evidence AND source/API confirmation; partial/observed never counted)
Persona coverage:   26/26 = 100%
```

Fourteen issues remain **observed but not root-caused** and are deliberately excluded from verified
coverage — each carries a named discriminating check in `audit/hypothesis-queue.md`.

---

## 7. Five canonical persona cards

> **Synthetic-research disclosure:** these five personas are research instruments grounded in current
> evidence (the owner's own recorded narration, resident household data, role definitions). Personas
> 2–5 are simulated hypotheses carried forward from the prior mission and were **not** re-executed as
> live journeys this run (DEC-101). Persona 1 is the actual recorded reporter.

### Persona 1 — Ross, the Owner-Builder
The real reporter across all three recordings. High technical fluency; built the helper catalog himself.
Goal: one verifiable end-to-end task, and confidence that what he was told actually happened. Success =
seeing results where the app said they'd be. **Current state: trust is the binding constraint** — his
closing words were "I want some answers or I'm just going to revert back into a safe place." Evidence-
grounded throughout (EV-101/102/103).

### Persona 2 — Maya, the Busy Parent
Low technical fluency, phone-first. Goal: one-sentence asks that just happen. Her failure mode is fully
represented in the recordings even though she wasn't the operator: a created event that never appears
(ISS-105), a count that links to an empty list (ISS-112), text she cannot read (ISS-109). Simulated.

### Persona 3 — Noah, the Child
Child role, shared device, AI gated off by policy. The prior mission fixed his web sign-in path
(WP-010). Not exercised this run. Simulated.

### Persona 4 — Grandma Ellen, the External Recipient
Never opens the app; receives digests through the contact-method registry. Every send she'd depend on
currently dies at ISS-102's null actor. Simulated.

### Persona 5 — Sam, the Scheduler
Optimizes unattended automations (7 AM briefings). The tz-anchored scheduler is correct, but ISS-102 and
ISS-110 mean an unattended run can fail and still read as Completed — the worst case for someone who
isn't watching. Simulated.

---

## 8. Five end-to-end journey narratives and step tables

Journeys are **carried forward** from the prior mission and re-annotated with this run's findings; only
JRN-1/2/3 were re-observed here (through the recordings, not live execution).

- **JRN-1 — Ross reviews his helper catalog (re-observed, EV-102/103).** Opens Helper Agents → counts
  five near-identical Morning Briefing helpers (ISS-101, ISS-111) → opens capabilities → reads
  contradictory counts (ISS-124) → finds per-skill approval toggles (ISS-107) → concludes "that doesn't
  make any sense." **FAIL.**
- **JRN-2 — Ross instantiates a template and runs it (re-observed, EV-103/104).** Automations →
  Templates → School Correspondence Organizer → "Use this template" → "Automation created" → edit →
  reviews a plausible-looking plan → runs → `no_acting_agent` / `no_recipient` / `provider_error`; some
  runs read Completed anyway. **FAIL** (ISS-102, ISS-103, ISS-110).
- **JRN-3 — Calendar lifecycle on iOS (re-observed, EV-101).** Views anniversary spanning two days
  (ISS-104) → creates an event that never appears (ISS-105) → deletes an event that returns on sync
  (ISS-106) → cannot see what he types (ISS-109) → loses an unsaved draft (ISS-123). **FAIL.**
- **JRN-4 — Household data findability (re-observed, EV-103/104).** Dashboard implies pending groceries
  → Shared Grocery List shows none (ISS-112) → duplicated mini app vanishes into Archived (ISS-122) →
  file says "processed" and "not indexed" simultaneously (ISS-120). **FAIL.**
- **JRN-5 — Unattended scheduled delivery (not re-executed).** Carried forward as blocked: the scheduler
  is correct, but the delivery chain terminates at ISS-102. **BLOCKED.**

---

## 9. Visual and product design audit

- **Navigation:** the unified Helper Agents surface is the right idea, undermined by ISS-108 (Advanced
  Mode re-reveals the fragmented nav) and ISS-115 (no nested routes; back exits the section; deep links
  land on the wrong surface — "I have no idea why it's throwing me around everywhere").
- **Workflow:** template → automation → run reads coherently and *is* coherent right up until execution,
  where the displayed plan turns out never to have been validated (ISS-103).
- **Layout and hierarchy:** important controls sit below unrelated content ("they're just at the bottom
  of the page where I'll never see them"); subscriptions buried at the end of a long scroll.
- **Components and content containment:** the dominant defect — user text does not wrap or scroll
  anywhere (ISS-109), affecting "every single page."
- **Responsive behavior:** the recordings are the responsive audit — a 428×926 viewport shows the "skip"
  label clipped by an overlapping control, off-screen actions, and unreadable names.
- **Accessibility:** not systematically assessed this run (no screen-reader pass, no contrast
  measurement). Named limitation, not a clean bill.
- **System states:** empty states remain honest; **success states are not** — "processed" over "not
  indexed" (ISS-120), Completed over failed children (ISS-110), unattributed toasts (ISS-116).
- **Visual credibility and trust:** the product looks trustworthy and is currently not; that gap is the
  whole report.

---

## 10. Full-stack audit

- **Frontend:** the web store carries both local-first data and server projections; template
  instantiation lives entirely here (EV-107/109) with no server participation — a boundary error, not a
  styling one. Task types are partitioned across surfaces by constant (EV-112) with per-surface queries,
  producing ISS-112.
- **Backend:** high quality overall — explicit gates, idempotent steps, bounded retries, fail-closed
  sends, TTL sweeps, tenancy isolation. The defect is a **missing precondition**, not a broken
  mechanism: `runSkill` permits a null actor (EV-105) and the resulting error is raised at the tool
  boundary rather than at run creation (EV-106).
- **State and data:** per-household SQLite with WAL; hot-WAL rule in force. All-day date semantics are
  converted zero times at ingest and once (incorrectly, inclusively) at render (EV-110/111).
- **APIs/events/jobs/providers:** tz-anchored scheduler correct; connector sandbox available; **no
  browser runtime in production** (EV-122, ISS-119).
- **Security and privacy:** unchanged strengths — vault-only secrets, no client tokens, per-agent send
  allowlists, role gates. Policy *resolution* is the weakness (ISS-107), not policy *enforcement*.
- **Reliability and performance:** the sync storm was fixed (660 → 3–4 req/min idle) and the stale-handle
  self-heal has held. No new perf defects observed.
- **Maintainability and operations:** the 549-test suite is genuinely valuable and genuinely insufficient
  — it was green throughout every failure in these recordings (EV-115). **Server-suite green is not a
  product-health signal**; that is the single most important operational lesson here.

---

## 11. UI-to-Backend Trace Matrix

Eight meaningful actions traced end-to-end in `audit/functionality-inventory.md` §Trace Matrix,
including the two PASS rows (approvals read-model; contact allowlist) and the "Use this template" row
whose Request/Endpoint cells read **"none — client-only."** That empty cell is ISS-103 in one glance.

---

## 12. Convergence and misalignment map

- **Design and architecture reinforce each other:** approval-card UX ↔ consume-once approvals; contact
  registry UI ↔ fail-closed send gates; honest empty states ↔ truthful readiness vocabulary.
- **UI masks backend limitations:** "Active" over an unvalidated dependency graph; "Completed" over
  failed children; "File processed" over "Not indexed."
- **Backend complexity leaks into UI:** per-entity approval toggles expose the policy model's lack of
  inheritance; capability counts expose three different derivations.
- **Product language contradicts behavior:** multi-agent template copy names six specialists that are
  never created; delete confirmation says "household calendar" while Google keeps the event.
- **Intended workflow lacks technical support:** self-configuring helpers (PI-105) vs a builder that
  demands hand-authored handlers (ISS-117).
- **Technical capability lacks product expression:** the sandbox, the FTS5 memory brain, and the
  provisioning checklists all shipped but are not yet surfaced where users would meet them.

---

## 13. Canonical master issue register

24 deduplicated root causes, ordered by severity and dependency, in `audit/issue-register.md`.
Order of attack: **ISS-102 → ISS-103 → ISS-110** (execution truth) → **ISS-101 + ISS-111** (production
data, made durable) → **ISS-104 → ISS-105/106** (calendar) → **ISS-109** (readability) → **ISS-107/124/108**
(policy) → **ISS-112/122/120** (findability) → **ISS-115/114/116** (navigation) → **ISS-117** (builder) →
**ISS-118/113/119** (parity, memory, environment).

---

## 14. Accessibility, responsive, performance, security/privacy, resilience, content, and trust summaries

- **Accessibility:** not systematically assessed this run — named gap, not a pass.
- **Responsive:** materially broken at the recorded 428×926 viewport (ISS-109) across both clients.
- **Performance:** no new defects; prior sync-storm and stale-handle fixes holding.
- **Security/privacy:** enforcement strong; policy *comprehension* weak. No new exposures found.
- **Resilience:** engine-level recovery strong; **run-level truthfulness** weak (ISS-110).
- **Content:** three trust-breaking strings identified (Active, Completed, File processed) plus the
  delete confirmation's misleading scope.
- **Trust:** the binding constraint. The owner can enumerate what each screen *should* do; what he cannot
  do is believe what any screen tells him.

---

## 15. Persona debrief (synthetic hypotheses)

Ross (real): "Tell me which Morning Briefing is the real one, and don't call something Active if it can't
run." Maya: "If the number says three, show me three things." Noah: "I just want my chores on the
computer." Ellen: "The Friday email either arrives or someone tells Ross it didn't." Sam: "A 7 AM run
that fails must not say Completed." **Wished-for features (hypotheses):** a per-helper reliability score
from run history; a "what ran while you slept" digest; one-tap re-run with the failure reason attached.

---

## 16. Comparator and research insights

The primary comparator input this run is the owner-supplied **independent ChatGPT analysis** (EV-117/118,
preserved at `docs/chatgpt-reports/`). It reached the same architectural framing from transcripts alone —
"objects look created before proven executable" (its RC-1/RC-2) — which materially raised confidence in
this report's central thesis. Per DEC-102 its hypotheses were **verified rather than adopted**: three
were upgraded to confirmed by source inspection (EV-105/107/109), and one of its inherited claims was
**corrected** — the automation status toggle does not trigger runs (EV-113/114), so triage BUG-033 is
superseded by ISS-116 (unattributed toasts). Its HO-001…HO-012 ticket set maps cleanly onto WP-101…WP-109
and its CAL-001…CAL-015 test plan is adopted wholesale into WP-103's validation.

---

## 17. Opportunity register and novel-feature portfolio

Each traces to an existing capability, not a wish:
- **OPP-101 — Readiness badge on every helper.** Once WP-101's preflight exists, surface its result as a
  green/amber/blocked chip. Near-free after WP-101; directly answers "which one is real?"
- **OPP-102 — Per-helper reliability score** from existing run history (FEAT-207). Fights silent
  degradation.
- **OPP-103 — "What ran while you were away" digest** assembled from runs + notifications, both of which
  already exist.
- **OPP-104 — Approval via contact method** (email/SMS "Approve?" links) reusing the verified contact
  registry — closes Sam's 7 AM gap.
- **OPP-105 — Template catalog dedupe** folding 23 workflow templates + 13 agent templates + playbooks
  into the packaged catalog already built in WP-005.

---

## 18. Prioritized remediation plan

1. **Immediate P0 stabilization:** WP-101 (acting agent + activation preflight + status aggregation).
2. **Data integrity:** WP-102 (production cleanup, sequenced behind idempotency).
3. **Cross-layer MVP shaping:** WP-103 (calendar correctness) — the daily-visible defects.
4. **Visual and interaction refinement:** WP-104 (wrapping + keyboard) — widest reach, shallow depth.
5. **Architecture correction:** WP-105 (policy inheritance), WP-108 (builder readiness).
6. **Findability and orientation:** WP-106, WP-107.
7. **Deferred:** WP-109 (parity/memory/environment), pending the platform decisions the owner still owes
   in `docs/platform-parity-matrix.md`.

---

## 19. Implementation-ready brownfield PRD

### 19.1 Problem statement and evidence
FamiliOS permits users to create and activate helpers, skills, and automations that are not guaranteed to
be executable, then reports their failures ambiguously. Confirmed mechanisms: null acting agent
(EV-105/106), client-only template instantiation with decorative multi-agent claims (EV-107/108/109), and
status aggregation that can read Completed over failed children (EV-103). Compounding this, the data
cleanup the owner approved was applied to a local copy rather than production (EV-121/122).

### 19.2 Target users and personas
Persona 1 (Ross, real) is the primary; Personas 2–5 are the affected simulated set (§7).

### 19.3 Current behavior and root cause
See §1 and `audit/issue-register.md`. Root cause in one line: **creation is treated as persistence when
it must be treated as compilation, and run start is treated as a write when it must be treated as a
contract.**

### 19.4 Goals, measurable success, non-goals
- **G1:** No run may exist with `sourceRef.agentId === null`. *Measure:* query returns zero such rows
  after the fix; unit test enforces at creation.
- **G2:** No automation may be `Active` with an unresolved dependency. *Measure:* instantiating a
  template with a missing agent/handler/integration yields `blocked_configuration`.
- **G3:** No parent run reads Succeeded when a required child failed. *Measure:* truth-table test.
- **G4:** Production helper count ≤20 with the evolution queue archived and 0 legacy parked runs.
  *Measure:* production export invariants.
- **G5:** Repeating a template instantiation with the same idempotency key creates exactly one instance.
- **Non-goals:** redesigning the visual system; migrating off SQLite; native-iOS visual work; adding new
  helper capabilities; any change to the approval *enforcement* model (only its resolution/UI).

### 19.5 Scope and out-of-scope
**In scope:** WP-101 and WP-102 if the Recommended bundle is selected (menu item 1+2); other WPs only if
individually selected. **Out of scope until selected:** WP-103…WP-109.

### 19.6 Chosen solution and rejected alternatives
**Chosen:** enforce the actor contract at run creation and add an activation preflight, then migrate
production behind idempotency. **Rejected:** (a) patching each visible error independently — the
recordings show the errors are one mechanism wearing different labels; (b) migrating production first
because it's already approved — HYP-108 says the catalog re-fills (DEC-104); (c) fixing the all-day bug
in the renderer — leaves web/digests/exports wrong (DEC-105).

### 19.7 Target end-to-end journey
Owner instantiates a template → the system compiles it and either activates it or shows exactly which
dependency is unresolved with a link to repair it → running it either executes with a named acting agent
or refuses before consuming steps → the result appears in Live and Run History with a truthful terminal
state → any external send is gated by the effective policy and its recipient allowlist.

### 19.8 UX/UI and content requirements
Use the existing design system. New states: `blocked_configuration` (amber, names the missing dependency,
links to its repair surface) and `partially_failed` (amber, names the failed child). Copy must avoid
"Active" for anything unvalidated. All new copy wraps at 428px.

### 19.9 State coverage
Loading (validating), empty (no dependencies), success (Ready/Active), invalid (blocked with named
cause), unauthorized (role-gated), denied (policy), offline (stale indicator), slow (validation >2s shows
progress), error (typed, actionable), retry, cancellation, undo (deactivate), recovery (revalidate on
dependency connect), responsive (428px), accessibility (labels on new chips), integration-unavailable
(named connector + link).

### 19.10 Frontend requirements
`createAutomationFromTemplate` calls the new server validation endpoint before creating; the store holds
the returned compiled manifest + lifecycle state; template detail renders multi-agent claims **only** when
backed; invalidate automation/run queries on mutation.

### 19.11 Backend requirements
New validation endpoint returning field- and node-level errors; `runSkill`/`orchestrate()` enforce a
non-null resolved actor at creation; `no_acting_agent` becomes a preflight error class; engine computes
parent terminal state from required-child outcomes.

### 19.12 Auth, tenancy, privacy, security
No change to enforcement. Validation must not leak provider errors verbatim. Migration touches one named
tenant only, through the server's own export/import path (hot-WAL rule).

### 19.13 Data model, provenance, migration
Additive: `lifecycleState`, `compiledManifestVersion`, `idempotencyKey` on automations; `beforeVersionId`
already exists from WP-008a. Existing Active-but-invalid automations migrate to `blocked_configuration`
(reversible by clearing the column). Production migration: backup → dry-run → apply → invariants → diff.

### 19.14 Performance and reliability budgets
Validation completes <2s p95 for a template of ≤10 steps; adds no more than one round-trip to
instantiation; no regression to the 3–4 req/min idle budget.

### 19.15 Observability
One correlation ID across instantiate → validate → activate → run → child step → tool call. Log
operation, entity ID, tenant, actor, validation result, terminal state. **Never** log household content
or secrets.

### 19.16 Acceptance criteria (functional)
As G1–G5 in §19.4, each observable via the named query or test.

### 19.17 Acceptance criteria (non-functional)
Suite stays ≥549 passing with 0 failures; typecheck clean; no new console errors at 428×926; validation
within the latency budget.

### 19.18 Validation plan
Unit (actor refusal, status truth table, idempotency), integration (template instantiate → activate →
run), contract (validation response shape), E2E on a disposable household (the JRN-2 journey end to end),
migration (dry-run + invariants on a production copy), regression (full suite + `topgun:web`), recovery
(restore from backup).

### 19.19 Thin vertical slices in dependency order
WP-101 slices 1→5, then WP-102 slices 1→5 (see `audit/implementation-queue.md`).

### 19.20 Rollout, flags, monitoring, rollback, cleanup
Preflight behind `HOMEOPS_ACTIVATION_PREFLIGHT`; migration is backup-first and restorable; monitor
duplicate-creation rate for one week post-migration (HYP-108); remove the flag once stable.

### 19.21 Risks, assumptions, blockers, open questions, definition of done
**Risks:** run-entry changes touch all surfaces (mitigated by the existing suite); production data work
is irreversible without its backup. **Assumptions:** production tenant ID is discoverable via the server
API. **Blockers:** none for WP-101; WP-102 requires the production tenant ID and an S8 authorization for
the production write. **Open questions:** HYP-101…HYP-108. **Definition of done:** G1–G5 met, validation
plan green, production invariants pass, and the JRN-2 journey completes end to end on the deployed build.

---

## 20. Orchestrator-ready implementation work packages

WP-101…WP-109 in `audit/implementation-queue.md`, each with objective, IDs, slices, acceptance criteria,
validation, risk, rollback, and sequence.

---

## 21. Numbered implementation menu and recommended bundle

| # | Item | User value | Scope | Dependencies | Risk | Effort | Leverage | Evidence |
|---|---|---|---|---|---|---|---|---|
| 1 | **Execution truth** — every run has a resolved actor; nothing activates unproven; status stops lying (WP-101) | Helpers actually run, or say exactly why not | ISS-102/103/110 | none | Med | M | **Highest** — one choke point, three confirmed defects | EV-105/107/109 |
| 2 | **Production cleanup, made durable** — migrate the real household behind idempotency (WP-102) | The catalog finally matches what you were told, and stays clean | ISS-101/111 | #1 | Med-High | M | High — closes the trust breach | EV-121/122 |
| 3 | **Calendar correctness** — all-day dates, create visibility, delete propagation, drafts (WP-103) | Events land on the right day, appear when made, stay deleted | ISS-104/105/106/121/123 | none | Med | L | High — daily visible | EV-110/111/101 |
| 4 | **Readability** — text wrapping everywhere + keyboard-aware iOS inputs (WP-104) | You can read and type on every page | ISS-109 | none | Low-Med | M | Broad, shallow | EV-101/102/103 |
| 5 | **One policy, one set of counts** (WP-105) | Set approvals once, not per entity | ISS-107/124/108 | #1 | Med | M | Removes ongoing toil | EV-102/103 |
| 6 | **Every number links to its things** (WP-106) | Counts and lists finally agree | ISS-112/122/120 | none | Low | S-M | Quick credibility win | EV-112/104 |
| 7 | **Navigation, activity, attributed toasts** (WP-107) | You know where you are and what just happened | ISS-115/114/116 | none | Med | M | Orientation | EV-103/113/114 |
| 8 | **Skill builder produces something runnable** (WP-108) | "Infer capabilities" yields a working draft or an exact gap list | ISS-117 | #1 | Med | M | Unblocks self-service | EV-102 |
| 9 | **Parity, memory quality, production runtime** (WP-109) | Web and iOS agree; memory stops duplicating | ISS-118/113/119 | #1, #3 | Med | L | Needs your platform picks | EV-102/103/122 |

**★ Recommended bundle: items 1 + 2 — "Helpers that really run, on data that's really clean."**
It fixes the three code-confirmed root causes at their single choke point, then lands the cleanup you
already approved onto production *in an order that keeps it clean* (DEC-104/108). It is the smallest
scope after which your success sentence — *"hey can you do this" → "done, as you requested"* — can pass
end to end on your real household rather than a disposable one.

Which numbered improvement, feature, or recommended bundle should I implement now?

---

## 22. Decision log and rejected alternatives

`audit/decision-log.md` — DEC-101…DEC-108: synthesis-audit framing over a re-crawl; verify-don't-adopt for
the second opinion; honest attribution of the prior mission's partial causality; idempotency-before-
migration sequencing; ingest-boundary date normalization; observed-not-root-caused honesty for ISS-105/106;
the BUG-033 correction; and the bundle recommendation with its reversal condition.

---

## 23. Remaining unknowns and next discriminating checks

`audit/hypothesis-queue.md` — HYP-101 (create-invisible: one API check splits three causes), HYP-102
(does delete ever call Google?), HYP-103 (which surface produces the grocery count), HYP-104 (how many
skills lack a default agent), HYP-105 (**Part 1's recording is only 9% covered by structured extraction —
re-split and re-run**), HYP-106 (does a disconnected account still render events), HYP-107 (do success
toasts fire before async completion generally), HYP-108 (will cleanup re-fill without idempotency).

---

## 24. Evidence index

`audit/evidence-ledger.md` — EV-101…EV-122: three Jam recordings, one full structured-intent dataset
(3,261 lines read in full), **10 source-code confirmations**, two baseline test runs, two independent
second-opinion reports, two prior triage documents, one deployment-config comparison, one production
health probe.

---

## 25. Screenshot gallery

No new screenshots were captured this run — the evidence base is three video recordings plus source
inspection (DEC-101). The prior mission's inspected screenshot gallery (27 originals) remains at
`.top-gun/runs/run-20260721-054151/implementation/evidence/` and is unmodified. Video evidence is
addressable by timestamp through the Jam links in §2 and EV-101/102/103.
