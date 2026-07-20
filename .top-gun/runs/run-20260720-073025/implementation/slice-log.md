# Slice Log — run-20260720-073025

Implementation lead. Five-point iteration check per slice:
(1) does the change work as expected? (2) did it break anything that worked?
(3) do narrow/mobile/responsive or platform-equivalent layouts still hold?
(4) are required integrations still connected? (5) verdict `ship` / `another-round`.

Baseline at first edit (revalidated, not inherited): HEAD c0c4596 + the two protected
uncommitted harness files. `npm test` 308/308. Root tsc 0. apps/mobile tsc 0.

---

## S1 — WP-001 slices 1–3: build-target linkage, unrunnable refusal, honest refusal copy

Files: `server/index.mjs` (materializeBuild, both build routes, persistBuildFailure).

The root cause, in one line: `materializeBuild` built the automation target as
`{kind:"agent", agentId}` — carrying WHO should run but never WHAT to run. Every
scheduled fire therefore fell through `runAgent`'s third branch into
`buildReadonlyPlan`, a zero-effect status pass that reported success.

1. Works: the created trigger's `target.skillId` now equals the created skill; a
   spec with neither skill nor goal throws `unrunnable_automation` → 422, and the
   conversation gets a plain-language refusal.
2. No breakage: 308/308 unchanged. The change is additive — pre-existing triggers with
   old targets still fire through the unchanged branches.
3. Layout: no client surface touched in this slice.
4. Integrations: createTrigger/createSkill/createAgent contracts unchanged.
5. Verdict: ship

## S2 — WP-001 slice 5: one Draft/Active lifecycle (DEC-I01)

Files: `server/index.mjs` (createAgent call + notes).

Decision recorded: **a chat-built agent that the same build puts on a schedule lands
Active; a build with no automation stays Draft.** Considered and rejected: keeping
everything Draft and refusing to fire — that is a silent no-op wearing a safety badge,
and status was never enforced at run time anyway (verified in `agents.mjs`: neither
`selectAgent` nor `isToolStepAllowed` consults it). Safety stays where it actually
lives: the per-step approval gate.

1. Works: persona suite asserts Active-with-automation and Draft-without.
2. No breakage: full suite green.
3. n/a this slice. 4. Unchanged. 5. Verdict: ship

## S3 — WP-002: anchored scheduling

Files: `server/triggers.mjs` (parseAnchor, tzOffsetAt, wallClockToUtc,
nextAnchorOccurrence, scheduleTextFor, createTrigger, updateTrigger, tick,
publicTrigger), `server/planner.mjs` (normalizeBuild + ASSISTANT_SYS), `server/index.mjs`.

1. Works: creation at any hour → `nextRunAt` is the next 07:00 local; post-fire
   recompute returns 07:00 again rather than fire-time+24h; a DST fixture
   (America/New_York across 2026-03-08) holds 07:00 wall-clock on both sides.
2. No breakage: interval-only triggers keep their exact previous behaviour — the
   anchor branch is only entered when an anchor exists.
3. `scheduleText` added to publicTrigger for client rendering (consumed in S8).
4. Timezone source is the household setting; absence is DISCLOSED via `tzSource:
   "server"`, never silently guessed.
5. Verdict: ship

## S4 — WP-003: truth taxonomy

Files: `server/planner.mjs` (claimsExternalEffect + normalizePlan),
`server/engine.mjs` (step record, clampedOut branch, skipped_no_tool branch),
`server/orchestrator.mjs` (visible clamp), `server/index.mjs` (publicRun).

Two seams, one principle: a run may never claim an effect it did not attempt.
- A toolless step whose own words claim a send is `skipped_no_tool`, not `succeeded`.
- A policy-clamped step SURVIVES into the run as `skipped` with its reason, instead of
  being filtered out of the plan and vanishing without trace.

1. Works: repro B and repro C both assert the new states.
2. No breakage — and this is the slice with real regression risk, so it is guarded
   explicitly: a CONTROL test asserts an all-real-tool run keeps its "Done —" copy, and
   a second asserts the "Compose the briefing" reasoning step still succeeds. The
   detector is deliberately narrow (delivery verbs, with preparatory-verb exclusion).
3. New statuses reach both clients via publicRun (rendered in S8).
4. Unchanged. 5. Verdict: ship

## S5 — WP-003 summary + save-offer gating

Files: `server/assistant-runs.mjs` (summarizeOutcome, shortfallLines, runOutcomeText,
worthSavingAsHelper).

