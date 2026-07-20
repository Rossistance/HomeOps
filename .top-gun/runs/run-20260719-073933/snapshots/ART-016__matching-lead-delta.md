# Matching Lead — Phase Delta

- Run: run-20260719-073933
- Agent: matching-lead
- Date: 2026-07-19 (UTC)
- Output: matching/capability-task-matching.md — validate_matching.py OK, 0 warnings

## Conclusions

- 13 bounded tasks (T-01..T-13) decomposed from WP-001..005 + the four blocked persona journeys (JRN-2..5, as T-10/T-11) + the ISS-008 CI guard (T-12) + a reserve-funded final verification task (T-13). Every row carries primary+fallback routes with a recorded rejected alternative.
- Highest-leverage matches: (1) wave-0 solo T-01 — the P0 fix is also the unlock that makes npm test a safe verification tool for every later task; (2) Playwright MCP as the single emulator route (schema-load verified in this session, audit-proven) with Claude_Browser demoted to revalidate-first fallback; (3) frontier spend concentrated in T-13 (opus, xhigh) per the budget-policy tables instead of scattered across implementation rows; (4) T-02+T-03 and T-04+T-05 fused into single serialized agents to kill file-collision risk.
- Capability truth this session: sonnet/opus/haiku/fable model aliases observed in the Agent tool enum; effort is brief-carried, not a host knob (recorded honestly); all claude.ai connector MCPs pending OAuth = blocked and unneeded; no local Node satisfies the engines range (T-07 boot-smoke constraint); CI execution and production remain out of reach by authority.
- Budget: mission total planned 500k soft (T-01..T-12 = 431k + 69k reserve = 16%); recommended-bundle scenario 420k with coverage, 290k without; per-option math in the ledger. All soft — no host enforcement exists.

## Context gate compliance

- product-management:write-spec: invoked and loaded; applied as structure (problem/users/scope via WP linkage, Given/When/Then acceptance in Verification cells).
- design:design-handoff: invoked and loaded; produced a real correction — DESIGN_SYSTEM.md says coral=attention/danger, amber=warning, so the degraded banner (warning state) uses amber and T-06 provider_error rendering uses coral; WP-002's draft "amber = attention" wording corrected in the guide preamble.

## Unverified items / open risks for the implementation lead

- Per-session drift: deferred-tool sets, model enums, and agent-type lists vary by session — the implementation lead MUST re-inventory at dispatch (guide's reassessment triggers list the drift-prone facts).
- T-03 is the most escalation-likely row (session-flow ambiguity); respawn-to-opus path pre-recorded.
- HYP-001 remains open and can re-scope T-03 (trigger recorded).
- T-12's end-to-end CI proof is impossible pre-push; local simulation is the honest ceiling.
- HYP-006 (Render parity) unresolved; needs one user-authorized read-only GET.

## Budget consumed (this phase)

- ~35k output tokens of 120k soft (estimate at completion; includes guide authoring, probes, journal writes). No interventions, no nested delegation used.

## Blockers

- None. All required inputs were present; validator passed first run.
