# Dispatch Brief — Matching Lead

- Run: run-20260720-225249
- State: AUDIT_COMPLETE → MATCHING_RUNNING
- Date: 2026-07-20T23:40:00Z

## Objective
Produce `matching/capability-task-matching.md` routing the 24 WPs (WP-001..013) so the implementation lead can build the 22 use-cases the moment selection is recorded. Since the user pre-selected the full mission ("build all, commit, push, deploy, TestFlight"), route the WHOLE queue.

## Scope and non-goals
- In scope: fresh capability inventory (probe, don't trust prior runs); route each WP with model/effort/soft-budget, concurrency groups, and verification lane (active items → local-stack skill run via the WP-013 harness; inactive items → contract/mock + criteria doc only; ship WP → commit/push/deploy/TestFlight). Map the build's file surfaces (src/data/agentTemplates.ts, workflowTemplates.ts, playbooksCatalog.ts, catalogIds.ts; backing skills; docs/use-case-criteria/**; server skill catalog if a tool is genuinely missing).
- Out of scope: implementation; re-auditing; connector activation; native iOS visual lane (closed).
- Authority: read repo + run; write ONLY matching/** + agent-deltas/matching-lead-delta.md + journal/ledger. Prod /api/health only; NO scripted live mutation (guardrail).

## Required skills
- top-gun:capability-task-matcher (first; its init/validate scripts), top-gun:lean-implementation (budget/model tables), top-gun:mem.

## Required inputs
- `audit/implementation-queue.md` (ART-006 — the 24 WPs), `audit/master-report.md` (ART-004 — §6 mapping table, §"Criteria-doc format", numbered menu), `audit/issue-register.md`, `audit/decision-log.md` (DEC-001 catalog+skill, DEC-003 criteria docs; ratified + the 4 corrections), `facts-and-notes.md` (ART-001 — connector inventory), `source-use-cases.txt` (ART-002).
- Local stack: boot on demand (scripts/dev.mjs, node 25.8.2 at C:\Users\rhixon\AppData\Roaming\nvm\v25.8.2). Baseline 352 tests + both tsc green (revalidate).

## IDs in play
- WP-001..013 | FEAT-001..022 | ISS-001..008 | DEC-001..003 | UC-01..22.

## Required outputs
- `matching/capability-task-matching.md` (per the matcher contract).
- Agent delta: `agent-deltas/matching-lead-delta.md`.
- Validation: `validate_matching.py --project "D:\FamiliOS\FamiliOS"` + `validate_memory.py` — pass verbatim before return.

## Write surface / collisions
- May write: matching/**, agent-deltas/matching-lead-delta.md, journal/ledger. Not audit/**, not product source, not other runs.

## Model, effort, budget
- Model: inherit session model. Effort: medium (WPs are well-specified; routing is synthesis). Token budget: 120k soft.

## Checkpoints / drift / stop
- Checkpoints: after capability inventory; before validation.
- Drift: re-auditing, product writes, inventing tool ids, budget >150% pro-rata.
- Stop: validator non-convergence 3×.

## Return format
- Outcome; guide path; validate_matching + validate_memory verbatim; capability deltas vs ART-001; one-line routing per WP; total planned budget + reserve; blockers with exact unblocks; budget consumed.
