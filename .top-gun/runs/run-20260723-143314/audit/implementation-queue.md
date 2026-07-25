# Implementation Queue — Work Packages — run-20260723-143314

Nine work packages covering all 24 issues. Sequence rationale in DEC-104 and DEC-108.

## WP-101 — Execution truth: every run has a resolved actor, and nothing activates unproven

- **Objective:** Make it impossible to start a run without an acting agent, and impossible to mark an automation Active while its dependencies are unresolved.
- **Issue/Feature IDs:** ISS-102, ISS-103, ISS-110 · FEAT-213, FEAT-214, FEAT-206, FEAT-207
- **Rationale:** ISS-102 and ISS-103 are code-confirmed (EV-105, EV-107, EV-109) and are the direct mechanism behind the reporter's most-repeated failures — `no_acting_agent`, "no recipe found", "these agents just don't exist". ISS-110 is what lets those failures masquerade as success.
- **User outcome:** A helper either runs and reports truthfully, or refuses at creation with a specific reason. No more silent nulls.
- **Architecture outcome:** One preflight boundary; run creation becomes a compile step, not just a write.
- **Affected personas/journeys:** Ross (JRN-1), Sam (JRN-5), Maya (JRN-2)
- **Files/modules:** `server/orchestrator.mjs:121-130`, `server/engine.mjs` (status aggregation), `src/store/useStore.ts:2234-2259`, `src/data/workflowTemplates.ts`, new server-side template/automation validator, `server/internal-functions.mjs:487` (error becomes preflight, not runtime)
- **Implementation slices:**
  1. `runSkill` refuses or resolves: no run may reach `startRun` with `sourceRef.agentId === null`. Reuse the household-default-agent self-heal already shipped for chat (commit `368514d`).
  2. Move the `no_acting_agent` determination from tool execution to run creation, so it surfaces before steps are consumed.
  3. Add `partially_failed`; Succeeded requires every required child step succeeded.
  4. Server-side validation endpoint for template instantiation: agent, skills, handlers, integrations, recipient resolvable → else `blocked_configuration`.
  5. `createAutomationFromTemplate` either creates/binds every `multiAgent` role, or the multi-agent UI is removed for templates that don't back it (choose in-slice; record in decision log).
- **Design/content:** Blocked state needs plain-language copy naming the missing dependency and linking to its repair surface.
- **State/API/data/migration:** New automation lifecycle states; existing Active-but-invalid automations migrate to `blocked_configuration` (reversible, additive column).
- **A11y/responsive/security/perf:** Blocked-state copy must wrap at 428px (see WP-104); no new egress; validation must not leak provider errors verbatim.
- **Dependencies:** none (this is the root)
- **Acceptance criteria:**
  - `runSkill` with a skill lacking `defaultAgentId` and no caller `agentId` either resolves a real household agent or returns a creation-time error; a run row with null `agentId` can never be persisted.
  - A required child-step failure never yields parent status Succeeded.
  - Instantiating a template whose referenced agent/handler/integration is unresolved produces `blocked_configuration`, not Active.
  - For a template declaring N multi-agent roles, after instantiation either N agents resolve or zero multi-agent claims are displayed.
- **Focused validation:** `node --test` truth table for status aggregation; unit test for null-actor refusal; E2E template→activate→run on a disposable household.
- **Risk:** Medium — touches the run entry path all surfaces share. Mitigated by the existing 549-test suite and the `orchestrate()` single entry from WP-006.
- **Rollout/rollback:** Feature-flag the preflight (`HOMEOPS_ACTIVATION_PREFLIGHT`); migration is additive and reversible by clearing the column.
- **Sequence:** 1st.

## WP-102 — Production data cleanup, made durable by idempotency

- **Objective:** Execute the already-approved cleanup against the *production* tenant, and stop duplicates regenerating.
- **Issue/Feature IDs:** ISS-101, ISS-111 · FEAT-201, FEAT-206
- **Rationale:** EV-121/122 prove the 2026-07-21/22 operations targeted the local dev tenant only. HYP-108: migrating without idempotency re-fills the catalog.
- **User outcome:** The Helper Agents list finally matches what the owner was told two days ago, and stays that way.
- **Affected personas/journeys:** Ross (JRN-1)
- **Files/modules:** migration tool, `wp008b-execute.mjs`, template/agent generators, Render one-shot job
- **Implementation slices:**
  1. Idempotency keys + semantic-match detection on generate/instantiate; offer update / create-separate / cancel.
  2. Fresh production backup **through the server's own export endpoint** (hot-WAL rule).
  3. Dry-run against production data; regenerate the disposition table (production ≠ local).
  4. Execute with `--tenant <prod-id>` + `HOMEOPS_MIGRATION_CONFIRM=yes`; run the four invariants; diff vs backup.
  5. One-shot `HOMEOPS_SWEEP_LEGACY_PARKED=1` restart for production's stuck runs.
