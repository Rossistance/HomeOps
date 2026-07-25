# Dispatch Brief — Audit Lead

- Run: run-20260720-225249
- State: BOOTSTRAP → AUDIT_RUNNING (at dispatch)
- Date: 2026-07-20T23:00:00Z

## Objective

This is a BUILD-FROM-SPEC mission, not a defect audit. Produce the validated build plan for the 22 use-cases in `source-use-cases.txt`: derive the exact FamiliOS template contract from existing code, confirm each use-case's connector/tool mapping against the real catalog, split them into ACTIVE (fully build+verify) vs INACTIVE (spec+criteria only), and emit a work-package queue + a per-use-case success/test-criteria doc format that the implementation lead can execute directly. Done = master report + implementation-queue (WP per active item + a spec-and-criteria WP for the inactive set) + numbered menu, `validate_audit --stage audit` passes.

## Scope and non-goals

- In scope: read the template architecture and skill/tool catalog; verify the connector classification in facts §"Supported inferences"; define the catalog home (agentTemplate vs workflowTemplate vs playbook vs skill) for each item; map each ACTIVE item to concrete FamiliOS skill/tool ids; write acceptance criteria per item; define the criteria-doc format + folder (`docs/use-case-criteria/` recommended) once; decompose into work packages.
- Out of scope: writing product code (that's implementation); activating connectors; the #1 live rewire/cleanup; live-record seeding (delivery-constraint note only); native iOS visual verification.
- Authority: repo read + local stack execute (boot scripts/dev.mjs, node 25.8.2 at C:\Users\rhixon\AppData\Roaming\nvm\v25.8.2). Production /api/health only; NO scripted live mutations (classifier guardrail). Local tenant = REAL family data (TG- prefix, cleanup, prefer harness).

## Required skills
- top-gun:convergent-360 (invoke first), top-gun:mem.

## Required inputs
- `facts-and-notes.md` (ART-001) — connector inventory, 22-item classification, unknowns. Start from §"Next discriminating checks".
- `source-use-cases.txt` (ART-002) — the 22 verbatim with their tool/skill lists.
- Template contract sources: `src/data/agentTemplates.ts` (12 existing — derive the schema), `src/data/workflowTemplates.ts`, `src/data/playbooksCatalog.ts`, `src/data/catalogIds.ts`, `src/data/seed.ts`.
- Tool/skill catalog: `server/skills.mjs`, `server/internal-functions.mjs`, `server/functions.mjs`, `server/connectors.mjs`, `server/planner.mjs` (how a plan/skill declares tool steps).
- Historical: run-20260720-073025 registers (the deployed base; skill-step shape used by the just-shipped briefing skills is a working reference).

## IDs in play
- You assign EV/FEAT/ISS/WP/DEC. Use-cases are UC-01..UC-22 (map to the source doc numbering). Prior-run DEC-10 (native lane) cited as lineage.

## Required outputs
- `audit/` registers per convergent-360, especially:
  - `implementation-queue.md` — WP per ACTIVE use-case (UC → catalog home, exact skill/tool ids, trigger shape, acceptance criteria, criteria-doc path) + ONE WP for the INACTIVE set (spec + criteria docs, clearly labeled not-implemented) + WP for commit/deploy/TestFlight.
  - `master-report.md` — architecture map (the derived template contract), the per-UC mapping table (UC | catalog home | connector status active/partial/inactive | FamiliOS tools | acceptance criteria | verify-lane), the criteria-doc format spec, PRD, numbered menu.
- Agent delta: `agent-deltas/audit-lead-delta.md`.
- Validation: `validate_audit.py --project "D:\FamiliOS\FamiliOS" --stage audit` + `validate_memory.py` — both pass verbatim before return.

## Write surface and collision risks
- May write: `.top-gun/runs/run-20260720-225249/audit/**`, `agent-deltas/audit-lead-delta.md`, journal/ledger via mem scripts. NO product source (audit is read-only on code). Must not write other runs' trees.
- Concurrent writers: none expected; ignore/never-delete any foreign journal rows.

## Model, effort, and budget
- Model: inherit session model. Effort: high (architecture derivation + 22-item mapping with active/inactive rigor). Budget: 220k output tokens (soft).

## Checkpoints, drift, and stop conditions
- Checkpoints: after deriving the template contract; after the 22-item mapping table; before the master report.
- Drift: writing product code; probing prod beyond health; claiming an inactive item is verifiable; inventing tool ids not in the catalog (every ACTIVE mapping must cite a real tool id — downgrade to INACTIVE/blocked if a required tool is missing).
- Stop if: the local stack can't boot after 3 attempts (blocker + unblock); a supposedly-active connector's tool is absent from the catalog (reclassify, journal).

## Return format
- Plain outcome; the per-UC mapping table summary; how many active vs inactive (confirm/correct the facts' 9/13 split); the criteria-doc format decision; validator outputs verbatim; output paths; blockers with exact unblocks; budget vs plan.
