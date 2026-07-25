# Budget Ledger — run-20260723-143314

Soft budgets (advisory, checkpoint-enforced by the orchestrator). Host does not enforce a hard cap.
Mission reserve held for verification/integration: ~20%.

| Agent / role | Task class | Model | Effort | Budget (plan) | Actual | Variance | Cause |
|---|---|---|---|---|---|---|---|
| Agent A — run-path actor + status (WP-101 s1-3) | M | opus | high | 90k | ~32k | −64% | Tight scope, clean root cause already located by the audit; agent spent its effort on correctness (optionality stamped rather than guessed) instead of exploration |
| Agent B — activation preflight (WP-101 s4) | M | sonnet | high | 60k | well under (self-reported, not instrumented) | under | New-file work with a fixed contract; no ambiguity to resolve |
| Agent C — client honesty + idempotency (WP-101 s5 + WP-102 s1) | M | sonnet | high | 70k | well under (self-reported, not instrumented) | under | Most spend was grounding exploration (server preflight source, seed data, template defs) + a live browser verification round-trip |
| Orchestrator — audit S0–S4 + integration + reconciliation | L | opus | high | (mission reserve) | not instrumented | — | Audit synthesis, 10 source confirmations, cross-agent conflict resolution, 3 integration fixes, commits |

**Honesty note:** the host exposes no per-agent token accounting to this session, so "actual" for
agents B and C is their own self-report and A's is its own estimate. Only A's figure is a considered
number; the others are directional. This is recorded as an instrumentation gap, not a measurement.

## Interventions

| # | Trigger | Ladder step | Action | Journal |
|---|---|---|---|---|
| 1 | Agent B flagged a contract ambiguity (`missing_agent` vs `no_acting_agent`) that Agent C was coding against | Steer | Relayed the disambiguation to C mid-flight so the two halves would agree at the seam | event #13 chain |
| 2 | Agent A reported that its `partially_failed` status was mishandled in `useStore.ts` (C's surface) | Steer | Relayed to C as a mid-task scope addition; C fixed all 3 sites + outputSummary | agent C report |
| 3 | **Cross-agent conflict:** A and B independently built acting-agent resolution with different semantics (B's used `selectAgent`'s "any active agent" fallback — the ISS-103 antipattern inside the validator meant to prevent it) | Orchestrator inline fix | Reconciled onto one resolver with a documented deliberate asymmetry; first attempt regressed 1 test, corrected, 14/14 green | event #14 |
| 4 | Agent A correctly refused to edit 3 sibling surfaces and reported them instead | Orchestrator inline fix | Fixed all 3: SSE terminal list, dropped refusal message, over-negative outcome wording | event #14 |

No respawns were required. No agent exceeded its budget. No drift signals observed (no out-of-surface
writes — every reported cross-surface issue was reported rather than edited).

## Cleanup

All three agents released. No orphan agents. Scratch files: none created outside the run workspace.
Artifacts registered with mem. Working tree contains only intended changes (2 commits: `b40407d`, `644c745`).
