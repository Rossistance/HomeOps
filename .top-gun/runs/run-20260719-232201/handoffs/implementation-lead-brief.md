# Dispatch Brief — Implementation Lead (Run 2, ★ Bundle)

- Run: run-20260719-232201
- State: IMPLEMENTATION_RUNNING (at dispatch)
- Date: 2026-07-20 (UTC)
- Selection: **★ Recommended bundle = WP-001 + WP-002 + WP-003 + WP-004** (user pre-selection, recorded at bootstrap and at SELECTED).

## Objective

Implement the bundle as sequenced, truthful vertical slices per the matching guide's task plan — help-loop integrity (WP-001), upload save-confidence (WP-002), event-editor completeness (WP-003), Google description fidelity + one-save UX (WP-004) — each verified against its acceptance criteria in this run's `audit/implementation-queue.md`. Done means: acceptance criteria pass with artifact-backed evidence, `validate_audit.py --stage implementation` passes, final five-point verdict `ship`, budget ledger complete.

## Scope and non-goals

- In scope: exactly the guide's tasks for WP-001..004 (T-101.. groups), the T-501 TG-residue hygiene task, and T-601 final verification. Write surfaces split per the guide: serialized G-SRV server group (`server/index.mjs`, `server/calendar.mjs`, help-requests/files endpoints — single writer, shared with the web app), G-MOB groups under `apps/mobile/**`.
- Out of scope: web app (`src/`) changes EXCEPT where a server contract change requires a matching web-client touch — if that arises, make the smallest coherent cross-layer correction, document it, and verify web regression (run-1's uncommitted slate must keep working: typecheck + affected web behavior). No WP-005..008 menu items, no EAS/store work, no testID sweep (ISS-013 deferred per guide).
- Sequencing: WP-001 server truth first (the P1), then per the guide's dependency order (WP-003 server allDay/span before its mobile editor tasks; WP-004 depends on WP-003's notes field).

## Authority boundary (binding)

- Local repository edits within bundle scope only. NO git commits/pushes/branches/PRs, no deploys, no publications.
- **Google: policy veto stands (DEC-08).** Never call `/api/calendar/push/*` or any Google API against the resident household's connected account. Verify the push-payload builder at mocked-fetch/fixture level below the transport. The `needsApproval` runtime path stays unobserved — label it, never fake it.
- Local backend :8787 only; production Render backend untouchable. No SMS/OAuth/external side effects. Secrets per mission facts. Tester PII stays in the run workspace.
- Preserve ALL uncommitted work: run-1 slate changes across `src/` + `server/`, user harness (`tests/topgun/`, `topgun:*` scripts), `.claude/launch.json`, `testflight-feedback-handoff/`. Never revert anything.
- Test discipline: `npm test` is safe beside the live backend (run-1 isolation — re-verify with a baseline run first). Mobile typecheck: `npx tsc --noEmit` inside `apps/mobile` (no packaged script). New server tests follow the isolation pattern (`server/test/*` with ctx.dataDir binding).

## Required skills (read; follow)

1. `D:\The Only Skill\top-gun-claude\skills\lean-implementation\SKILL.md` + `references/budget-policy.md` — delegation/budget/monitoring/respawn policy.
2. `D:\The Only Skill\top-gun-claude\skills\convergent-360\SKILL.md` S6–S7 + `references/register-contracts.md` (implementation doc formats).
3. `D:\The Only Skill\top-gun-claude\skills\mem\SKILL.md`; role card `agents/implementation-lead.md`.

## Required inputs

- `matching/capability-task-matching.md` — the task plan, budgets, concurrency groups, verification routes. **Revalidate its dispatch list first**: servers listening; server-suite baseline re-run; node (use `C:\Users\rhixon\AppData\Roaming\nvm\v25.8.2\node.exe` / prepend `C:\Users\rhixon\AppData\Roaming\nvm\v25.8.2` to PATH); HEAD ffcfa33 with uncommitted work intact; driver re-probe only if creds appeared.
- `audit/implementation-queue.md` (acceptance criteria), `audit/issue-register.md` (ISS-001..013), `audit/element-map.md`, `audit/decision-log.md` (DEC-06 one-save design, DEC-08 Google), `audit/evidence-ledger.md` (EV-NET/CODE anchors), `facts-and-notes.md`.
- Server endpoints of record: `/api/help-requests/:id/respond` (missing `assignedMemberId` PATCH + no dedupe — the confirmed P1), files endpoints (WP-002 server touchpoints if any), calendar payload builder at `server/calendar.mjs:357` area (WP-003/004).

## Required outputs

- `implementation/slice-log.md`, `implementation/verification-matrix.md`, `implementation/budget-ledger.md` — per register-contracts, created EARLY and maintained as you go (not at the end).
- Delta `agent-deltas/implementation-lead-delta.md`; journal events per slice/checkpoint/intervention; artifacts registered (snapshot the three docs at completion; reference-mode changed source files).
- Validation before return (verbatim): `validate_audit.py --project "D:\FamiliOS\FamiliOS" --stage implementation`; `validate_memory.py`; server suite result; both typechecks (root `tsc -p tsconfig.json` for any web-touch regression + `apps/mobile` `npx tsc --noEmit`).

## Write surface and collision risks

- May write: files named by the guide's tasks (server G-SRV serialized; `apps/mobile` G-MOB groups), new isolated server tests, this run's `implementation/`, `agent-deltas/`, `snapshots/` (via scripts), journal. Must not write: `phase-state.md`, `handoffs/`, closed run `runs/run-20260719-073933/**`, `.claude/launch.json`, user harness files (new clearly-named spec files only).
- The backend server process serves live local state — restarting it after server edits is expected; journal every restart and re-verify health + the resident household's data integrity (no data loss).

## Model, effort, and budget

- Ceiling **360k output tokens soft** (guide: 343k planned incl. 54k verification-only reserve). Guide's per-task models/efforts apply (sonnet/medium default; sonnet/high T-101/302/303/401; fable-or-top-alias/xhigh T-601 final verification; haiku-class T-501). Checkpoints per task class; interventions per budget-policy ladder; journal them.
- Delegate only per lean-implementation criteria; parallel agents are code+typecheck-only (one browser/backend runtime — lead-serialized runtime verification, run-1 lesson). If the Agent tool is unavailable, separated passes.
- **Chunked-write protocol (mandatory, crash lesson):** every long document or large source edit lands in multiple small tool calls; no monolithic single-response compositions.

## Stop conditions

Any external mutation risk; any Google-route call; production backend touch; `.data` integrity risk outside controlled server work; double restart failure of a service; scope growth beyond the bundle.

## Return format

Per-WP outcome (delivered/partial/blocked + exact unblock); files changed; slice verdicts; verification-matrix summary (pass/fail/partial/blocked honest); server-suite + both typechecks verbatim; validator outputs verbatim; budget plan vs actual with causes; native-parity risks restated; deployment status precisely (expect: local worktree only). Report to the orchestrator, not the user.
