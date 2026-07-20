# Dispatch Brief — Implementation Lead

- Run: run-20260720-073025
- State: SELECTED → IMPLEMENTATION_RUNNING (at dispatch)
- Date: 2026-07-20T17:45:00Z

## Objective

Make Ask Famili tell the truth and actually do the work. Implement the **full selected menu — WP-001, WP-002, WP-003, WP-004, WP-005, WP-006** — so that a chat request like "create an agent that emails wrhixon@gmail.com a daily morning briefing at 7 AM" produces an agent that (a) runs the skill that was actually built, (b) fires at 07:00 local daily, (c) really delivers the email unattended, and (d) reports every outcome — success, waiting, expired, skipped, blocked — truthfully in the chat thread, never celebrating a no-op. Done = all six WPs implemented in vertical slices with the five-point check per slice, the audit's repros flipped red→green as permanent regression tests, and `validate_audit --stage implementation` passing with verdict `ship`.

## Scope and non-goals

- In scope: WP-001..WP-006 exactly as specified in `audit/implementation-queue.md` and routed in `matching/capability-task-matching.md` (11 task rows T-101..T-701). Server (planner/engine/orchestrator/triggers/notify/index) plus the client surfaces WP-004/WP-006 name, in both `apps/mobile/` and `src/` where the same seam exists.
- Out of scope: git commits, pushes, branches, PRs, deploys, EAS/store actions (the orchestrator and user own release); re-auditing settled findings; native iOS visual lanes (CLOSED — prior-run DEC-10, binding); scope beyond the six WPs (journal a finding instead of expanding).
- Authority boundary:
  - **Local repo + local dev stack: full write/execute** within WP scope.
  - **LIVE EMAIL — READ THIS TWICE (DEC-007):** the user granted explicit consent for real sends to **wrhixon@gmail.com and that address ONLY**. Mocked/harness proof comes FIRST and carries the structural verdict; ONE real send to wrhixon@gmail.com is the final acceptance for WP-005. Any code path that could send to a different address during your work must be stopped before it fires — no other family contact method may receive anything. If a send would go anywhere else, HALT and journal a blocker.
  - **Local tenant holds REAL family data.** Prefix every test record `TG-`, clean up, never mutate real records. Prefer isolated harness servers (DEC-A01 pattern, `server/test/assistant-persistence.test.mjs`) for evidence.
  - **Production: `/api/health` + build-identity only.** No behavioral probes, no data access. Prod currently runs c0c4596 (= HEAD, pre-fix) — post-fix production verification happens only after the orchestrator/user deploys (DEC-008).
  - **The household's connected Google account is stale (DEC-08 lineage, 401'd previously).** Check its state EARLY — if it cannot send, that is an honest blocker to report with its exact unblock, never something to fake, stub, or paper over.
- **PROTECT UNCOMMITTED WORK — do not revert:** `tests/topgun/web/helpers.ts` and `tests/topgun/web/smoke.spec.ts` carry this session's harness fix (`seedReturningUserState`) that turned the web e2e lane green (journal #10). They are uncommitted. Preserve them; extend rather than rewrite.

## Required skills

- `top-gun:convergent-360` (S6 vertical slices, S7 verification matrix), `top-gun:lean-implementation` (slice discipline + budget policy), `top-gun:mem` (journal/artifact discipline). Invoke all three at start.

## Required inputs

- `matching/capability-task-matching.md` (ART-019) — **your task plan**: T-101/102/103, T-201, T-301/302, T-401/402, T-501, T-601, T-701, with models, efforts, budgets, concurrency groups, verification surfaces. **Revalidate its dispatch preconditions first** (see Checkpoints).
- `audit/implementation-queue.md` (ART-015) — WP specs + acceptance criteria.
- `audit/master-report.md` (ART-016) §21 menu + PRD; `audit/issue-register.md` (ART-012) ISS-001..011; `audit/evidence-ledger.md` (ART-008) EV-001..028.
- `audit/decision-log.md` (ART-014) — DEC-A01..A05 ratified, plus **DEC-006 (full-menu selection), DEC-007 (live-send consent, recipient-scoped), DEC-008 (prod verification unblocked)**.
- `audit/evidence/repro-false-success.mjs` + `persona-passes.mjs` — **promote these into permanent regression tests** (guide T-101): they currently PROVE the bug; after your fix they must prove its absence, and stay in the suite.
- `facts-and-notes.md` (ART-002) for environment/authority context.

## IDs in play

- Work packages: WP-001..WP-006 (all selected) | Issues: ISS-001..ISS-011 | Evidence: EV-001..EV-028 | Decisions: DEC-A01..A05, DEC-006, DEC-007, DEC-008 | Hypotheses to close where cheap: HYP-005 (real-model build JSON), HYP-006 (approve→gmail.send happy path), HYP-007 (TTL-expiry silence), HYP-008 (web client parity — now cheap, the lane is green).

