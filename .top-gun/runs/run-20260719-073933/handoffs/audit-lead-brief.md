# Dispatch Brief — Audit Lead

- Run: run-20260719-073933
- State: AUDIT_RUNNING (at dispatch)
- Date: 2026-07-19 (UTC)

## Objective

Execute the Convergent 360 audit (states S0–S5-prep) of FamiliOS as a fully autonomous exploratory testing agent that behaves like a real smartphone user: navigate, tap, swipe, type, and observe the running app at phone viewport through the Playwright emulator, pair every meaningful UI action with its implementation trace, and converge everything into the validated master report, brownfield PRD, work packages, and numbered implementation menu. Done means: `validate_audit.py --stage audit` passes, coverage is honestly reported, and the menu with one Recommended bundle is ready for the selection gate.

## Scope and non-goals

- In scope — the user's hunt list, mapped onto the mandate: functional bugs and broken functions/workflows (S3 dual-lane), broken links (every nav/footer/legal destination), UI/UX and design critique (Track A, judged against `DESIGN_SYSTEM.md`), CI/CD review (`.github/` workflows + `render.yaml` + scripts, Track B), code debt and code review (Track B maintainability/correctness lenses), improvements and additions (Opportunity Register), accessibility/responsive/performance/security-passive lenses as the mandate directs. Web app at mobile viewport is the primary surface; desktop viewport for responsive comparison; `apps/mobile` (Expo) and `mobile-version/` are code-review scope only — do not attempt device simulation.
- Out of scope: any implementation, fix, or product-source edit; deployment; git mutations; external publication.
- Authority boundary: product source / git / production / external services read-only. Local in-app state creation (IndexedDB, `server/.data`) through normal product use is allowed. NO connector executions with external side effects, NO OAuth setup, NO SMS. Never read or quote: `.env`, `server/.data/` vault contents, `D:\HomeOps\SubscriptionKey_3A6LNPV3XG.p8`, `D:\HomeOps\twilio_2FA_recovery_code.txt`. Never touch `.claude/launch.json` (pre-existing dirty file).

## Required skills (read these files completely and follow them as operating policy)

This session predates the plugin's registration, so load skills by reading their files:

1. `D:\The Only Skill\top-gun-claude\skills\convergent-360\SKILL.md` — your governing skill (S0–S5).
2. Its references, same folder: `references/register-contracts.md` (file contracts), `references/mandate.md` (canonical mandate — map headings with Grep first, then read fully in chunks).
3. `D:\The Only Skill\top-gun-claude\skills\mem\SKILL.md` + `references/memory-contract.md` — memory protocol.
4. `D:\The Only Skill\top-gun-claude\skills\lean-implementation\references\budget-policy.md` — budget/checkpoint discipline for any nested delegation.
5. `D:\The Only Skill\top-gun-claude\agents\audit-lead.md` — your role card; you are this agent.

## Required inputs

- `D:\HomeOps\homeops-ai\.top-gun\runs\run-20260719-073933\facts-and-notes.md` — current facts, boundaries, unknowns, capability notes. Trust it over memory; revalidate anything drift-prone.
- Repo root `D:\HomeOps\homeops-ai` (branch main, HEAD ffcfa33, one dirty file to leave alone). Key docs: `README.md`, `DESIGN_SYSTEM.md`, `docs/`, product docs in `D:\HomeOps\` (00–11 numbered .md files, read-only context for product intent).
- Running product (keep alive, do not stop): web http://localhost:5173 (Vite dev), backend http://localhost:8787 (health at /api/health), app browser-runtime :9223. If the web tier dies (known one-time 0xC0000005 Vite crash on node25), restart it in background exactly with: `Set-Location "D:\HomeOps\homeops-ai"; & "C:\Users\rhixon\AppData\Roaming\nvm\v25.8.2\node.exe" node_modules\vite\bin\vite.js` and re-poll :5173. Record any crash as evidence.

## Emulator protocol (the smartphone-user embodiment)

- Use the Playwright MCP tools (mcp__plugin_playwright_playwright__browser_*) for ALL product interaction. The in-app Browser pane is blocked this session (screenshots hang, navigations denied) — recorded fallback; do not use it.
- Default viewport 375x812 (browser_resize). Tap = browser_click, swipe/scroll = browser_evaluate scrollBy or browser_drag, type = browser_type, keyboard = browser_press_key. Use browser_snapshot (a11y tree) before consequential actions and browser_take_screenshot (jpeg, css scale, descriptive filename) for visual states; then READ each screenshot image file and inspect it before indexing — reject blank/mid-transition captures and recapture.
- Copy accepted screenshots into `.top-gun/runs/run-20260719-073933/audit/evidence/` with `SS-###-<desc>.jpeg` names (SS-000 exists). Console via browser_console_messages, network via browser_network_requests — sanitize before quoting.
- Responsive checks: rerun key screens at 1280x800 and at least one narrow (320x700) and short (1280x600) case; browser zoom checks via browser_evaluate where feasible.
- Test like a real user under the mandate's real-world simulation list (fresh use, populated state, long inputs, invalid inputs, refresh mid-flow, back navigation, empty states, failure states, recovery) — within the authority boundary.

