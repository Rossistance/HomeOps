# Dispatch Brief — Implementation Lead

- Run: run-20260720-225249
- State: SELECTED → IMPLEMENTATION_RUNNING
- Date: 2026-07-20T23:55:00Z

## Objective
Build all 22 use-cases from `source-use-cases.txt` per the validated plan: fully implement + locally verify the 9 ACTIVE items (catalog entry + backing skill each), write the 13 INACTIVE items as specs + criteria docs, scaffold + fill `docs/use-case-criteria/` for all 22, then commit/push/deploy and start a new TestFlight build. Done = active skills run green locally via the harness, all 22 criteria docs exist, `validate_audit --stage implementation` passes with verdict ship, code shipped, TestFlight build submitted.

## Scope and non-goals
- In scope: WP-001..013 (matching/capability-task-matching.md is your task plan). ACTIVE builds (UC-01,12,14,17,18,19,20,21,22), INACTIVE specs (UC-02..11,13,15,16), criteria scaffold (WP-011), local harness (WP-013), ship (WP-012).
- Out of scope: activating connectors; scripted live-account mutation (guardrail — live-record seeding is user-side; deliver a `scripts/seed-usecases.mjs` the USER runs, do NOT execute it against prod); native iOS visual verification (DEC-10 closed); the #1 live rewire/cleanup (separate, user-side).
- Authority: repo full write within scope; local stack execute (boot scripts/dev.mjs, node 25.8.2 at C:\Users\rhixon\AppData\Roaming\nvm\v25.8.2). Local tenant = REAL family data — TG- prefix ALL test records, clean up, prefer isolated harness. Prod /api/health + build-identity only. Only external send allowed: none new (UC delivery verified via TG- local methods / mocked fetch; no live sends to real family contacts).

## Ratified decisions to honor
- DEC-001: template is declarative; the runnable unit is a SKILL (steps[].tool_id must be REAL catalog ids). Each ACTIVE item = catalog entry (+ new id in catalogIds.ts) AND backing skill. Never invent a tool_id — if missing, it's not active.
- DEC-003: criteria docs at `docs/use-case-criteria/` (format in master-report §"Criteria-doc format") — connector-decoupled so the user can test later without inactive connectors.
- The 4 corrections: UC-12 device-runtime-unverified (contract/mock only, label it); UC-14 partial (weather+text via `notify_contact`, NOT `sms.send`; RSS stubbed); UC-20 attach targets events → put the doc ref in `task.notes`, do NOT misuse `attach_note_or_file_reference`; UC-22 no "recent inbox digest" tool → compose from write_memory + gmail.search + create_artifact.
- SHARED-CATALOG SINGLE-WRITER (the crux): YOU (the lead) are the sole writer of `src/data/catalogIds.ts`, `agentTemplates.ts`, `workflowTemplates.ts`, `playbooksCatalog.ts`. Any subagent authors ONLY its isolated skill file + its criteria doc and RETURNS a catalog-patch spec; you apply catalog patches serially. This is what makes the active builds parallelize without collision.

## Required skills
- top-gun:convergent-360 (S6 slices, S7 verification), top-gun:lean-implementation, top-gun:mem. Invoke at start.

## Required inputs
- `matching/capability-task-matching.md` (ART-012) — task plan, waves, models/efforts/budgets, verification lanes. Revalidate its dispatch preconditions first.
- `audit/implementation-queue.md` (ART-006) — the 24 WP specs. `audit/master-report.md` (ART-004) §6 mapping table + §criteria format + PRD. `audit/issue-register.md`, `audit/decision-log.md`, `audit/evidence-ledger.md`.
- `facts-and-notes.md` (ART-001), `source-use-cases.txt` (ART-002).
- Template contract: the 12 existing `src/data/agentTemplates.ts` entries; `workflowTemplates.ts`; `playbooksCatalog.ts`; `catalogIds.ts`. Skill shape: the just-shipped briefing skills + `server/skills.mjs`, `server/internal-functions.mjs`, `server/planner.mjs`.

## Required outputs
- Product code: catalog entries + backing skills for the 9 active UCs; `docs/use-case-criteria/UC-01..22.md` + `_TEMPLATE.md` + `README.md`; INACTIVE spec docs; optional `scripts/seed-usecases.mjs` (user-run). All uncommitted until WP-012.
- `implementation/slice-log.md` (five-point verdict per slice), `implementation/verification-matrix.md` (blocked/partial/inactive NEVER reported as pass), `implementation/budget-ledger.md`, `agent-deltas/implementation-lead-delta.md`.
- Validation before return, verbatim: `validate_audit.py --stage implementation`, `validate_memory.py --strict`, full server `npm test` (node 25.8.2), both `tsc --noEmit` (root + apps/mobile), Playwright web smoke.

## Ship (WP-012) — authorized
- The user authorized commit/push/deploy/TestFlight. Sequence: after all builds verified → commit (focused messages) → push (auto-deploys to Render; verify bundle-hash flip + health 200) → `eas build -p ios --profile production --auto-submit` (EXPORT NODE_EXTRA_CA_CERTS first — see memory windows-tls-and-cli-environment; it is UNSET this session; cert at `C:\Users\rhixon\OneDrive - 1910 Legacy Enterprises\Desktop\cert-file.cer`). Report build number + submission id. If CI or deploy fails, diagnose (don't paper over).

## Write surface / collisions
- May write: `src/data/**` (catalog — LEAD ONLY), backing skill files, `docs/use-case-criteria/**`, `scripts/seed-usecases.mjs`, tests, `implementation/**`, `agent-deltas/implementation-lead-delta.md`, journal/ledger. Must not: audit/**, matching/**, handoffs/**, phase-state.md, other runs.
- Subagents: isolated skill file + criteria doc only; never touch catalog files or each other's files.

## Model, effort, budget
- Per the guide: sonnet/medium for mechanical builds, sonnet/high for the 4 correction-heavy items (UC-14/20/22 + UC-01 real-Gmail approval), opus/high inline for WP-013 harness and WP-012 ship. Upgrade sonnet→opus if underpowered signals appear. Budget: 374k + 74k reserve (soft).

## Checkpoints / drift / stop
- Revalidate first: baseline npm test 352 green + both tsc 0; local stack boots; each active UC's tool_ids still in the catalog; HEAD = ee7bb93 + this session's uncommitted work intact.
- Checkpoints: after WP-013 harness; after each wave; before ship.
- Drift: inventing tool_ids; a subagent writing catalog files; scripted prod mutation; live send to a real family contact; claiming an inactive/mock item as verified; budget >150% pro-rata.
- Stop: a real external side effect fires unauthorized (blocker + trace); the local stack won't boot after 3 tries; a slice needs a 3rd another-round (escalate).

## Return format
- Plain outcome: which of the 9 active UCs run green locally, and what's honestly unverified (UC-12 device, inactive set). Outputs (paths); all validation verbatim; per-WP verdicts with evidence; the ship result (deploy bundle-hash + health, TestFlight build number + submission id, or the exact blocker); five-point check; disagreements; budget vs plan. State the live-seeding path handed to the user.