## Required outputs

- Working code for WP-001..006 in the repo (uncommitted — the orchestrator handles release).
- `implementation/slice-log.md` — one entry per slice with the five-point verdict (`ship` / `another-round`).
- `implementation/verification-matrix.md` — every check with level, command/method, result, evidence ID. **Blocked/partial/pre-existing-fail rows are never reported as pass.**
- `implementation/budget-ledger.md` — plan vs actual with variance causes.
- Agent delta: `agent-deltas/implementation-lead-delta.md`.
- Validation before return, verbatim in your report:
  - `python "<convergent-360 base>/scripts/validate_audit.py" --project "D:\FamiliOS\FamiliOS" --stage implementation`
  - `python "<mem base>/scripts/validate_memory.py" --project "D:\FamiliOS\FamiliOS" --strict`
  - Full server suite (`npm test`, node 25.8.2), both typechecks (`npx tsc --noEmit` in `apps/mobile` and root), and the Playwright web smoke lane.

## Write surface and collision risks

- May write: product source within WP scope (`server/**`, `apps/mobile/src/**`, `src/**`), new/updated tests under `server/test/**` and `tests/topgun/**` (extend, don't revert), `implementation/**`, `agent-deltas/implementation-lead-delta.md`, journal/ledger via mem scripts.
- Must not write: `audit/**`, `matching/**`, `handoffs/**`, `facts-and-notes.md`, `phase-state.md`, any other run's tree (esp. `run-20260720-072344` — a foreign session's run).
- Known concurrent writers: a foreign session may append journal/ledger rows via the shared current-run pointer — ignore foreign rows, never delete them; journal a `disagreement` if foreign writes touch THIS run's implementation files.

## Model, effort, and budget

- Model: inherit the session model for the P0 server seams (WP-001/003/005) — highest correctness stakes and cross-layer ambiguity. Delegate the client-surface passes (T-402, T-601) to a `sonnet`/medium subagent per the guide.
- Reasoning effort: high for WP-001/003/004/005; medium for WP-002/006. **WP-005 (T-501) requires the mandatory xhigh adversarial review** the guide specifies — it is the highest-risk change (new external-send authority).
- Token budget: **375k output tokens (soft — host does not enforce)** = 320k feature + 55k reserve, per the guide's all-six plan. Report consumed vs plan at each checkpoint; >150% pro-rata at a checkpoint is a drift signal.

## Checkpoints, drift, and stop conditions

- **Dispatch revalidation (before the first edit):** stack boots clean (`scripts/dev.mjs`, node 25.8.2 at `C:\Users\rhixon\AppData\Roaming\nvm\v25.8.2`); `npm test` green (308/308 is HISTORICAL — re-prove it); both typechecks 0; web smoke still 5-pass/1-skip with the uncommitted harness edits intact; working tree matches c0c4596 + those harness edits; Google account state checked (WP-005 feasibility). Journal the result.
- Checkpoint cadence: after dispatch revalidation, after each WP completes, before the T-701 verification wave, and before return.
- **Mandatory browser pass (DEC-A03 reversal condition):** WP-004/WP-006 touch client rendering, so a real web journey on the now-green Playwright lane is REQUIRED before ship — code-tracing the client is not sufficient this time.
- Drift signals: scope beyond the six WPs; writes to canonical registers; a send targeting any address other than wrhixon@gmail.com; commits/pushes/deploys; budget >150% pro-rata; claims of runtime evidence without captured output; reopening the closed native lane.
- Stop immediately when: any external side effect fires that the user did not authorize (journal a blocker with the full trace — DEC-08 protocol); the stale Google account makes WP-005 live acceptance impossible (finish the mocked lane, then report the blocker + exact unblock); a slice needs a third `another-round` (escalate to the orchestrator rather than grinding).

## Return format

- Plain-language outcome first: does the user's exact scenario now work end to end, and what is honestly still unproven.
- Outputs produced (paths); validation results verbatim (all five commands above); per-WP verdicts with evidence IDs; the five-point check for the phase.
- **WP-005 delivery status stated precisely**: mocked-proof result, and whether a real send to wrhixon@gmail.com occurred, succeeded, or was blocked — with the exact blocker if blocked. Never imply an email arrived unless the send returned success; note that Claude cannot observe that inbox (DEC-007), so user confirmation is the final word.
- Hypotheses closed (HYP-005..008) with their evidence; disagreements preserved; blockers with exact unblock conditions; budget consumed vs 375k plan.
