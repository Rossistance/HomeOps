# Dispatch Brief — Matching Lead (Run 2, TestFlight Mobile)

- Run: run-20260719-232201
- State: MATCHING_RUNNING (at dispatch)
- Date: 2026-07-20 (UTC)

## Objective

Produce the validated capability-task matching guide for implementing this run's pre-selected ★ Recommended bundle — WP-001 (help-loop integrity, server-side) + WP-002 (upload save-confidence UX) + WP-003 (event editor: end-date/all-day/notes) + WP-004 (Google description fidelity + one-save UX) — routing every bounded task to capabilities that verifiably exist in your session, with model/effort/budget per the canonical tables. The other menu items get phase-matrix treatment only (not task rows) since the selection is fixed.

## Scope, authority, non-goals

- Same mission authority as the audit brief (`handoffs/audit-lead-brief.md` §Authority): local backend only, no external mutations, no EAS/store actions, secrets untouchable, tester PII stays in the run. Read-only for product source (matching phase). Do not touch `runs/run-20260719-073933/**` or `phase-state.md`/`handoffs/`.
- Note the audit's standing constraint for your verification-surface rows: Google push verification is contract/mock-level ONLY — the resident household has a stale connected Google account and a live call already fired once (contained, DEC-08). No route may re-probe `/api/calendar/push/*` against a connected account; implementation must verify the payload builder below the transport.

## Required skills (read; follow)

1. `D:\The Only Skill\top-gun-claude\skills\capability-task-matcher\SKILL.md` + `references\matching-policy.md` + `references\runtime-drivers.md` (drivers are capability rows; platform fit is a hard constraint).
2. `D:\The Only Skill\top-gun-claude\skills\lean-implementation\references\budget-policy.md` — canonical tables.
3. `D:\The Only Skill\top-gun-claude\skills\mem\SKILL.md`; role card `agents\matching-lead.md`.
4. Spec/design context gate per your skill: attempt `product-management:write-spec` (Skill tool) for the task decomposition and a `design:*` skill for the event-editor/upload-UX design directions; record honestly if unavailable in your environment.

## Required inputs

- This run's `audit/implementation-queue.md` (WP-001..004 specs + acceptance criteria), `audit/issue-register.md` (ISS-001..013), `audit/master-report.md` §17–21, `audit/element-map.md` (source-derived testID/label map — feeds locator/verification rows), `facts-and-notes.md` (driver probes: playwright-web use-now; appium/appetize BLOCKED with exact env unblocks), `audit/decision-log.md` (esp. DEC-06 save-UX design decision, DEC-08 Google containment).
- Repo: mobile surface `apps/mobile/**` + server files the WPs name (help-requests/calendar/files endpoints). Local stack :8787/:5173/:9223.
- Run-1 lessons for routing rationale (historical): emulator serialization (one browser resource — code+typecheck-only parallel agents, lead-serialized runtime verification); chunked-write protocol for long documents (two API crashes in this run's audit).

## Required outputs

- `matching/capability-task-matching.md` complete per contract (all 9 sections; init script first). Task rows must cover: the four WPs decomposed into bounded tasks (server vs mobile-client write surfaces separated), the ISS-013 testID work IF the bundle's WPs need locators (else phase-matrix note), verification tasks (local-API contract tests, mobile-code typecheck, web-parity checks where shared, native-blocked parity risks named), and the ~7 TG- help-request residue cleanup as a small hygiene task.
- Delta `agent-deltas/matching-lead-delta.md`; journal events; guide registered as snapshot.
- Validation (verbatim in return): `python "D:\The Only Skill\top-gun-claude\skills\capability-task-matcher\scripts\init_matching.py" --project "D:\FamiliOS\FamiliOS"` then `validate_matching.py` same project — must pass.

## Write surface

`matching/`, `agent-deltas/`, `snapshots/` (via scripts), journal only. No concurrent writers.

## Model, effort, budget

100k output tokens soft; checkpoint after the capability inventory. No nested delegation.

## Return format

Guide path; highest-leverage matches; per-WP task/budget totals + mission implementation budget recommendation; unavailable/blocked effects; what the implementation lead must revalidate; verbatim validator output; budget consumed vs plan. Report to the orchestrator, not the user.
