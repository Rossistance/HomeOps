# Dispatch Brief — Implementation Lead

- Run: run-20260721-054151
- State: SELECTED → IMPLEMENTATION_RUNNING
- Date: 2026-07-21T08:15:00Z

## Objective

Implement the user-selected FULL MENU — items 1–13 = WP-001…WP-012 (WP-008 split a/b) — as convergent-360 S6 vertical slices in the matching guide's wave order, each slice verified through the real UI (Playwright) plus server truth, until the mission's success sentence passes live: user asks in chat → work happens → Inbox/notifications/results are VISIBLE → chat's "Done" statement is true. The prior mission failed by verifying only the server world; this mission's definition of done for every slice includes the web read-model rendering the result where a family member would look.

## Scope and non-goals

- In scope (selected 2026-07-21, DEC-018): WP-001 Inbox truth (server approvals+notifications read-models); WP-002 truthful delivery (kill the delivered-regex; in-app delivery from chat); WP-003 one run world (unified history, correct status labels, no double-run affordance); WP-004 results have homes (tasks surface, artifacts library, deep links); WP-005 Helper Agents unification (one surface, packaged helpers, 51→≤20 migration-on-copy with dry-run gate); WP-006 orchestration harness to the 22-use-case executable bar (single entry, sandbox layer, per-UC Playwright specs); WP-007 memory redesign (LM Studio token field s1; Supermemory sidecar + retrieval integration; DEC-014 FTS5 fallback pre-agreed); WP-008a improvements reviewable (diff/revert UI, auto-apply default off); WP-008b OPT-IN improvements safe wipe (backup → dry-run report → HARD STOP for user approval → selective revert → verification); WP-009 sync-storm fix (~660→≤6 idle req/min, rev-gated hydration); WP-010 web family roles (profile picker tenancy fix, child sessions); WP-011 trust & lifecycle polish (plain-language activity, parked-run TTL incl. ISS-017 connector-parked expiry); WP-012 connector provisioning code lane + sandbox (real credentials remain user-owned).
- Non-goals: native iOS visual work (DEC-010); production-parity claims; TestFlight; any real external send without an explicit approval flowing through the app's own gates; real-credential OAuth setup (user-owned).
- Authority boundary: full write access to repo source and tests; local dev server + disposable tenants freely; RESIDENT tenant data (hh with 18 agents / EV-031) is read-only except through the two gated flows (WP-005 migration-on-copy after its dry-run gate; WP-008b revert after user approval of the dry-run report). Local git commits allowed per completed+verified slice with clear messages; DO NOT push (push auto-deploys via Render — orchestrator/user gate at mission end). No secrets in code or logs.

## Required skills

- top-gun:convergent-360 (S6 slice discipline + S7 verification matrix), top-gun:lean-implementation (budget policy; sub-agent routing), top-gun:mem (journal + artifacts; scripts at C:\Users\rhixon\.claude\plugins\cache\top-gun\top-gun\0.2.0\skills\mem\scripts\, --project "D:/FamiliOS/FamiliOS").

## Required inputs

- matching/capability-task-matching.md (ART-018) — AUTHORITATIVE routing: per-WP model/effort/budget, verification drivers, waves, gates. Follow its wave order: Wave 1 WP-001 ∥ WP-002 (+WP-007 s1 token field); Wave 2 WP-003 → WP-004; Wave 3 WP-006 core; Wave 4 WP-005 ∥ WP-007 Supermemory; Wave 5 WP-008a/b ∥ WP-010; Wave 6 WP-009, WP-011, WP-012.
- audit/work-packages.md (ART-013) + audit/prd.md (ART-012): slices + acceptance criteria per WP.
- audit/issue-register.md (ART-004), audit/evidence-ledger.md (ART-005), audit/master-report.md (ART-003): the defect map with file:line anchors (api.ts:530/944, Messages.tsx:161, useStore.ts:1093/1255-1290, index.mjs:2890, assistant-runs.mjs:45, internal-functions.mjs:448, Dashboard.tsx:79).
- audit/decision-log.md incl. DEC-013 (retire client-local runs/approvals console), DEC-014 (Supermemory + FTS5 fallback), DEC-015 (wipe = selective revert), DEC-016 (gated UCs = sandbox pass + named blocker), DEC-018 (this selection).
- facts-and-notes.md (ART-001): environment (Windows, NODE_EXTRA_CA_CERTS empty — set if node CLIs hit TLS; no gh CLI).