- **State/data/migration:** Archive-not-delete throughout; version stores never deleted; rollback = backup re-import.
- **Security/privacy:** Backup contains household data — never leaves the server; no content in logs.
- **Dependencies:** WP-101 (idempotency belongs with the creation path being fixed there)
- **Acceptance criteria:** Production helper count ≤20; evolution queue archived; 0 legacy parked runs; post-diff shows only expected deltas; repeating a template instantiation with the same key creates exactly one instance.
- **Focused validation:** Invariant script on production export; idempotency unit test.
- **Risk:** Medium-high (production data) — mitigated by dry-run-first, backup-first, archive-not-delete, and the identical procedure already rehearsed successfully on local.
- **Rollout/rollback:** Restore from the pre-execution backup.
- **Sequence:** 2nd.

## WP-103 — Calendar correctness: dates, creation, deletion

- **Objective:** An event shows on the right days, appears when created, and stays deleted.
- **Issue/Feature IDs:** ISS-104, ISS-105, ISS-106, ISS-121, ISS-123 · FEAT-203
- **Rationale:** ISS-104 is code-confirmed (EV-110/111) and wrong every day for every all-day event. ISS-105/106 are the reporter's "major error" and the silent-resurrection case.
- **Files/modules:** `server/calendar.mjs:23-26,150`, delete route, `apps/mobile/src/lib/event-days.ts:16`, mobile event form
- **Implementation slices:**
  1. Normalize Google's exclusive all-day `end.date` **once at ingest**; document `endAt` as inclusive beside `coversDay`; back-fill stored events.
  2. **Run HYP-101's check before coding ISS-105** (create in-app → `GET /api/events`), then fix the branch it identifies.
  3. **Run HYP-102's check** (does delete call Google?), then propagate delete via `provenance.googleEventId` or persist a tombstone sync respects; fix the confirmation copy to state the Google outcome.
  4. Persist event drafts per household+draft id; clear on save or explicit discard.
  5. Surface `needs_reconnect` accounts as actionable; never let a disconnected account contribute silently rendered events.
- **Acceptance criteria:** A 1-day all-day event renders on exactly 1 day and a 3-day on exactly 3; a created event appears without manual refresh; a failed create keeps the editor open with the server error; a deleted Google-linked event does not reappear after sync; a dismissed draft is restored.
- **Focused validation:** Round-trip unit test for all-day boundaries (both directions); E2E create→list and delete→sync on a disposable household; iOS visual check at 428×926.
- **Risk:** Medium — date semantics touch stored data; back-fill needs care.
- **Rollout/rollback:** Ship the ingest fix behind a migration that can be re-run idempotently.
- **Dependencies:** none · **Sequence:** 3rd.

## WP-104 — Readability: text wrapping and keyboard-aware input

- **Objective:** No user-entered text is ever silently truncated, and no focused field hides behind the iOS keyboard.
- **Issue/Feature IDs:** ISS-109 · FEAT-220
- **Rationale:** "None of it wraps, I can't read any of it… and that's the same for every single page" — the widest-reaching usability defect across all three recordings.
- **Files/modules:** mobile event form + list components, web list/card/detail components, shared `Field`/input primitives
- **Implementation slices:** keyboard-aware scroll container + scroll-to-focused-input on iOS; multiline/dynamic-height titles; wrap-or-horizontally-scroll for all user text on web; Next/Done field navigation.
- **Acceptance criteria:** At 428×926, no user text is clipped without a wrap or scroll affordance; every event-editor field is reachable with the keyboard open; long titles remain reviewable in editor, detail, agenda, and month views.
- **Focused validation:** Visual tests at 428px and one smaller width; a11y label checks.
- **Risk:** Low-medium (broad but shallow).
- **Dependencies:** none · **Sequence:** 4th.