1. Works: a no-delivery run now reads "I finished X, but nothing was actually sent."
   plus a per-step shortfall list; the save-as-helper offer is suppressed.
2. No breakage: control test confirms genuine successes keep "Done —".
3. n/a. 4. Unchanged. 5. Verdict: ship

## S6 — WP-004: park/expiry honesty

Files: `server/engine.mjs` (onRunParked/fireRunParked, expiry → fireRunFinished,
notifyRepeatedNonDelivery), `server/assistant-runs.mjs` (park message),
`server/triggers.mjs` (lastStatus writeback on both park and finish).

1. Works: a parked run posts a waiting message naming the step and the expiry window;
   expiry now reaches the run-finished observers (it previously did not, which is why
   an expired approval produced total silence); expiry counts toward the keeps-failing
   alert.
2. No breakage: full suite green. Duplicate-message risk handled by a
   `runId:stepIndex` announce-once guard.
3. Client waiting/expired rendering delegated to S8.
4. Unchanged. 5. Verdict: ship

## S7 — WP-005: registry delivery tool (security-sensitive)

Files: `server/internal-functions.mjs` (homeops.notify_contact), `server/notify.mjs`
(kill switch on external channels, stale-account honesty, sender actor resolution),
`server/engine.mjs` (ctx.agentId threading), `server/planner.mjs` (catalog + steering).

1. Works: 9/9 adversarial gate tests. Every gate refuses; the all-pass case proceeds to
   the transport and reports the real outcome instead of claiming delivery.
2. No breakage: full suite green.
3. n/a. 4. **A real pre-existing gap was closed here**: `deliverViaChannel`'s email
   branch never consulted `externalActionsEnabled`. Harmless while nothing could reach
   it unattended; unacceptable the moment this tool makes it schedulable.
5. Verdict: ship — pending the adversarial review's verdict (recorded in the matrix).

## S8 — WP-004/WP-006 client surfaces (delegated, sonnet/medium) + browser pass

Delegated to two parallel subagents on disjoint client write surfaces per the matching
guide (T-402, T-601); the lead closed two files neither agent was permitted to reach
(`apps/mobile/src/app/(home)/activity.tsx`, and the step-status rendering in
`apps/mobile/src/app/(ask)/index.tsx`).

1. Works: the real browser renders the honest non-delivery copy in the ExecutionMonitor
   timeline; web smoke holds its 5-pass/1-skip baseline.
2. Broke nothing that worked: smoke lane unchanged; the 3 `core-flows` failures are
   pre-existing (Calendar/nav files are byte-identical to HEAD) and are recorded as
   failures, not passes.
3. **Responsive: verified in a real browser** — no horizontal overflow at iPhone width,
   and the caveat is not clipped or hidden behind an expander.
4. Integrations: both clients consume the server contract (`skipped_no_tool`, `skipped`
   + `clampedOut`, `expired`, `scheduleText`, terminal `lastStatus`).
5. Verdict: ship

**The browser pass earned its mandate.** It found what 350 green server tests missed:
`normalizePlan` is not on every path into a run, so a SKILL's toolless send step — the
user's actual scenario — still reported `succeeded`. Fixed in `startRun` and pinned by
two new tests. Had this slice been signed off on code-tracing, the headline bug would
have shipped unfixed behind a green suite.

## S10 — WP-005 security remediation (adversarial review findings)

Files: `server/index.mjs`, `server/engine.mjs`, `server/agents.mjs`.

The mandatory xhigh review returned **do-not-ship** with 3 CRITICAL + 2 HIGH findings.
Each was independently verified against the code before being fixed, and each is pinned
by a regression test (C1, C2, C3, C3b, H1, H1b, H2).

1. Works: 16/16 in the WP-005 suite.
2. Two of my own fixes over-corrected and broke existing tests; the suite caught both
   and each was narrowed to the real hole rather than left blunt.
3. n/a. 4. Unchanged. 5. Verdict: ship

## S9 — WP-006 server half: role-aware proposals (ISS-011)

Files: `server/index.mjs` (demoteBuildForRole, both assistant routes).

Found by the promoted persona suite rather than by inspection: a Guest genuinely did
receive a build card that then 403s on confirm. Demoted server-side to a plain answer
that names who can actually set it up.

1. Works: persona suite 10/10. 2. No breakage: 343/343. 3. n/a. 4. Unchanged.
5. Verdict: ship
