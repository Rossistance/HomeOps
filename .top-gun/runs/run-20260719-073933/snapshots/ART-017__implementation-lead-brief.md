# Dispatch Brief — Implementation Lead (Full Slate)

- Run: run-20260719-073933
- State: IMPLEMENTATION_RUNNING (at dispatch)
- Date: 2026-07-19 (UTC)
- Selection: **menu option 6 — Full slate WP-001→WP-005** (DEC-007). No further selection pause.

## Objective

Implement the full slate as sequenced, truthful vertical slices — WP-001 → WP-002 → WP-003 → WP-004 → WP-005 — each verified against its own acceptance criteria in `audit/implementation-queue.md`, under the lean-implementation policy and the matching guide's task routing. Done means: every WP's acceptance criteria pass with artifact-backed evidence, `validate_audit.py --stage implementation` passes, the five-point verdict on the final slice is `ship`, and the budget ledger is complete.

## Scope and non-goals

- In scope: exactly WP-001..WP-005 as specified in `audit/implementation-queue.md`, routed per matching guide tasks T-01..T-09 plus T-12 (CI guard, part of WP-001/ISS-008). T-10/T-11 (fresh-`HOMEOPS_DATA_DIR` journeys) are authorized as **verification enablers** where a WP's acceptance criteria need them (WP-002 especially, and the HYP-001 revalidation the guide mandates at T-03).
- Out of scope: `apps/mobile` and `mobile-version` (a separate mission owns TestFlight feedback), new connectors, visual redesign, dependency upgrades beyond the slate's needs.
- **Non-negotiable sequencing:** T-01 (WP-001 test isolation) runs first and SOLO — nothing else executes beside it. Until T-01 is implemented and verified, do NOT run `npm test` against the live `server/.data` (it wedges the running backend — ISS-001). If you need a pre-T-01 baseline, prove isolation first (temp `HOMEOPS_DATA_DIR` + verify the store actually honors it) or skip the baseline and record why.

## Authority boundary (guardrails — binding)

- The user's selection authorizes **local repository edits within the slate scope only**.
- NO git commits, pushes, branches, or PRs. NO deploys or publishes. NO live Google Calendar pushes or any external mutation — verify sync behavior at contract/mocked level only. NO SMS, NO OAuth configuration, no connector executions with external side effects. Weather (Open-Meteo) real read calls are permitted (WP-004 verification needs them).
- Never read or quote: `.env`, `server/.data` vault contents, `D:\HomeOps\SubscriptionKey_3A6LNPV3XG.p8`, `D:\HomeOps\twilio_2FA_recovery_code.txt`. (`.env.example` is fine and in WP-005 scope.)
- **Preserve pre-existing user work — the worktree has drifted since the audit.** Modified: `.claude/launch.json` (never touch), `.gitignore`, `package.json`, `package-lock.json`, `apps/mobile/eas.json`. Untracked: `tests/topgun/`, `testflight-feedback-handoff/`, `.top-gun/`. WP-005 edits `package.json` (engines/Node pin) and possibly `.gitignore` — edit the CURRENT file contents additively; the new `topgun:*` scripts and devDeps (@playwright/test, @appetize/playwright, webdriverio) must survive intact. Never run `git checkout --`, `git reset`, or any command that could revert user changes. Additions to `tests/topgun/` are allowed only as clearly-named NEW spec files; never rewrite the user's harness files.

## Required skills (read the files; follow as operating policy)

1. `D:\The Only Skill\top-gun-claude\skills\convergent-360\SKILL.md` — states S6–S7 govern this phase (also its `references/register-contracts.md` for slice-log/verification-matrix formats). The full mandate is `references/mandate.md`; you may rely on the S6–S7 and verification sections without re-reading the whole file.
2. `D:\The Only Skill\top-gun-claude\skills\lean-implementation\SKILL.md` + `references/budget-policy.md` — your delegation, budget, monitoring, and respawn policy.
3. `D:\The Only Skill\top-gun-claude\skills\mem\SKILL.md` + `references/memory-contract.md` — memory protocol.
4. `D:\The Only Skill\top-gun-claude\agents\implementation-lead.md` — your role card.

## Required inputs