## WP-105 — One approval policy, one set of counts

- **Objective:** Replace per-entity approval toggles with an inherited effective policy, and make capability counts derive from one computation.
- **Issue/Feature IDs:** ISS-107, ISS-124, ISS-108 · FEAT-216, FEAT-202, FEAT-215
- **Implementation slices:** precedence household → agent → automation → skill; per-entity screens show inherited state read-only unless explicitly overridden; one derivation for executed/permitted/available with defined labels; make the unified-nav flag and Advanced Mode mutually exclusive (or one 3-state control); fix the truncated "skip" label.
- **Acceptance criteria:** One effective-policy view states allowed/blocked/needs-approval and names the rule that produced it; a generated agent inherits without manual configuration; all counts on the capabilities screen derive from one policy computation; enabling unified nav cannot be silently undone.
- **Focused validation:** Policy resolution unit tests; component test for the toggle interaction.
- **Risk:** Medium (permissions are security-adjacent — negative tests required).
- **Dependencies:** WP-101 · **Sequence:** 5th.

## WP-106 — Every number links to the things it counts

- **Objective:** Any surface showing a count must link to a view containing exactly those items.
- **Issue/Feature IDs:** ISS-112, ISS-122, ISS-120 · FEAT-205, FEAT-204, FEAT-226, FEAT-212, FEAT-225
- **Implementation slices:** one canonical selector per count/list pair (grocery first, per EV-112); duplicated mini apps either created active or their destination stated; separate "processed" from "indexed" with honest labels.
- **Acceptance criteria:** Dashboard grocery count equals the Shared Grocery List's item count from the same query; no success toast fires while the entity remains unindexed; a duplicated mini app is visible where it was created or its destination is named.
- **Focused validation:** Selector parity test; pipeline state test.
- **Risk:** Low.
- **Dependencies:** none · **Sequence:** 6th.

## WP-107 — Navigation, activity, and attributed toasts

- **Objective:** The user always knows where they are, what just happened, and which entity it happened to.
- **Issue/Feature IDs:** ISS-115, ISS-114, ISS-116 · FEAT-219, FEAT-218, FEAT-221
- **Implementation slices:** nested routes with local back + scroll restoration; product-level activity event schema (actor/action/subject/result/reason/deep-link) replacing "A helper did something technical"; attribute every toast to its entity.
- **Acceptance criteria:** Back returns to the immediate parent and restores scroll; no production activity entry renders generic copy; every toast names its entity.
- **Focused validation:** Navigation E2E; activity feed rendering test.
- **Risk:** Medium (routing changes are broad).
- **Dependencies:** none · **Sequence:** 7th.

## WP-108 — Skill builder produces something runnable

- **Objective:** "Infer capabilities" yields either a complete validated draft or an exact list of what's missing — never a half-built handler you can still press Test on.
- **Issue/Feature IDs:** ISS-117 · FEAT-222
- **Implementation slices:** typed capability graph from inference; generate or bind functions explicitly; disable Real Test until readiness passes; preserve entered configuration across inference failures; supported browser-location implementation with fixtures.
- **Acceptance criteria:** Real Test is disabled while readiness errors exist and the unresolved dependency list is shown; a failed inference preserves all entered content.
- **Focused validation:** Builder unit tests including the recorded Daycare-agent flow.
- **Risk:** Medium.
- **Dependencies:** WP-101 · **Sequence:** 8th.

## WP-109 — Parity, memory quality, and production environment truth

- **Objective:** Web and iOS agree; memory stops duplicating; production stops silently lacking a runtime.
- **Issue/Feature IDs:** ISS-118, ISS-113, ISS-119 · FEAT-223, FEAT-217, FEAT-224
- **Implementation slices:** server-authoritative entity + version in mutation responses, aligned date-range fields; semantic memory upsert keys, typed location context, provenance; provision the browser runtime in production or surface it as unavailable.
- **Acceptance criteria:** The same entity returns identical ID/version/status/date fields to both clients; re-ingesting the same fact updates one record; browser tools either work in production or are shown unavailable rather than failing silently.
- **Focused validation:** Cross-client contract test; memory ingestion idempotency test; production health assertion.
- **Risk:** Medium — parity work is gated on the platform decisions in `docs/platform-parity-matrix.md`.
- **Dependencies:** WP-101, WP-103 (date fields) · **Sequence:** 9th.
