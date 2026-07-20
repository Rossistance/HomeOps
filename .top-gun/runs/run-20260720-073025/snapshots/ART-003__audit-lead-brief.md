# Dispatch Brief — Audit Lead

- Run: run-20260720-073025
- State: BOOTSTRAP → AUDIT_RUNNING (at dispatch)
- Date: 2026-07-20T07:45:00Z

## Objective

Produce a validated Convergent 360 audit (S0–S5) that pins down, with runtime evidence, exactly WHERE the Ask Famili chat→execution chain lies to the user: a chat request like "create an agent that emails wrhixon@gmail.com a daily 7 AM briefing" reports success, yet nothing real ever happens — per the user, for EVERY task type in chat. Done = the false-success seam(s) are identified and reproduced at HEAD locally, the issue register ranks them, a PRD + work packages + numbered selection menu exist for the fix, and validate_audit --stage audit passes.

## Scope and non-goals

- In scope: the full chat task chain at HEAD on the LOCAL stack — `POST /api/assistant` (+stream), planner, buildFromChat entity creation (agents/skills/automations/triggers/contact-methods), trigger scheduling semantics ("daily 7 AM" mapping, tz), orchestrator/engine step execution, notify/email delivery gates, run-result → conversation-summary honesty, the mobile client's TWO run paths ((ask)/index.tsx server-durable watch vs useRun().startRun local), and the web (src/) equivalents where they share the seam. Version skew: state precisely which findings exist in the user's prod lineage (ffcfa33) vs only at HEAD.
- Out of scope: fixing anything (audit only); native iOS visual verification (lane CLOSED by prior-run DEC-10 — user decision, do not re-open); store/EAS actions; Render deploy repair (external, user-side); production behavioral probes.
- Authority boundary: local repo read + local stack execute freely (boot it: `scripts/dev.mjs`, node 25.8.2 at `C:\Users\rhixon\AppData\Roaming\nvm\v25.8.2` prepended to PATH). Production homeops-ai.onrender.com: /api/health ONLY. NO live Google calls (DEC-08 lineage: stale household account, one contained 401 incident already). NO sends to real family contact methods; email verification happens below the transport (mocked fetch / fakeProvider harness per `server/test/assistant-persistence.test.mjs` pattern) — a live send lane needs explicit user authorization you do not have. Local tenant data on the resident household is REAL family data: create test records under clearly-marked TG- prefixes and clean up; never mutate real records.

## Required skills

- top-gun:convergent-360 (invoke first), top-gun:mem (event journal + artifact registration discipline).

## Required inputs

- `.top-gun/runs/run-20260720-073025/facts-and-notes.md` (ART-002 snapshot): surface map, seam hypotheses (a)–(d), capability inventory, discriminating checks 1–6 — start there, in that order.
- `server/triggers.mjs`, `server/notify.mjs`, `server/index.mjs` (assistant/build/run routes, startup timers at :3240–3290), `server/planner.mjs`, `server/orchestrator.mjs`, `server/engine.mjs`, `server/agents.mjs`, `server/assistant-runs.mjs`, `server/functions.mjs`, `server/internal-functions.mjs`, `server/connectors.mjs`.
- `apps/mobile/src/app/(ask)/index.tsx`, `apps/mobile/src/lib/run-context*`, `apps/mobile/src/lib/api.ts`; web: `src/screens/Assistant.tsx`, `src/screens/Automations.tsx`, `src/store/useStore.ts`, `src/lib/ai.ts`.
- Test-harness pattern: `server/test/assistant-persistence.test.mjs` (fakeProvider — drive the REAL engine without external AI).
- Historical context (label historical, revalidate): run-20260719-232201 registers (DEC-08 stale Google account, element-map); FamiliOS 30-day goals ("real-provider end-to-end loop", "migrate mobile plan dispatch to durable server run engine").

## IDs in play

- Evidence: ART-001 (bootstrap), ART-002 (facts handoff). You assign EV-/FEAT-/ISS-/JRN- IDs fresh this run. Prior-run DEC-08/DEC-10 are cited as lineage only.

## Required outputs

- `audit/` registers per convergent-360: functionality inventory, issue register, evidence ledger, hypothesis queue, decision-log proposals, master report (with PRD + work packages + numbered selection menu), element/architecture maps as doctrine requires.
- Agent delta: `agent-deltas/audit-lead-delta.md`
- Validation: `python "C:\Users\rhixon\.claude\plugins\cache\top-gun\top-gun\0.2.0\skills\convergent-360\scripts\validate_audit.py" --project "D:\FamiliOS\FamiliOS" --stage audit` (resolve the script path via the convergent-360 skill if it differs) AND `python "C:\Users\rhixon\.claude\plugins\cache\top-gun\top-gun\0.2.0\skills\mem\scripts\validate_memory.py" --project "D:\FamiliOS\FamiliOS"` — both must pass verbatim before return.

## Write surface and collision risks

- May write: `.top-gun/runs/run-20260720-073025/audit/**`, `agent-deltas/audit-lead-delta.md`, journal via append_event.py, artifacts via record_artifact.py; local test records (TG- prefixed) in the local tenant store; temp scripts under the run's `audit/evidence/`.
- Must not write: canonical `facts-and-notes.md`, `handoffs/**`, `phase-state.md`, any repo source files (audit = read-only on product code), anything under `.top-gun/runs/run-20260720-072344/` (another session's run — do not touch) or prior runs.
- Known concurrent writers: a SECOND session may be active on run-20260720-072344 (different goal). It should not touch this run; if you observe foreign writes inside THIS run's tree, journal a disagreement event and continue.

## Model, effort, and budget

- Model: inherit session model (Fable) — rationale: cross-layer causal audit with high ambiguity and honesty-critical evidence classification; top capability tier justified per lean-implementation high-ambiguity/high-risk row.
- Reasoning effort: high — rationale: multi-seam diagnosis, but the surface map and hypothesis space are pre-narrowed by the facts handoff; xhigh reserved for verification stalemates.
- Token budget: 350k output tokens (soft — host does not enforce). Checkpoint budget-consumed at each journal checkpoint; >150% of pro-rata plan at a checkpoint = drift signal.

## Checkpoints, drift, and stop conditions

- Checkpoint cadence: journal a checkpoint after S0 (preflight/stack boot), after the first successful end-to-end repro of the false success, after each seam verdict (build-seam, trigger-seam, run/step-seam, summary-seam, client-path-seam), and before composing the master report.
- Drift signals: editing product source; probing production beyond /api/health; any live Google/external send; budget >150% pro-rata; evidence rows without commands/outputs; re-opening the closed native lane.
- Stop immediately when: a live external side effect fires unexpectedly (journal a blocker event with full trace — DEC-08 protocol); the local stack cannot boot after 3 distinct remediation attempts (blocker + exact unblock); or foreign-session writes corrupt this run's registers.

## Return format

- Plain-language outcome (the cause, in one paragraph, evidence-first); outputs produced (paths); validation results verbatim; evidence IDs for every causal claim; per-seam verdicts including honest not-reproduced results; version-skew statement (HEAD vs user's ffcfa33 prod lineage); disagreements preserved; blockers with exact unblock conditions; budget actually consumed vs plan.