- `audit/implementation-queue.md` (WP specs + acceptance criteria — your contract), `audit/issue-register.md`, `audit/master-report.md` §19–21, `matching/capability-task-matching.md` (task routes, budgets, concurrency groups, escalation row T-03, reassessment triggers — **revalidate its drift-prone facts first**, it predates the repo move and harness additions), `facts-and-notes.md`, `audit/decision-log.md` (esp. DEC-007), `audit/hypothesis-queue.md` (HYP-001 must be resolved by the T-03/WP-002 work).
- Repo root: **`D:\FamiliOS\FamiliOS`** (moved from D:\HomeOps\homeops-ai — every mission command takes `--project "D:\FamiliOS\FamiliOS"`). Branch main, HEAD ffcfa33 + the user drift listed above.
- Running services (all from the new root, healthy at dispatch): backend :8787, Vite :5173, browser-runtime :9223. Restart commands (background, from repo root, node binary `C:\Users\rhixon\AppData\Roaming\nvm\v25.8.2\node.exe`): backend `node server\index.mjs`; web `node node_modules\vite\bin\vite.js`; browser-runtime `node server\browser-runtime\index.mjs`. Backend restarts touch live `server/.data` state — journal every restart.
- Verification tooling now in-repo: `tests/topgun/playwright.config.ts` with npm scripts `topgun:web`, `topgun:web:ios`, `topgun:web:all`, `topgun:pwa`, `topgun:report` — use them where they serve a WP's acceptance criteria; Playwright MCP tools remain available for interactive verification at 375x812.

## Required outputs

All under `.top-gun/runs/run-20260719-073933/`:

- `implementation/slice-log.md` — one block per slice with the five-point verdict (format in register-contracts).
- `implementation/verification-matrix.md` — checks in proportion to risk; pass/fail/partial/blocked/not-applicable honestly distinct.
- `implementation/budget-ledger.md` — schema from budget-policy; planned (from the matching guide) vs actual per task, variance causes, reserve tracking.
- `agent-deltas/implementation-lead-delta.md` — phase delta.
- Journal events per slice completion, checkpoint, intervention, blocker; artifacts registered (snapshot the three implementation docs at completion; reference-mode for changed source files).
- Validation before return (verbatim output in your report):
  - `python "D:\The Only Skill\top-gun-claude\skills\convergent-360\scripts\validate_audit.py" --project "D:\FamiliOS\FamiliOS" --stage implementation`
  - `python "D:\The Only Skill\top-gun-claude\skills\mem\scripts\validate_memory.py" --project "D:\FamiliOS\FamiliOS"`
  - `npm run typecheck` and (post-T-01 only) `npm test` — full results.

## Write surface and collision risks

- May write: product source within each WP's named files/areas, focused tests (server/test additions per WP-001; new clearly-named specs under tests/topgun/), `implementation/`, `agent-deltas/`, `snapshots/` (via scripts), journal. May update `audit/` PRD/coverage ONLY via your delta — canonical registers stay with the orchestrator.
- Must not write: `phase-state.md`, `handoffs/`, `.claude/launch.json`, `apps/mobile/**`, `mobile-version/**`, git state.
- Concurrency: per the matching guide — T-01 solo wave; T-02+T-03 fused (shared `useStore`/Lock/Onboarding surfaces), T-04+T-05 fused (shared `ai.ts`); one writer per surface always.

## Model, effort, and budget

- Budget: **500k output tokens soft** total (matching guide: ~431k tasks + 69k reserve — reserve is for final verification only). Per-task budgets and checkpoints from the guide's ledger; checkpoint events at each task boundary with consumption vs plan; >150% at a checkpoint → intervene per budget-policy ladder.
- Delegate per lean-implementation criteria; sonnet-class/medium for routine S/M tasks, escalate T-03 per the guide's documented respawn-to-opus path if its signals fire; concentrate any frontier/xhigh spend in the final verification pass. If the Agent tool is unavailable in your environment, run separated passes solo and record it.

## Checkpoints, drift, and stop conditions

- Drift: edits outside the WP's named surface; reverting or clobbering user drift; running `npm test` pre-T-01 against live data; verification claimed without artifacts; skipping a five-point check; silent budget overrun.
- Stop immediately when: an action would mutate anything external; a change would require touching `apps/mobile`; the backend's live `.data` is at corruption risk outside T-01's controlled work; both restart attempts of a dead service fail (return blocker).

## Return format

Plain-language outcome per WP (delivered/partial/blocked with exact unblock); files and subsystems changed; slice verdicts; verification-matrix summary with honest statuses; typecheck/test results verbatim; validator outputs verbatim; HYP-001 resolution; budget plan vs actual with variance causes; risks and next discriminating checks; deployment status stated precisely (expected: local worktree only, nothing committed or deployed). Your final message is a report to the orchestrator, not the user.
