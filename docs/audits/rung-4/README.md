# Rung 4 audits — 2026-09-23

Read-only audits produced by six sub-agents, one lens each, as the evidence for
[ADR-004](../../adr/ADR-004-native-tools-and-plan-meal.md). Every finding carries a
`file:line` citation into the tree at commit `3db18fb` (main, after PR #12); line numbers
drift after that.

| File | Lens |
|---|---|
| [01-native-dispatch.md](01-native-dispatch.md) | the 16 `famili.*` tools and exactly which ladder steps their execute path skips; when `agent` is non-null |
| [02-policy-ladder-contract.md](02-policy-ladder-contract.md) | `executeToolForChat`, every rule of `resolveEffectivePolicy`, the ctx `execResolved` passes, `delivers`/`reachesOutside` |
| [03-approvals-and-ios-surfaces.md](03-approvals-and-ios-surfaces.md) | what a family would see on iOS if a native write were approval-gated; two pre-existing iOS defects |
| [04-tests-and-ci.md](04-tests-and-ci.md) | which assertions pin today's behaviour and what each migration shape would break; Playwright is not in CI |
| [05-plan-meal-behaviour.md](05-plan-meal-behaviour.md) | every behaviour of `homeops.plan_meal`, its consumers, the three wrong claims in the record |
| [06-define-action-fit.md](06-define-action-fit.md) | whether `defineAction` can hold `plan_meal` (probed), and which structural option is legal |

Verification: two adversarial refuters (code-trace and test-evidence) were launched per
finding; eleven ran before the session's spend limit stopped the rest, and none refuted
its finding. The design, judging and synthesis stages of the same workflow did not run;
ADR-004 is the orchestrator's own synthesis of these six reports.
