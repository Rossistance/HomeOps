# Budget Ledger — run-20260719-232201 (implementation)

All budgets SOFT (host enforces no hard token limit — no fabricated controls). All tasks executed INLINE by the lead (matching guide primary routes); no sub-agents spawned — every spawn criterion failed (single writer per surface, serialized runtime, context already loaded). Actuals are honest lead estimates of task-attributable output tokens.

| Task/Agent | Class | Model | Effort | Planned | Actual | Variance | Cause | Intervention |
|---|---|---|---|---|---|---|---|---|
| T-101 respond-handler reassign | M | inline (lead) | high | 40k | ~12k | −70% | audit code-traces removed exploration; red/green landed first try | none |
| T-102 create-dedupe | S | inline | medium | 15k | ~4k | −73% | same-file context already loaded | none |
| T-103 accepted-card lifecycle | M | inline | medium | 35k | ~14k | −60% | element-map located everything | none |
| T-105 VERIFY WP-001 | S | inline | medium | 12k | ~8k | −33% | scripted repro reused audit pattern | none |
| T-201 upload banner | S | inline | medium | 20k | ~6k | −70% | single call-site contract change | none |
| T-202 honest categorization | S | inline | medium | 18k | ~8k | −56% | pure-lib extraction made tests cheap | none |
| T-301 notes field | S | inline | medium | 12k | ~3k | −75% | server support pre-existing | none |
| T-302 end-date support | M | inline | high | 45k | ~10k | −78% | shared coversDay/spanKeys helpers | none |
| T-303 server allDay | S | inline | high | 20k | ~8k | −60% | single choke-point builder | none |
| T-304 all-day toggle | M | inline | medium | 30k | ~5k | −83% | folded into T-302's form pass (same file, one design) | none |
| T-305 VERIFY WP-003 | S | inline | medium | 12k | ~4k | −67% | probe script pattern reuse | none |
| T-401 description composer | M | inline | high | 30k | ~7k | −77% | DEC-04 design already decided | none |
| T-402 one-save action row | S | inline | medium | 18k | ~6k | −67% | approval path reused unchanged | none |
| T-501 TG-residue hygiene | XS | inline | low | 6k | ~4k | −33% | store was SQLite doc engine, not JSON (guide drift) — small detour | none |
| T-601 FINAL VERIFY | M | inline | xhigh | 30k | ~10k | −67% | suites scripted; stack-restoration detour (Vite casualty) included | none |
| Lead overhead (inputs, revalidation, restarts, docs, journal) | — | — | — | (uncounted) | ~30k | — | brief/skills/registers reading + 4 backend restarts + chunked doc writes | — |

- Mission planned total: 343k (soft ceiling 360k)   Reserve: 54k (T-105+T-305+T-601, verification only)
- Mission actual total: ~139k (≈109k task-attributed + ~30k lead overhead)    Reserve consumed by verification: ~22k (T-105 8k + T-305 4k + T-601 10k) — never spent on feature work
- Variance cause (global): inline single-lead execution eliminated all sub-agent dispatch/report overhead, and the audit's precise EV-CODE/EV-NET anchors eliminated exploration. Budgets were sized for delegated execution.
- Session note: one session-usage-limit interruption after baseline revalidation (restart overhead in lead overhead); two Vite/backend restarts journaled (#29, #32, #37 area) with data-integrity verification each time.
- No orphan agents; no unregistered artifacts (see artifact ledger).
