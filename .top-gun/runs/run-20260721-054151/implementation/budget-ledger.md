# Budget Ledger — run-20260721-054151 implementation

Budgets are SOFT (host enforces no output-token cap; lead enforces at checkpoints per budget-policy 60%/150% thresholds). Planned figures from ART-018 task matrix. Actuals estimated from sub-agent transcript volume at return (host exposes no exact meter — estimation method noted per row).

| Task/Agent | Class | Model | Effort | Planned | Actual | Variance | Cause | Intervention |
|---|---|---|---|---|---|---|---|---|
| WP-001 inbox read-models | M | sonnet | medium | 60k | ~40k | -20k | server contract pre-proven; spec reuse | none |
| WP-002 honest delivery (incl. s2) | M | sonnet | medium/high | 60k | ~115k | +55k | clamp-preserving attribution + truth-table breadth (justified, accepted by orchestrator) | none |
| WP-003 one run world | L | opus | high | 120k | — | — | — | — |
| WP-004 results have homes | M | sonnet | medium | 50k | — | — | — | — |
| WP-005 s1+s2+s5 IA+catalog | L | opus | high | 115k | — | — | — | — |
| WP-005 s3 agent detail | M | sonnet | high | 60k | — | — | — | — |
| WP-005 s4 migration dry-run | L | opus | high | 120k | — | — | — | — |
| WP-006 s1+s2 orchestrate() | L | opus | high | 150k | — | — | — | — |
| WP-006 s3 sandbox layer | L | opus | high | 100k | — | — | — | — |
| WP-006 s4–s6 UC specs ×3 | M×3 | sonnet | medium | 180k | — | — | — | — |
| — lead-2 harness + pilots UC-1/UC-20 (inline) | S | fable (lead) | high | (from s4–s6 pool) | ~25k | — | harness decisions are cross-cutting; pilots de-risk the fan-out | none |
| — author R1: UC-15/16/17/19 (active, env-heavy) | M | sonnet | medium | 60k | ~90k | +30k | net.mjs seam investigation (honest limitation mapping, 3 file:line anchors) | none — finding accepted |
| — author R2: UC-11/18/21/22 (active, internal) | M | sonnet | medium | 50k | ~176k | +126k | verbose exploration + 4 surface-heavy UCs; output verified genuine (4/4 green, evidence inspected) | none at return; would down-brief next time (tighter reading list) |
| — author G1: UC-2..7 (gated sandbox) | M | sonnet | medium | 50k | ~139k | +89k | 6 specs, catalogs read in full, double verification run | none at return; same down-brief note |
| — author G2: UC-8/9/10/12/13/14 (gated, wave B) | M | sonnet | medium | 45k | ~120k | +75k | 6 specs incl. honest-park design for unsandboxed providers; confirmed twice, zero flakes | none — wave-B brief already tightened; residual overrun structural to spec-author class |
| WP-006 s7 soak | S | sonnet | low | 20k | ~5k (lead inline) | -15k | soak = 3 mechanical suite runs + latency table; no judgment needed → no agent spawned (lean rule: spawn only when a criterion holds) | route changed: agent → inline |
| residuals: sweep-gap fix + re-sweep + Render hash (lead-2 inline) | S | fable (lead) | high | 30k | ~20k | -10k | diagnosis landed on first data pass | none |
| lead-2 orchestration/integration (harness, pilots, WP-002 gap fix, chat-delivery E2E, matrix/docs) | — | fable | high | (lead reserve) | ~85k | — | includes 2 pilot iterations + rate-limit soak triage | — |
| WP-007 s1 LM Studio token | S | sonnet | medium | 20k | ~50k | +30k | screenshot attempt surfaced backend SQLITE_IOERR incident; diagnosis time (accepted) | none |
| WP-007 s2–s5 Supermemory | L | sonnet | high | 140k | — | — | — | — |
| WP-008a diff/revert | M | sonnet | medium | 50k | — | — | — | — |
| WP-008b safe wipe (dry-run) | M | opus | high | 40k | ~30k | -10k | dry-run 25k + lead-executed revert/archive 5k; report overturned auto-applied assumption | early read-only dispatch (schedule optimization) |
| WP-009 sync hygiene | M | sonnet | medium | 40k | — | — | — | — |
| WP-010 web roles/profiles | M | opus | high | 50k | — | — | — | — |
| WP-011 trust & lifecycle | S–M | sonnet | medium | 30k | — | — | — | — |
| WP-012 connector provisioning | M | sonnet | medium | 40k | — | — | — | — |

- Mission planned total: 1,445k feature + 260k reserve = 1,705k (soft)
- Mission actual total after wave 1: ~235k of 1,705k (feature rows consumed ~230k vs 180k planned for the four returned rows; variance causes logged per row)
- Reserve consumed by verification: —
- Lead-2 finale (this window): plan ~340k soft (brief) → actual ~635k: authors ~525k vs 205k planned (spec-author verbosity — every overrun inspected and the work verified genuine; systematic cause: sonnet spec authors re-read large catalogs and narrate; correction recorded for future matching guides), lead inline ~110k vs 75k. Overrun accepted by lead as the price of 23 genuinely-verified benchmark specs; no reserve spent on feature work.
