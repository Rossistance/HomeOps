# Dispatch Brief — Matching Lead

- Run: run-20260719-073933
- State: MATCHING_RUNNING (at dispatch)
- Date: 2026-07-19 (UTC)

## Objective

Produce the validated capability-task matching guide for this mission: decompose the audit's work packages (WP-001..005) and menu options into bounded tasks, inventory the capabilities actually available in your session with evidence, and route every task to a primary+fallback capability, an agent-or-inline role, a model class, a reasoning effort, and a soft token budget — so a future implementation lead can execute the user's selection economically. Done means `validate_matching.py` passes and the guide is registered as a snapshot.

## Scope and non-goals

- In scope: everything needed to complete `matching/capability-task-matching.md` per its document contract.
- Out of scope: implementation, re-auditing, installing/authorizing anything new. Never trigger auth flows or external side effects to "test" a capability.
- Authority boundary: identical to the mission's (read-only product source; no secrets: `.env`, vault files, the .p8 and twilio files in D:\HomeOps; no git mutations; do not touch `phase-state.md` or `handoffs/`).

## Required skills (read the files; follow as operating policy)

1. `D:\The Only Skill\top-gun-claude\skills\capability-task-matcher\SKILL.md` — your governing skill — plus its `references\matching-policy.md`.
2. `D:\The Only Skill\top-gun-claude\skills\lean-implementation\references\budget-policy.md` — canonical task-class/budget/model/effort tables; cite these in your Model and Effort Rationale.
3. `D:\The Only Skill\top-gun-claude\skills\mem\SKILL.md` + `references\memory-contract.md` — memory protocol.
4. `D:\The Only Skill\top-gun-claude\agents\matching-lead.md` — your role card.
5. Spec/design comparison per your skill's context gate: this session DOES expose `product-management:write-spec` and `design:*` skills — invoke `product-management:write-spec` (Skill tool) to structure the guide's task decomposition as a real spec, and `design:design-critique` or `design:design-handoff` where a task's design direction needs grounding. If the Skill tool or those skills are unavailable in your environment, do the two-field playback fallback and record them as unavailable — honestly, not silently.

## Required inputs

- Audit outputs under `D:\HomeOps\homeops-ai\.top-gun\runs\run-20260719-073933\audit\`: `implementation-queue.md` (WP-001..005 — your task source), `issue-register.md` (ISS-001..010+003b), `master-report.md` §17–21 (opportunities, remediation plan, PRD, menu), `functionality-inventory.md` (coverage gaps → verification tasks).
- `facts-and-notes.md` (capability notes: Playwright fallback, blocked in-app pane, servers, node story) — revalidate drift-prone facts.
- Repo capabilities: `package.json` scripts (test/typecheck/build), the known-good server restart commands, existing test suite (287 server tests per audit).

## IDs in play

- WP-001..005, ISS-001..010+003b, FEAT/EV per registers, HYP-001/003/006 (open hypotheses that implementation must revalidate).

## Required outputs

- `matching/capability-task-matching.md` completed per contract (init script first). All 9 sections; Task Matrix rows for every WP plus the coverage-completion tasks (the four blocked persona journeys) and CI-guard work implied by ISS-008.
- Agent delta: `agent-deltas/matching-lead-delta.md`.
- Journal events (start, checkpoint, completion) + artifact registrations via mem scripts.
- Validation (must pass; include verbatim output in return):
  - `python "D:\The Only Skill\top-gun-claude\skills\capability-task-matcher\scripts\init_matching.py" --project "D:\HomeOps\homeops-ai"`
  - `python "D:\The Only Skill\top-gun-claude\skills\capability-task-matcher\scripts\validate_matching.py" --project "D:\HomeOps\homeops-ai"`

## Write surface and collision risks

- May write: `matching/`, `agent-deltas/`, `snapshots/` (via scripts), journal. Must not write anywhere else. No concurrent writers; the orchestrator stays off the run dir while you work.

## Model, effort, and budget

- You: session model. Token budget: 120k output tokens soft. Checkpoint after the capability inventory (append event with consumption estimate). No nested delegation (your role card forbids it absent hard evidence needs).

## Checkpoints, drift, and stop conditions

- Drift: inventing capabilities not observed in your session; task rows without a considered alternative route; copying budget numbers without task-class rationale; exceeding write surface.
- Stop when: any action would require new authorization; the audit inputs are missing (return blocker naming the path).

## Return format

Guide path; highest-leverage matches; unavailable/blocked capabilities and their effect on the plan; planned budget totals + reserve; the assignments an implementation lead must revalidate at execution time; verbatim validator output; budget consumed vs plan. Final message is a report to the orchestrator, not the user.
