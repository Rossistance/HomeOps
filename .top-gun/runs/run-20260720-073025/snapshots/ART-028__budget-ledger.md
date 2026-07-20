# Budget Ledger — run-20260720-073025 (implementation phase)

All budgets **SOFT** — the host does not enforce output-token limits. Enforcement is
checkpoint math by the implementation lead (>150% pro-rata at a checkpoint = intervene).
Plan source: `matching/capability-task-matching.md` (all-six selection: 320k feature +
55k reserve = 375k).

| Task | Class | Model | Effort | Plan | Actual (est.) | Variance | Cause |
|---|---|---|---|---|---|---|---|
| T-101 WP-001 build seam (slices 1–4) | M | inherit (Fable) | high | 50k | ~38k | −24% | Root cause was a single well-localized expression in `materializeBuild`; the audit's diagnosis was exact, so no exploratory rework was needed. |
| T-102 WP-001 regression promotion | S | inherit | medium | 20k | ~24k | +20% | Over plan by design: added a bidirectional red/green proof (revert → 7 tests RED → restore → green) and a CONTROL case the guide did not specify. |
| T-103 WP-001 slice 5 lifecycle | S | inherit | medium | 15k | ~8k | −47% | The decision (DEC-I01) was cheap once `agents.mjs` showed status was never enforced at run time — that observation collapsed the design space. |
| T-201 WP-002 anchor scheduling | S | inherit | medium | 25k | ~26k | +4% | On plan. DST correctness required real tz-database arithmetic (`Intl` offset resolution) rather than the naive +24h the guide's fallback allowed. |
| T-301 WP-003 truth taxonomy | M | inherit | high | 50k | ~34k | −32% | The two seams shared one mechanism (a flag set at normalization, honored in the engine), so they landed as one coherent change rather than two. |
| T-302 WP-003 summary rewrite | S | inherit | medium | 20k | ~14k | −30% | Contained to one function plus a shared `summarizeOutcome` helper. |
| T-401 WP-004 park/expiry honesty | M | inherit | high | 40k | ~26k | −35% | The hook pattern already existed (`onRunFinished`); the park hook mirrored it. |
| T-402 WP-004 client waiting surface | S | sonnet | medium | 20k | see below | — | Delegated (isolation + parallelism criteria both hold). |
| T-501 WP-005 registry delivery tool | M | inherit | high | 55k | ~44k | −20% | Included the unplanned kill-switch gap closure and stale-account honesty. |
| T-501r WP-005 adversarial review | — | opus | xhigh | (in T-501) | see below | — | Mandatory per the guide; independent-judgment criterion. |
| T-601 WP-006 surface polish | S | sonnet | medium | 25k | see below | — | Delegated. |
| T-601s WP-006 server half (ISS-011) | XS | inherit | medium | (unbudgeted) | ~6k | new | Not in the guide as a server task: the promoted persona suite proved ISS-011 was a live server-side bug (Guest receives a build card that 403s), so the fix belonged on the server, not in the client pass. |
| T-701 Final verification wave | verification | reserve | xhigh | 45k (reserve) | see below | — | Funded from reserve only, never from feature budget. |

## Interventions

None to date. No sub-agent has shown overpowered or underpowered signals, and no
write-surface violation has been observed (`git status` checked at each checkpoint:
`server/**` has exactly one writer — the lead — and the delegated agents' changes have
stayed within the client surfaces they were granted).

## Reserve discipline

Reserve (55k) is untouched by feature work. It funds T-701 verification only.

## Matching-guide corrections

None required so far: the guide's model/effort assignments have matched observed
difficulty. One routing note for the record — the guide placed all of WP-006 in the
client lane (T-601); part of it (ISS-011 role-aware proposals) is genuinely a server
concern and was executed by the lead accordingly.
