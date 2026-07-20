# Budget Ledger — run-20260719-073933 (implementation)

Schema per lean-implementation references/budget-policy.md. All budgets SOFT (host enforces no output-token cap on Agent calls this session; claiming hard enforcement would be a fabricated control). Planned figures from matching/capability-task-matching.md. Actuals are estimated output-token consumption (host exposes no per-agent meter; estimates derived from diff+transcript volume, labeled honestly as estimates).

| Task/Agent | Class | Model | Effort | Planned | Actual | Variance | Cause | Intervention |
|---|---|---|---|---|---|---|---|---|
| T-01 (inline lead) | M | inherit (fable) | medium | 45k | ~14k est | -69% | Root cause pre-localized by audit; small precise diffs; guard surfaced+fixed a 2nd offender cheaply | none |
| T-02+T-03 (G2 sonnet agent) | M+M | sonnet | medium/high | 110k | ~85k est | -23% | Code+typecheck only (emulator moved to lead); surfaces well-specified by WP | Routing adjustment (event #43): browser tools barred in brief — emulator is a serialized resource; lead verified serially |
| T-04+T-05 (G3 sonnet agent) | M+S | sonnet | medium | 65k | ~55k est | -15% | Same routing adjustment; ai.ts additive design took most of the budget | same |
| T-06 (inline lead) | S | inherit (fable) | medium | 20k | ~8k est | -60% | Sibling pattern pre-identified by audit; 4-case test file small | none |
| T-07 (inline lead) | S | inherit (fable) | medium | 20k | ~5k est | -75% | Engines already correct — only render.yaml/README needed edits | none |
| T-08 (inline lead) | S | inherit (fable) | high | 25k | ~6k est | -76% | Subtractive payload trim; Lock contract already landed via G2 | none |
| T-09 (inline lead) | XS | inherit (fable) | low | 6k | ~3k est | -50% | Mechanical npm uninstall + build verify | none |
| T-12 (inline lead) | S | inherit (fable) | medium | 25k | ~7k est | -72% | Job mirrors T-01's proven verification recipe; simulation scripted once | none |
| T-10/T-11 (coverage journeys) | M+M | — | — | 115k | 0 (not run as specified) | -100% | Brief authorized T-10/T-11 only as verification enablers where WP acceptance needed them; WP-002/003 acceptance was verifiable on the claimed resident server + local-session paths, so no fresh-HOMEOPS_DATA_DIR env flip was needed. HYP-001 remains open (see report) — the full unclaimed-server persona journeys stay deferred | recorded decision, journaled |
| Runtime verification pass incl. 4 integration fixes (lead, reserve-funded in part) | L | inherit (fable) | high | 60k (T-13 reserve) | ~75k est | +25% | Verification surfaced 3 real integration failures (reseed race, member_archived, chat error-code) + 1 latent crash (loadBackend) — each fixed and re-verified live; also ran the user's topgun:web harness and attributed its failures | none (overrun within mission total; reserve spent on verification only) |
| **Mission totals** | | | | 500k planned (431k tasks + 69k reserve) | ~258k est actual | -48% | Audit pre-localization made implementation cheap; verification consumed proportionally more, as intended | |

- Mission planned total: 500k soft. Reserve: 69k (verification only).
- Mission actual total: ~258k est. Reserve consumed by verification: ~75k est (verification + integration fixes; never feature work).
- Note: T-13's independent-opus final verification was replaced by the lead's own consolidated pass at the orchestrator's direction to continue and return; the pr-review-toolkit silent-failure sub-pass was effectively performed by the lead finding 4 silent-failure-class bugs during live verification. An independent adversarial re-verification remains a recommended next check (see report).
