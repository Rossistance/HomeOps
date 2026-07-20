# Matching Lead Delta — run-20260720-073025

- Agent: matching-lead (single matching-phase lead)
- Phase: MATCHING_RUNNING → done (guide validated)
- Window: 2026-07-20T12:16Z–12:3xZ
- Brief: ART-018 (handoffs/matching-lead-brief.md)

## What was produced

- `matching/capability-task-matching.md` — full guide per the capability-task-matcher document contract: capability map (fresh probes, 25 rows), phase matrix, 11-row task matrix (T-101..T-701 covering menu items 1–6 + verification wave), model/effort rationale from lean-implementation canonical tables, planned budget ledger (bundle 285k soft incl. 45k reserve; all-six 375k incl. 55k), concurrency/write-ownership plan (G-SERVER serialized / G-CLIENT parallel / G-VERIFY), authority constraints, unavailable-capability effects, supplemental spec (write-spec structure) + design-side grounding (design-critique), reassessment triggers.
- validate_matching: PASS after 2 fixes (missing Model column in T-302 row; totals lines) — final: `OK: matching guide valid (0 warning(s)).`
- Journal events #34–#38 (start, inventory checkpoint, routing checkpoint, artifact, completion).

## Capability probes run (all fresh this session, ~12:16–12:24Z)

git HEAD c0c4596 (harness-only uncommitted edits in tests/topgun/web/*); node 20.20.2 default + 25.8.2 nvm; npm scripts read; harness files verified (assistant-persistence, family-safety, repro evidence scripts); runtime-drivers.json read + playwright 1.61.1 probe pass; web-lane green status verified by file evidence (seedReturningUserState present) — suite NOT re-run, stack left DOWN as found (netstat + curl proof); prod /api/health OK v1.2.0 node 24.18.0 (stale lineage unchanged); appium/appetize/Render env vars all absent; gh absent; python 3.14.3; ToolSearch deferred-load verified (WebFetch); model aliases haiku/sonnet/opus/fable observed; ~63 OAuth-pending MCPs = blocked. Deltas vs ART-002: web lane blocked→green; stack up(audit)→down(now); everything else unchanged.

## Key routing decisions

- All server-seam work (T-101/102/103/201/301/302/401, and T-501 if consented) runs INLINE in the implementation lead at model=inherit (frontier): single serialized write surface (planner/engine/triggers/index/assistant-runs overlap across WPs) — delegation fails every lean spawn criterion there. Effort high for P0/cross-layer (T-101/T-301/T-401/T-501), medium for well-specified S slices.
- Client surface (T-402/T-601) delegated to one sonnet/medium subagent — isolated write surface + genuine parallelism.
- T-701 final verification: fresh-eyes subagent at xhigh, funded from reserve only.
- WP-005 = T-501 is consent-gated (DEC-A04): not dispatchable without the user's explicit selection; mandatory xhigh adversarial review; mocked-Gmail acceptance; live send only with explicit user authorization to a user-owned inbox.
- Every task row carries a considered-and-rejected alternative route per matching policy.

## For the implementation lead — revalidate at dispatch (drift-prone)

1. Stack boots clean (dev.mjs, node 25.8.2, /api/health) and `npm test` green BEFORE first edit (308/308 is historical).
2. Playwright smoke 5-pass/1-skip — the enabling harness edits are UNCOMMITTED working-tree files (tests/topgun/web/helpers.ts, smoke.spec.ts); protect/commit them or the client verification lane dies.
3. Selection scope + WP-005 consent decision; partial selections re-derive G-SERVER ordering.
4. Prod stays BLOCKED for verification until the user repairs Render deploy (then: bundle-hash check + JRN-1 re-run before any prod claim).

## Blockers (none for dispatch)

Production verification and live delivery remain blocked with exact user-side unblocks (recorded in the guide's Unavailable Capability Effects). Nothing blocks implementation dispatch once selection is recorded.

## Budget

Matching phase: ~35–40k output tokens consumed vs 120k soft plan (~30%). No interventions, no drift, no nested delegation used (no evidence-gathering need arose that probes could not satisfy inline).