## IDs in play

- WPs: WP-001…WP-012 | Issues: ISS-001…017 | Journeys: JRN-1…5 + UC-1…22 | Decisions: DEC-010…018 | Evidence: EV-001…040; new EV/ART continue the sequence.

## Required outputs

- Working code in repo (src/, server/, tests/) — one local git commit per verified slice.
- implementation/slice-log.md — per slice: scope, files, validation commands + verbatim results, five-point verdict (ship/another-round), evidence links (screenshots under implementation/evidence/).
- implementation/verification-matrix.md — S7 matrix: per WP acceptance criteria × pass/fail/blocked-with-named-gate; the 22 UCs each marked pass(real) / pass(sandbox+named blocker) / fail.
- implementation/wipe-dry-run-report.md (WP-008b) — produced BEFORE any revert; mission pauses for user approval at that point.
- implementation/migration-dry-run-report.md (WP-005) — same pattern for the 51→≤20 consolidation of resident data.
- Agent delta: agent-deltas/implementation-lead-delta.md (validation verbatim, budget consumed per WP vs plan).
- Validation commands (baseline BEFORE wave 1, rerun per wave): `npm run typecheck`, `npm test`, `npm run topgun:web`; per-slice targeted Playwright specs; server truth via node:sqlite reads.

## Write surface and collision risks

- May write: repo source + tests; .top-gun/runs/run-20260721-054151/{implementation/**, agent-deltas/implementation-lead-delta.md}; local commits.
- Must not write: canonical registers (append via mem scripts only); resident tenant data outside the two gated flows; remote anything (no push, no deploy, no external sends).
- Collision: useStore.ts is single-owner during WP-003 (matching guide rule) — serialize WP-009 behind it; engine.mjs shared by WP-008a/WP-011 — serialize per guide.

## Model, effort, and budget

- Lead model: fable, effort high (user directive "/top-gun fable 5 high"). Sub-agents: route per ART-018 rows (opus/sonnet per WP; do not exceed a row's model tier without journaling a justified escalation).
- Token budget: 1,445k feature + 260k reserve = 1,705k output tokens (soft). Per-WP soft budgets in ART-018 rows; journal at each wave checkpoint: consumed vs plan.

## Checkpoints, drift, and stop conditions

- Checkpoint cadence: end of every wave (journal event + slice-log update); plus immediate checkpoint at the two HARD STOPs (WP-008b dry-run report ready; WP-005 migration dry-run ready) — surface both to the orchestrator/user and WAIT.
- Drift signals: any slice claiming done without a UI-rendered proof; touching resident tenant outside gates; push/deploy attempts; sub-agent model tier above the guide row without journaled justification; wave budget >150% of its ART-018 sum.
- Stop immediately when: baseline suites cannot be made green before wave 1 (report exact failures); LM Studio token still absent when WP-007 s1 acceptance is due (mark DEFERRED-ON-GATE, continue other slices — do not fake it); Supermemory sidecar install fails on Windows after reasonable diagnosis (invoke DEC-014 FTS5 fallback and journal the decision); any action would leave the machine (external sends, push).

## Return format

- Plain-language outcome; per-WP status table (shipped / another-round / blocked+gate); slice-log + verification-matrix paths; validation results verbatim (typecheck/test/topgun:web final runs); the two dry-run reports' status; evidence IDs; commits list (hash + message); budget consumed vs plan per wave; residual risks and exactly what remains for the user (LM Studio token, OAuth provisioning, push/deploy decision).
