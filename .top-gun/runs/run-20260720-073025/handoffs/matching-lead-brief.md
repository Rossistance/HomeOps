# Dispatch Brief — Matching Lead

- Run: run-20260720-073025
- State: AUDIT_COMPLETE → MATCHING_RUNNING (at dispatch)
- Date: 2026-07-20T08:40:00Z

## Objective

Produce the validated capability-task matching guide for the audit's work packages (WP-001..WP-006, menu §21 of the master report) so that, the moment a selection is recorded, the implementation lead can be dispatched with a routed, budgeted, verification-mapped task plan. Done = `matching/capability-task-matching.md` complete for all six menu items (bundle-aware: 1+2+3+4 is the recommended bundle), validate_matching passes, delta written.

## Scope and non-goals

- In scope: fresh capability inventory (probe, don't trust prior runs), task decomposition and routing for WP-001..006 per the implementation queue, model/effort/budget columns per lean-implementation policy, verification-surface rows per WP (server harness tests, live local-API probes, playwright web lane — NOW GREEN: smoke 5-pass/1-skip via seedReturningUserState in tests/topgun/web/helpers.ts, journal event #10), concurrency groups, reserve.
- Out of scope: any implementation; re-auditing (the audit is validated); native iOS visual lanes (closed, DEC-10 prior run); production verification (Render deploy broken user-side — mark prod rows blocked with that exact unblock).
- Authority boundary: read everything in this run + repo; write ONLY `matching/**`, `agent-deltas/matching-lead-delta.md`, journal/ledger via mem scripts. No product writes, no live sends, prod /api/health only.

## Required skills

- top-gun:capability-task-matcher (invoke first; use its init_matching + validate_matching scripts), top-gun:lean-implementation (budget/model policy tables), top-gun:mem.

## Required inputs

- `audit/implementation-queue.md` (WP-001..006 specs), `audit/master-report.md` §21 menu + PRD sections, `audit/issue-register.md` (ISS-001..011), `audit/evidence-ledger.md` (EV-001..028), `audit/decision-log.md` (DEC-A01..A05 ratified — esp. A04 bundle composition, WP-005 consent gate).
- `facts-and-notes.md` (ART-002) capability inventory section — REVALIDATE, don't inherit: local stack was stopped by the audit lead (restore via scripts/dev.mjs when a probe needs it, node 25.8.2); web lane status changed this run (green — event #10).
- `server/test/assistant-persistence.test.mjs` (fakeProvider harness — the verification lane for engine/planner WPs).

## IDs in play

- WP-001..006 | ISS-001..011 | EV-001..028 | DEC-A01..A05 (ratified) | HYP-005..008 (open follow-ups) | ART-002..017.

## Required outputs

- `matching/capability-task-matching.md`: complete guide per the matcher skill contract.
- Agent delta: `agent-deltas/matching-lead-delta.md`.
- Validation: the capability-task-matcher skill's `validate_matching.py --project "D:\FamiliOS\FamiliOS"` must pass verbatim before return; also `validate_memory.py` clean.

## Write surface and collision risks

- May write: `matching/**`, `agent-deltas/matching-lead-delta.md`, journal/ledger via scripts.
- Must not write: `audit/**`, `handoffs/**`, `facts-and-notes.md`, `phase-state.md`, product source, other runs (esp. run-20260720-072344 — a possibly-active foreign session's run).
- Known concurrent writers: the foreign session may append journal/ledger rows via the shared current-run pointer — ignore foreign rows, never delete; journal a disagreement if matching/ files are touched by anyone else.

## Model, effort, and budget

- Model: inherit session model (Fable) — routing quality determines the whole implementation phase; high ambiguity in verification-lane mapping.
- Reasoning effort: medium — the audit's WPs are already well-specified; matching is synthesis, not discovery. Escalate to high only if WP specs prove ambiguous.
- Token budget: 120k output tokens (soft — host does not enforce).

## Checkpoints, drift, and stop conditions

- Checkpoints: after capability inventory; after routing half the WPs; before validation.
- Drift signals: re-auditing, product writes, budget >150% pro-rata, inventing capabilities without probes.
- Stop immediately when: validator loops without convergence 3×; foreign writes corrupt matching/.

## Return format

- Plain-language outcome; guide path; validate_matching + validate_memory outputs verbatim; capability deltas vs ART-002 inventory; per-WP routing summary (one line each); budget consumed vs plan; blockers with exact unblock conditions.
