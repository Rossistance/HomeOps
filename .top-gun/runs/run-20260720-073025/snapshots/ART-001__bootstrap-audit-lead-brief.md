# Dispatch Brief — Audit Lead

- Run: run-20260720-072344
- State: BOOTSTRAP → AUDIT_RUNNING
- Date: 2026-07-20T07:35:00Z (UTC approx.)

## Objective

Execute Convergent 360 states S0–S5 for the mission goal "deliver the FamiliOS discovery 30-day priorities": (1) HomeOps→FamiliOS rebrand completion, (2) full topgun E2E pass, (3) real-provider end-to-end loop demo, (4) mobile durable-run migration to the durable server engine. Done = populated canonical registers (evidence index, functionality inventory, issue register, persona journeys as applicable), a master audit report, PRD-grade problem statements, work packages sized for the four goals, and a numbered selection menu with a recommended bundle — all validated by `validate_audit.py --stage audit`.

## Scope and non-goals

- In scope (read/audit): repo `D:\FamiliOS\FamiliOS` — `src/`, `server/`, `apps/mobile/`, `tests/topgun/`, `render.yaml`, READMEs/docs, CI workflow. Local runtime probes (start backend/Vite locally with node v25.8.2) are allowed and encouraged.
- Out of scope: any product-source WRITE; any mutation of production `https://homeops-ai.onrender.com` (health-check GET only); EAS builds; deploys; git mutations; external sends; OAuth registrations; `.env`/vault secrets.
- Authority boundary: product source read-only. Writes allowed ONLY under the run workspace `audit/`, `agent-deltas/`, and journal/ledger via mem scripts.

## Required skills

- `top-gun:convergent-360` (invoke first, follow S0–S5), `top-gun:mem` (event/artifact discipline).

## Required inputs

- `.top-gun/runs/run-20260720-072344/facts-and-notes.md` (ART-001): environment, authority, unknowns, discriminating checks — start from its "Next discriminating checks".
- Snapshot `snapshots/ART-002__01-discovery.md`: the discovery report that defines the four goals.
- Historical registers: `.top-gun/runs/run-20260719-232201/audit/` and `run-20260719-073933/` — label anything reused as historical until revalidated.
- `docs/`, `README.md`, `apps/mobile/CLAUDE.md`, repo CLAUDE.md files — repository instructions apply.

## IDs in play

- None yet — you assign EV/FEAT/ISS/JRN/WP IDs per the mem contract. DEC IDs remain orchestrator-owned (propose via delta).

## Required outputs

- `audit/` canonical register set per convergent-360 (created by its init script), including master audit report, PRD, work packages (each goal decomposed to M/L-class WPs), numbered selection menu with a recommended bundle.
- Agent delta: `agent-deltas/audit-lead-delta.md` — findings, proposed decisions, budget consumed, disagreements.
- Validation: `python "<convergent-360 base>/scripts/validate_audit.py" --project "D:\FamiliOS\FamiliOS" --stage audit` must pass before return; include its verbatim output.

## Write surface and collision risks

- May write: `.top-gun/runs/run-20260720-072344/audit/**`, `agent-deltas/audit-lead-delta.md`, journal/ledger via mem scripts only.
- Must not write: canonical `facts-and-notes.md`, `phase-state.md`, `handoffs/**`, any product source, anything outside the run workspace.
- Known concurrent writers: none (single lead).

## Model, effort, and budget

- Model: inherit (session top-tier) — rationale: L-class cross-layer audit with arbitration between historical and current evidence across web/server/mobile/E2E surfaces.
- Reasoning effort: high — cross-layer sizing decisions (durable-run migration, deploy-coupled rebrand) need real design judgment.
- Token budget: 120k output tokens (soft — host does not enforce). Nested specialists per convergent-360/mandate rules only; assign each ≤ 25k soft.
- Set per top-gun:lean-implementation policy tables.

## Checkpoints, drift, and stop conditions

- Checkpoint cadence: journal a `checkpoint` event after S1 (evidence baseline), after S3 (issue register), and before S5 return.
- Drift signals: product-source writes, production mutations beyond health GET, budget > 150% at a checkpoint, claims of runtime evidence without captured output, silence past S3.
- Stop immediately when: any secret material would need to be copied to proceed (sanitize instead); production mutation would be required (record blocker); node/tooling failures make runtime probes impossible (fall back to static evidence and label honestly).
- Environment guardrails: use `C:\Users\rhixon\AppData\Roaming\nvm\v25.8.2\node.exe` (default node is 20.x and below engines); backend :8787, Vite :5173; kill only processes you started (PID discipline).

## Return format

Plain-language outcome; outputs produced (paths); `validate_audit.py` output verbatim; key EV/ISS/FEAT/WP IDs; the numbered menu + recommended bundle; disagreements preserved; blockers with exact unblock conditions; budget consumed vs 120k plan.
