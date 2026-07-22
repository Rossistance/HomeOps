# Dispatch Brief — Audit Lead

- Run: run-20260721-054151
- State: BOOTSTRAP → AUDIT_RUNNING
- Date: 2026-07-21T05:50:00Z

## Objective

Produce a root-cause diagnosis and a complete, evidence-grounded audit of FamiliOS's end-to-end task execution failure on web, culminating in a master report, PRD, work packages, and a numbered selection menu. The central question: why can no user task run start-to-finish ("hey can you do this" → "done, as you requested"), why does nothing appear in the Inbox, and where do the agent and automation subsystems conflict? The audit must be screenshot-led — every page, every route, every interactive element exercised in a real browser against a live local dev instance — and must treat prior runs' COMPLETE verdicts as historical claims to be re-verified, not facts. It also scopes three redesigns for the PRD: (a) ONE user-facing "Helper Agents" surface with pre-packaged tools/skills/automations replacing the fragmented agents/automations/workflows/skills/functions UI; (b) a rebuilt chat+agent orchestration harness benchmarked against the 22 use-cases in "automations and agents.txt" (the OpenClaw/Hermes-level bar); (c) a memory-subsystem redesign evaluating self-hosted Supermemory (https://supermemory.ai/docs/self-hosting/overview) and compatibility with a local LM Studio Qwen3.6-27B GGUF model at http://localhost:1234/v1.

## Scope and non-goals

- In scope: full convergent-360 audit S0–S5 of the web app (src/ + server/) at D:\FamiliOS\FamiliOS; live E2E repro of at least one task through chat with server-log + network + UI observation; code-path trace chat→planner→agents/assistant-runs→engine/orchestrator→triggers→notify/store; live tenant-data enumeration (agent count vs the user's "52", automations, improvements records, inbox entries); "improvements" feature safety assessment (what exists, what half-applied, what a safe wipe would require — propose, don't execute); LM Studio health probe; Supermemory research (WebFetch/WebSearch the docs + GitHub repo); screenshot-led crawl of every screen in src/screens and Shell navigation.
- Out of scope: any code fix, any data mutation beyond a disposable local dev instance, native iOS work, TestFlight, commit/push/deploy, external sends (email/SMS/Slack — dry-run only).
- Authority boundary: read-only on the repo; may run local dev server + Playwright against it; may create files ONLY under .top-gun/runs/run-20260721-054151/{audit,agent-deltas,snapshots}; must not write canonical registers (top-gun integrates your delta); no git commits; no destructive actions on server/.data or tenant DBs; no external service writes.

## Required skills

- top-gun:convergent-360 (invoke first — governs S0–S5), top-gun:mem (event journal + artifact registration protocol).

## Required inputs

- .top-gun/runs/run-20260721-054151/facts-and-notes.md (ART-001): mission facts, inferences, next discriminating checks — start from its "Next discriminating checks" order.
- "automations and agents.txt" (repo root): the 22 use-cases = the operational benchmark for "passing execution".
- .top-gun/runs/run-20260720-225249/ (historical): prior audit/master-report, implementation claims, per-use-case criteria docs (docs/use-case-criteria/) — re-verify, never trust.
- src/, server/, tests/topgun/: live source of record.
- Environment notes: Windows host; NODE_EXTRA_CA_CERTS may be needed for node CLIs; dev server via `npm run dev` (server+vite together) or `npm run server` + `npm run dev:web`; Playwright MCP tools (mcp__plugin_playwright_playwright__*) available via ToolSearch for the screenshot crawl.

## IDs in play

- Features: assign FEAT-### fresh this run | Issues: ISS-### fresh | Journeys: JRN-### fresh (the 22 use-cases should map to journeys) | Decisions: DEC-### fresh (carry DEC-10 native-visual-postponed as historical context) | Evidence: EV-###/ART-### continuing from ART-001.

## Required outputs

- audit/master-report.md — root-cause diagnosis with evidence chain (file:line + screenshot + log excerpts), full S0–S5 registers.
- audit/product-intent-register.md, audit/issue-register.md, audit/journey-register.md (22 use-case journeys + core "one task E2E" journey), audit/decision-log.md, audit/evidence/ (screenshots, logs, network traces).
- audit/prd.md — PRD covering the three redesigns (Helper Agents unification, orchestration harness rebuild, memory redesign) with measurable acceptance criteria per use-case.
- audit/work-packages.md — WP-### decomposition with dependencies and risk.
- audit/numbered-menu.md — the exact selection menu for the user (include a recommended bundle; include the improvements-wipe as its own opt-in item with backup-first plan).
- Agent delta: agent-deltas/audit-lead-delta.md.
- Validation: run the convergent-360 audit validator if present in the skill (validate_audit.py --stage audit); otherwise self-check every required file exists, is non-template, and every issue has evidence links — record the check output verbatim in the delta.

## Write surface and collision risks

- May write: .top-gun/runs/run-20260721-054151/{audit/**, agent-deltas/audit-lead-delta.md}.
- Must not write: canonical registers at run root (facts-and-notes.md, artifact-ledger.md, event-journal.md — append via mem scripts only), any repo source file, server/.data.
- Known concurrent writers: none (single lead).

## Model, effort, and budget

- Model: fable (claude-fable-5) — rationale: user directive "/top-gun fable 5 high"; highest-ambiguity diagnostic work, cross-subsystem tracing, adversarial re-verification of prior claims.
- Reasoning effort: high — per user directive; the root-cause hunt spans UI, server, scheduler, and data layers with misleading prior evidence.
- Token budget: 400k output tokens (soft — host does not enforce). Spend disproportionately on the live repro + pipeline trace; the screenshot crawl is broad but mechanical.
- Set per the top-gun:lean-implementation policy tables.

## Checkpoints, drift, and stop conditions

- Checkpoint cadence: after S1 (baseline + live repro of the failure), after S3 (surface crawl complete), after S5 (registers + PRD + menu drafted). Report via event journal appends.
- Drift signals: fixing code instead of auditing; mutating tenant data; skipping the live repro in favor of code-reading alone; accepting prior-run test results as current proof; screenshot crawl that opens pages but never interacts with elements; budget >150% at a checkpoint.
- Stop immediately when: dev server cannot start after reasonable diagnosis (report exact error as blocker); any action would send real email/SMS/Slack or mutate remote services; evidence indicates repo-external corruption requiring user decision.

## Return format

- Plain-language outcome; outputs produced (paths); validation results verbatim; root cause stated in one paragraph a non-engineer can read; evidence IDs; the numbered menu; disagreements preserved; blockers with exact unblock conditions; budget actually consumed vs plan.
