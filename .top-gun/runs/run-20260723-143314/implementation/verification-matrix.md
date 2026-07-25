# Verification Matrix — run-20260723-143314

Selected scope: Recommended bundle = WP-101 (ISS-102/103/110) + WP-102 (ISS-101/111).
Blocked and partial are never reported as pass.

| Check | Level | Command or method | Result | Evidence ID | Notes |
|---|---|---|---|---|---|
| No run persists with a null acting agent | unit | `node --test server/test/acting-agent-preflight.test.mjs` | pass | EV-201 | 11 tests; typed error returned before `startRun`, zero runs persisted |
| Acting-agent resolution priority order | unit | same file | pass | EV-201 | caller → skill.defaultAgentId → household default |
| Rollback flag restores pre-WP-101 shape | unit | same file | pass | EV-201 | `HOMEOPS_REQUIRE_ACTING_AGENT=off` |
| notify_contact delivers from a skill run with no default helper | integration | same file (HTTP) | pass | EV-201 | previously hit the late `no_acting_agent` refusal |
| Chat attribution regression (WP-002 preserved) | integration | same file | pass | EV-201 | attribution, deny-clamp, and WP-002 rollback all intact |
| Run status truth table (required/optional/all-succeed) | unit | `node --test server/test/run-outcome-status.test.mjs` | pass | EV-202 | 11 tests on pure `classifyRunOutcome` + live engine runs |
| Required child failure never yields success | unit | same file | pass | EV-202 | fail-closed: unstamped failure is required by definition |
| Soft-fail behavior unchanged | integration | `server/test/engine-soft-fail.test.mjs` | pass | EV-203 | one assertion deliberately updated (`completed`→`partially_failed`) with dated justification — the old assertion WAS ISS-110 |
| Preflight: valid plan → ready | integration | `node --test server/test/automation-preflight.test.mjs` | pass | EV-204 | 14/14 |
| Preflight: missing agent / unknown tool / disconnected integration / missing recipient / unresolved role | integration | same file | pass | EV-204 | each error kind asserted separately |
| Preflight creates nothing | integration | same file | pass | EV-204 | store state byte-identical before/after |
| Preflight authz negative | integration | same file | pass | EV-204 | no session → refused |
| Preflight is read-only (independent check) | manual | grep for `writeStoreDoc\|createAgent\|partialUpdate\|unshift\|save(` in `automation-preflight.mjs` | pass | EV-205 | orchestrator's own check, not the agent's claim |
| `index.mjs` change is minimal | manual | `git diff --stat server/index.mjs` at slice B | pass | EV-205 | 19 insertions (1 import + 1 route) |
| Preflight and run path resolve the SAME agent (non-explicit case) | unit | `node --test server/test/automation-preflight.test.mjs` after reconciliation | pass | EV-206 | conflict found by orchestrator; preflight now delegates to `orchestrator.resolveActingAgent` |
| Explicit-but-missing agent blocks at compile | unit | same file | pass | EV-206 | deliberate asymmetry: strict at compile, self-healing at run |
| Blind "first active agent" fallback removed | manual | grep `agents.find((a) => a.status === "Active") \|\|` in useStore.ts | pass | EV-207 | no matches |
| `routeToAgent` zero-relevance pick gated | manual | grep `confidentRouteMatch` in useStore.ts | pass | EV-207 | useStore.ts:748 — found by agent C; score floor of -1 would have defeated the fix |
| Non-2xx validation response cannot be consumed as valid | manual | shape check in `api.ts validateAutomation` | pass | EV-207 | 401 previously hung the UI on "Checking…" |
| `partially_failed` consumed by client | manual | grep in useStore.ts (5 sites) | pass | EV-207 | mapRunStatus, runStatusView, polling terminal, outputSummary |
| Multi-agent roster renders only when every role resolves | manual (live browser, agent C) | dev stack + seeded household | pass | EV-208 | both seeded multiAgent templates resolve 0 roles → honest note, not fake specialists |
| Dedup modal on repeat instantiation | manual (live browser, agent C) | dev stack | pass | EV-208 | Cancel / Create separate / Update existing; no duplicate created |
| Blocked badge + working "Fix now" link | manual (live browser, agent C) | dev stack | pass | EV-208 | with no confident agent match |
| Full server suite | integration | `npm test` | pass | EV-209 | 585 tests / 584 pass / 0 fail / 1 honest skip (baseline 549/548/1 + 36 new) |
| Typecheck | build | `npm run typecheck` | pass | EV-210 | exit 0, clean |
| Responsive copy at 428px | visual | — | **not-applicable-this-run** | — | new copy authored to wrap per brief; **orchestrator did not independently re-verify at 428px** — carried as residual, not claimed |
| Playwright spec for blocked state | e2e | — | **blocked** | — | agent C chose live in-browser verification over an untested new spec; honestly disclosed, not counted as pass |
| Production data migration (WP-102 s2-5) | migration | `server/scripts/migrate-agent-packages.mjs` | **blocked** | EV-211 | no Render CLI, no API key, prod correctly 403s passwordless session mint; requires owner credentials this session must not handle. Runbook: `implementation/production-migration-runbook.md` |
| Production deploy of this work | e2e | — | **not-attempted** | — | nothing pushed; requires explicit S8 authorization |
