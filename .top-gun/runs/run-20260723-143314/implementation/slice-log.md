# Slice Log — run-20260723-143314

Selected scope: Recommended bundle = WP-101 (ISS-102, ISS-103, ISS-110) + WP-102 (ISS-101, ISS-111).
Baseline at start: HEAD 711f56c, npm test 549/548 pass/1 skip, typecheck clean (EV-115, EV-116).

## Slice B — WP-101 s4: activation preflight endpoint (ISS-103 server half)

- Scope: WP-101 slice 4 · ISS-103 · FEAT-214
- Expected: a read-only compile step that resolves acting agent, tool handlers, integration
  connectivity, recipient context, and multi-agent roles against the REAL registries, returning
  `ready` or `blocked_configuration` with node-level errors — creating nothing.
- Files: NEW `server/automation-preflight.mjs`; `server/index.mjs` (+19 lines: 1 import, 1 route at
  :2890); NEW `server/test/automation-preflight.test.mjs` (14 hermetic tests).
- Evidence:
  - `npm test` → `tests 563 / pass 562 / fail 0 / skipped 1` (baseline 549/548/1 + exactly 14 new; zero regressions)
  - `npm run typecheck` → clean
  - Orchestrator firsthand checks: both new files present; `index.mjs` diff is 19 insertions only;
    route mounted at `index.mjs:2890`; grep for `writeStoreDoc|createAgent|partialUpdate|unshift|save(`
    in the preflight module → **no matches** (read-only guarantee verified independently of the
    agent's claim).
- Contract note: `missing_agent` (explicit agentId unresolvable/archived) vs `no_acting_agent`
  (no agentId and no usable household default) disambiguated by the implementer; relayed to the
  client-side sibling so both halves agree.
- Regressions checked: full server suite; no sibling surface touched (`orchestrator.mjs`,
  `engine.mjs`, `src/**` untouched by this agent).
- Responsive/platform: n/a (server-only slice).
- Integrations: reuses `planner.mjs` `toolCatalog(session)` for real per-actor connectedness rather
  than duplicating registry data — integration state stays authoritative.
- Verdict: **ship** (pending integrated verification with slices A and C).

## Slice A — WP-101 s1-3: acting-agent preflight + honest status (ISS-102, ISS-110)

- Files: `server/orchestrator.mjs` (resolveActingAgent + runSkill preflight), `server/engine.mjs`
  (classifyRunOutcome, partially_failed, softFailed stamp), 2 new test files (22 tests), 1 pre-existing
  assertion changed with dated justification.
- Evidence: `npm test` 585/584/1skip; typecheck clean. Orchestrator firsthand: new test files present;
  `git diff` of the changed assertion carries a dated header explaining the old `completed`-over-failed-child
  assertion WAS ISS-110; `NO_ACTING_AGENT_ERROR` returned at orchestrator.mjs:216 before any startRun call.
- Rollback flags: `HOMEOPS_REQUIRE_ACTING_AGENT=off`, `HOMEOPS_PARTIAL_FAILURE_STATUS=off` (both default ON).
- Verdict: **ship**

## Slice INT — orchestrator integration (cross-agent reconciliation)

- **Conflict found and resolved:** agents A and B independently implemented acting-agent resolution with
  DIFFERENT semantics. B's preflight used `agents.mjs selectAgent()`, whose fallback is
  `all.find(a => a.status === "Active") ?? all[0]` — i.e. ANY active agent. It would have validated
  against agent X while the run executed as agent Y: the ISS-103 "first active agent" antipattern
  reintroduced inside the validator built to prevent it.
- **Resolution:** preflight now delegates the non-explicit case to the run path's own resolver
  (one resolver, one answer). Deliberate asymmetry retained and documented in place: explicit-but-missing
  agent blocks at compile (preflight) while the run path still self-heals at runtime.
  First attempt regressed 1 test — the failure proved the fallback was real; corrected, 14/14 green.
- **Three sibling-surface gaps A reported (not edited) — all fixed here:** SSE `TERMINAL_RUN` lacked
  `partially_failed` (stream would never close); `/api/runs/start` dropped typed refusal `message`;
  `runOutcomeText` described a partial success with the hard-failure sentence.
- Evidence: 585/584/1skip; typecheck clean. Commit `b40407d`.
- Verdict: **ship**

## Slice C — WP-101 s5 + WP-102 s1: client honesty + idempotency (ISS-103, ISS-111)

- Files: `src/store/useStore.ts`, `src/connectors/api.ts`, `src/screens/Automations.tsx`, `src/types/index.ts`.
- Chose multi-agent option (b): render the roster only when every role resolves; honest note otherwise.
- **Second latent bug found by the agent:** `routeToAgent()` has a score floor of -1 and therefore always
  returns some agent — removing the blind fallback alone would have left a zero-relevance pick silently
  taking its place. Gated behind a confident-match check.
- **Third bug found during live verification:** `req()` never throws on non-2xx, so a 401 body was consumed
  as a valid validation response → UI hung on "Checking…" forever. Now shape-checked, fails safe to blocked.
- Evidence: 585/584/1skip; typecheck clean; orchestrator firsthand greps confirm the blind fallback is gone,
  `confidentRouteMatch` exists at useStore.ts:748, and `partially_failed` is handled in 5 places.
  Agent performed live in-browser verification (multi-agent note, dedup modal, Blocked badge + Fix now link).
- Verdict: **ship**. Commit `644c745`.

## Five-point iteration check (bundle, post-integration)

1. **Works as expected?** Yes — the three code-confirmed root causes (ISS-102, ISS-103, ISS-110) are closed
   with tests pinning each; ISS-111 idempotency verified live.
2. **Broke anything that worked?** No — 585/584/1skip (baseline 549/548/1 + 36 new tests), typecheck clean.
   One pre-existing assertion changed deliberately because it encoded the dishonesty being removed.
3. **Responsive/platform?** Client copy authored to wrap at 428px per brief. **Not independently
   re-verified at 428px by the orchestrator** — carried as a residual check, not claimed as done.
4. **Integrations still connected?** Yes — preflight resolves connectedness through `planner.mjs`
   `toolCatalog(session)` rather than duplicating registry state; contact-method consent gates untouched.
5. **Verdict: ship** for the local scope. Production data operations (WP-102 s2-5) remain **gated at S8**
   per DEC-110 — not started, not claimed.
