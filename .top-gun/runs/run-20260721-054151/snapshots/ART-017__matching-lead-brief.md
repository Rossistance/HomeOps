# Dispatch Brief — Matching Lead

- Run: run-20260721-054151
- State: AUDIT_COMPLETE → MATCHING_RUNNING
- Date: 2026-07-21T07:00:00Z

## Objective

Produce the capability-task matching guide for the 12 validated work packages (WP-001…WP-012), so the implementation lead can route every slice to the right execution capability, model tier, reasoning effort, and token budget. The guide must reflect THIS session's live capability set (re-inventory it; do not trust the audit's inventory as current), incorporate the lean-implementation budget-policy tables into per-WP model/effort/budget columns, and flag every WP whose verification needs a runtime driver (Playwright web crawl, dev-server logs, sqlite reads) or an external gate (OAuth apps, LM Studio token, Supermemory sidecar install).

## Scope and non-goals

- In scope: read the audit outputs (master report, PRD, work packages, issue register, evidence ledger); inventory current capabilities (tools, MCP servers incl. deferred via ToolSearch, Playwright MCP, skills, agents, models fable/opus/sonnet/haiku, local runtimes: node 25, python 3.14, LM Studio at localhost:1234 [token-gated, EV-035]); produce capability-task-matching.md mapping each WP (and its slices where granularity matters) to capabilities, model, effort, budget, verification driver, and external gates.
- Out of scope: any implementation, any code or data change, any re-audit of the app, changing WP scope or priorities.
- Authority boundary: read-only everywhere except the matching output path and your delta. No repo edits, no server starts required (inventory only), no external sends.

## Required skills

- top-gun:capability-task-matcher (governs the guide format), top-gun:lean-implementation (budget-policy tables feed the model/effort/budget columns), top-gun:mem (journal/artifact protocol; scripts under C:\Users\rhixon\.claude\plugins\cache\top-gun\top-gun\0.2.0\skills\mem\scripts\, project root D:/FamiliOS/FamiliOS).

## Required inputs

- .top-gun/runs/run-20260721-054151/audit/work-packages.md (ART-013): the 12 WPs with slices/acceptance criteria.
- audit/prd.md (ART-012), audit/master-report.md (ART-003), audit/issue-register.md (ART-004): context and issue links.
- audit/evidence/SEC-035-lmstudio-probe.txt + EV-035/EV-036 entries in audit/evidence-ledger.md: LM Studio token gate, Supermemory feasibility — these constrain WP-007 routing.
- facts-and-notes.md (ART-001): environment constraints (Windows, NODE_EXTRA_CA_CERTS, no gh CLI).

## IDs in play

- WPs: WP-001…WP-012 | Issues: ISS-001…017 | Decisions: DEC-010…017 | Evidence: EV-001…040 | Artifacts: ART-001…016 continuing.

## Required outputs

- matching/capability-task-matching.md — per-WP rows: required capabilities (exact tool/skill names), runtime driver for verification, model alias + rationale, reasoning effort + rationale, output-token budget (soft), external gates/blockers, and parallelization notes (which WPs can run as parallel slices vs serialized).
- Agent delta: agent-deltas/matching-lead-delta.md (validation output verbatim, budget consumed).
- Validation: self-check — every WP-001…012 has a row; every row names at least one verification driver; LM Studio/OAuth gates carried onto WP-006/007/012; no capability named that is not in the current inventory. Record the check verbatim.

## Write surface and collision risks

- May write: .top-gun/runs/run-20260721-054151/{matching/**, agent-deltas/matching-lead-delta.md}.
- Must not write: canonical registers, audit/**, repo source.
- Known concurrent writers: none.

## Model, effort, and budget

- Model: fable — rationale: user directive "/top-gun fable 5 high"; routing judgment across a large capability surface benefits from the strongest model, though the task is medium-complexity.
- Reasoning effort: high — per user directive.
- Token budget: 60k output tokens (soft). This is a mapping task, not a discovery task; do not re-audit.
- Set per the top-gun:lean-implementation policy tables.

## Checkpoints, drift, and stop conditions

- Checkpoint cadence: single checkpoint at return (task is one sitting).
- Drift signals: re-running the app or re-crawling UI; rewriting WP scope; inventing capabilities; budget >150%.
- Stop immediately when: audit inputs missing/corrupt (report as blocker).

## Return format

- Plain-language outcome; guide path; validation verbatim; per-WP one-line routing summary; any capability gaps that would block specific WPs; budget consumed vs plan.
