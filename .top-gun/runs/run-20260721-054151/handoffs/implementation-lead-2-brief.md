# Dispatch Brief — Implementation Lead 2 (mission finale)

- Run: run-20260721-054151
- State: IMPLEMENTATION_RUNNING (resume after window reset; prior lead unresumable)
- Date: 2026-07-22T09:35:00Z

## Objective

Close out the FamiliOS full-menu mission: execute the parked WP-006 s4–s7 (the 22-use-case executable benchmark suite + soak), clear the small residuals, and produce the final S7 verification matrix and mission-completion evidence. Everything else (WP-001..012) is shipped, committed, and pushed (origin/main @ 4d89f8d; Render auto-deploy; TestFlight build 24 submitted).

## Read first (in order)

1. implementation/PAUSE-STATE.md — authoritative banked state + residual list.
2. matching/capability-task-matching.md (ART-022, incl. addendum) — routing/budgets for WP-006 s4–s7.
3. audit/work-packages.md WP-006 rows + audit/prd.md per-UC acceptance criteria.
4. implementation/slice-log.md + implementation/verification-matrix.md — continue both.
5. Skills: top-gun:convergent-360, top-gun:lean-implementation, top-gun:mem (scripts at C:\Users\rhixon\.claude\plugins\cache\top-gun\top-gun\0.2.0\skills\mem\scripts\, --project "D:/FamiliOS/FamiliOS").

## Scope

1. WP-006 s4–s6: per-UC Playwright specs for all 22 use-cases through the real UI — 9 active UCs pass(real); 13 gated UCs pass(sandbox) via HOMEOPS_CONNECTOR_SANDBOX=1 + seeded accounts (server/test/README-sandbox.md has the recipe), each with its named real-credential blocker recorded. Disposable households ONLY (signUpDisposableHousehold + DELETE /api/account teardown).
2. WP-006 s7: soak — scheduler-driven unattended pass (tz-anchored triggers firing, approval push→decide→complete loop) per the WP's criteria.
3. Residuals: (a) legacy sweep stragglers — 2 pre-epoch waiting_for_connector runs (run_d0f11e1f, run_a4ef73a6) missed by the TTL matcher; diagnose the park-shape gap in engine.mjs expireStaleRuns, fix, re-sweep with HOMEOPS_SWEEP_LEGACY_PARKED=1 one-shot restart; also expire resident test-junk run_6b7e2c33 if the fix covers it; (b) Render bundle-hash verification: confirm https://homeops-ai.onrender.com serves the bundle built from 4d89f8d (compare dist asset hash pattern per the repo's established method); (c) update verification-matrix.md to final state; (d) final full validation: typecheck, npm test, npm run topgun:web.
4. Finish: slice-log entries, wave checkpoint journal, refreshed PAUSE-STATE, final delta at agent-deltas/implementation-lead-2-delta.md, commits per slice. Do NOT push — the orchestrator owns push.

## Rules (unchanged, load-bearing)

- Hot-WAL: never open the live tenant DB from a second process; server API/export only.
- Resident tenant read-only except the one-shot flagged sweep restart in scope 3a.
- No external sends; sandbox lanes only for gated UCs; no real credentials.
- Concurrency ≤3 subagents; sonnet-tier where the guide's fallback rows allow; bank (commit + PAUSE-STATE) at every wave boundary — assume any moment may cut off.
- User is away with authority delegated to the orchestrator: route would-be user questions to the orchestrator (return a checkpoint); never block.

## Model, effort, budget

Lead: fable/high (user directive). Sub-agents per ART-022 rows: UC specs fan-out sonnet (~180k soft), soak sonnet/low (~20k), residuals sonnet/medium (~30k). Total soft ~280k + 60k reserve.

## Return format

Per-UC results table (pass(real)/pass(sandbox+blocker)/fail with evidence paths), soak verdict, residual outcomes (straggler fix + re-sweep proof, Render hash verdict), final suite numbers verbatim, commits, budget vs plan, verification-matrix final state, anything remaining for the user.
