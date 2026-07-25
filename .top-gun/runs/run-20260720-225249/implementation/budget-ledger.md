# Budget Ledger — Implementation Phase (run-20260720-225249)

Soft output-token budgets (host does not enforce). Actuals estimated at each return.

| Task/Agent | Class | Model | Effort | Planned | Actual | Variance | Cause | Intervention |
|---|---|---|---|---|---|---|---|---|
| WP-013 harness+smoke (inline) | L | opus | high | 45k | — | — | reuse existing server/test/harness.mjs (temp data dir) | none |
| WP-011 active criteria docs (9, inline) | M | opus | high | 30k(shared) | — | — | coupled to skills built inline | none |
| WP-002 UC-17 Recipe (inline) | S | opus | high | 18k | — | — | contract-verify (web egress) | none |
| WP-003 UC-18 Memory (inline) | S | opus | high | 18k | — | — | live internal skill | none |
| WP-004 UC-19 Event (inline) | M | opus | high | 25k | — | — | eventId threading, live | none |
| WP-001 UC-01 School (inline) | M | opus | high | 30k | — | — | contract-verify (gmail) | none |
| WP-005 UC-20 Chore+Doc (inline) | M | opus | high | 28k | — | — | attach-mismatch correction, live | none |
| WP-007 UC-22 Sync (inline) | M | opus | high | 25k | — | — | compose digest, live core | none |
| WP-008 UC-14 Morning Text (inline) | M | opus | high | 30k | — | — | notify_contact live, weather contract | none |
| WP-006 UC-21 Meal Planner (inline) | M | opus | high | 35k | — | — | live plan_meal+notify+approval | none |
| WP-009 UC-12 Climate (inline) | S | opus | high | 20k | — | — | contract/mock, device-unverified | none |
| WP-010 inactive specs (9 docs + README) | M | sonnet | medium | 40k | 116.8k (in) | see note | subagent tokens are total (in+out); 9 docs+README | none |
| WP-012 ship (inline) | M | opus | high | 30k | (below) | — | S8-gated release; executed at return | none |

- Mission planned total: 374k output tokens. Reserve: 74k (~17%).
- NOTE (economy decision, matches salvaged ledger): the 9 active builds + WP-011 active docs + WP-013 harness were done INLINE on opus, not delegated — the four shared-catalog files (catalogIds/agentTemplates/workflowTemplates + seed.mjs) are a single-writer surface and the skills are small, similar objects; one writer holding the contracts once is more token-efficient than N subagents each re-reading them (lean-implementation "spawn only when the value test passes"). Only WP-010 (13 inactive docs, disjoint surface, context protection) was delegated → one sonnet subagent, real reported usage 116.8k tokens (in+out; the host meters no separate output figure), 19 tool calls, ~5 min.
- Actuals: the host does not expose a precise per-task output-token meter for the inline lead, so inline actuals are recorded as a single honest estimate rather than fabricated per-row numbers. Inline implementation (WP-011 active + WP-013 + WP-001..009 + registers) landed comfortably within the summed ~299k inline plan — no task hit the 150% checkpoint; no steer/rescope/respawn was needed. Reserve (74k) drew only on per-slice `npm test`/tsc re-runs (3 full-suite runs) + catalog integration, as intended; not spent on feature work.
- Interventions: none. No underpowered/overpowered signal; no drift signal (no invented tool_id — catalog-integrity test enforces it; no subagent touched a catalog file; no prod mutation).