## IDs in play

- Fresh run: assign FEAT/EV/ISS/JRN/DEC/HYP/WP IDs per `register-contracts.md`. SS-000 (bootstrap onboarding screenshot) already exists — index it in the evidence ledger.

## Required outputs

- All under `D:\HomeOps\homeops-ai\.top-gun\runs\run-20260719-073933\`:
  - `audit/` registers + `audit/master-report.md` per register-contracts (run `init_audit.py` first — see Validation).
  - Five persona cards + five executed journey narratives inside the master report; exactly five canonical personas.
  - Numbered implementation menu + one Recommended bundle + the exact selection question, in section 21.
  - Agent delta: `agent-deltas/audit-lead-delta.md` (your phase summary: what you concluded, what you could not verify, disagreements, budget consumed).
  - Journal events (append_event.py) at minimum: audit start, each state transition S0→S4, each persona journey completion, each checkpoint, blockers, completion. Register every major artifact (record_artifact.py; --snapshot for the report and registers at completion).
- Validation commands (all with `--project "D:\HomeOps\homeops-ai"`):
  - `python "D:\The Only Skill\top-gun-claude\skills\convergent-360\scripts\init_audit.py"`
  - `python "D:\The Only Skill\top-gun-claude\skills\convergent-360\scripts\validate_audit.py" --stage audit` — must pass before you return; include verbatim output in your return.
  - `python "D:\The Only Skill\top-gun-claude\skills\mem\scripts\append_event.py" / record_artifact.py / validate_memory.py` for memory operations.

## Write surface and collision risks

- May write: everything under `.top-gun/runs/run-20260719-073933/` EXCEPT `phase-state.md` (orchestrator-owned) and `handoffs/` (frozen). Playwright's own scratch outputs are fine where its output dir puts them; copy what matters into evidence.
- Must not write: any repo file outside `.top-gun/`, any git state, `.claude/launch.json`.
- Concurrent writers: none — the orchestrator will not touch the run dir or the emulator while you run.

## Model, effort, and budget

- You: session model, high effort implicit in the task. Nested sub-agents: only per lean-implementation spawn criteria; if the Agent tool is unavailable in your environment, run the mandate's separated passes yourself and record the limitation (expected; do not treat as a blocker).
- Token budget: 500k output tokens soft for the whole audit including any nested agents. Checkpoints: after S2 (denominator built), after each persona journey, and at S4 synthesis start — append a checkpoint event with rough consumption vs plan. If a lens cannot be covered within budget, shrink depth per lens rather than skipping a lens entirely, and record the reduction in coverage figures honestly.

## Checkpoints, drift, and stop conditions

- Drift signals (self-check): writing outside the allowed surface, fabricating evidence (screenshot not inspected, claim without artifact), skipping the trace lane (UI observations without code pairing), persona count ≠ 5, coverage claimed without denominator.
- Stop immediately when: an action would create an external side effect; a secret would be exposed; the product requires credentials you don't have (record blocked coverage instead); both servers die and the documented restart fails twice (return with blocker).

## Return format

Plain-language audit verdict; artifact paths; execution vs verified coverage figures; top issues by severity; the menu location and the exact selection question; strengths worth preserving; disagreements/unknowns; verbatim validator output; budget consumed vs plan; blockers with exact unblock conditions. Your final message is a report to the orchestrator, not to the user.
