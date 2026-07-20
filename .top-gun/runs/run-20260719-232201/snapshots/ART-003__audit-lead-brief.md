# Dispatch Brief — Audit Lead (TestFlight Mobile Mission)

- Run: run-20260719-232201
- State: AUDIT_RUNNING (at dispatch)
- Date: 2026-07-19 (UTC)

## Objective

Execute the Convergent 360 audit (S0–S5-prep) of the FamiliOS **native mobile app** (`apps/mobile`, ai.familios.app), seeded by real TestFlight field evidence: confirm or refute every candidate in HANDOFF.md against current source and safe runtime repro, converge into the validated master report + brownfield PRD + work packages + numbered menu with one Recommended bundle. The user has pre-selected the recommended bundle — your menu still gets built with full rigor because it defines what that bundle IS.

## Scope and non-goals

- In scope: `apps/mobile/**` and the shared server paths its `lib/api.ts` calls; the 11 candidate issues TF-ISS-01..11 plus anything real you find on the same surfaces; mobile-vs-web parity where the feedback touches shared concepts (events, help/tasks, uploads, assistant).
- Out of scope: web-app (`src/`) rework (run-1 just shipped there — its uncommitted changes are protected), EAS builds, store/TestFlight actions, `mobile-version/`.
- Authority: read-only for product source until the selection gate (this brief covers audit only). LOCAL backend :8787 only — never the production Render backend (live family data). No git mutations, no external side effects, no SMS/OAuth, no EAS/cloud-driver provisioning. Secret files per facts handoff. Real-tester PII stays inside the run workspace.

## Required skills (read the files; follow as operating policy)

1. `D:\The Only Skill\top-gun-claude\skills\convergent-360\SKILL.md` + `references\register-contracts.md`; map `references\mandate.md` by headings and read the sections governing S0–S5 (you may skim the implementation states).
2. `D:\The Only Skill\top-gun-claude\skills\top-gun-ios\SKILL.md` — the iOS strike-arm doctrine (preflight gate, locator policy, evidence contract). Its references as needed.
3. `D:\The Only Skill\top-gun-claude\skills\capability-task-matcher\references\runtime-drivers.md` — routing precedence; platform fit is a hard constraint.
4. `D:\The Only Skill\top-gun-claude\skills\mem\SKILL.md` — memory protocol.
5. `D:\The Only Skill\top-gun-claude\agents\audit-lead.md` — your role card.
6. `apps/mobile/CLAUDE.md` — repository instructions for the surface you are auditing.

## Required inputs

- `facts-and-notes.md` (this run) — driver classifications, boundaries, run-1 context.
- `testflight-feedback-handoff/HANDOFF.md` (ART-001) — the seed. Treat [OBSERVED] as field evidence, [INFERRED/CANDIDATE] as hypotheses. Do NOT inherit its severities or WP groupings without confirmation.
- 13 screenshots already at `audit/evidence/TF-SS-01..13.jpg`.
- Run-1 registers under `runs/run-20260719-073933/audit/` — historical context (architecture map, personas, principles); label anything reused as historical until revalidated.
- Local stack: backend :8787, Vite :5173 (restart commands in run-1 briefs if needed; journal restarts).

## First actions (ordered)

1. Verify the 13 staged screenshots: open and visually inspect each against HANDOFF §4's transcriptions; index all into the evidence ledger (what each proves / does not prove). If any file is corrupt, re-download from the §3 URLs (they expire ~2026-07-24) — otherwise no re-download needed.
2. Run the top-gun-ios preflight gate (drivers already probed — playwright-web use-now, appium/appetize blocked with recorded unblock conditions; derive the element map from source `testID`/`accessibilityLabel` greps as the doctrine says, for future harness value).
3. Then S0–S4 with the seed as your hypothesis queue.

## Investigation requirements

- **Code-first confirmation**: every TF-ISS candidate confirmed/refuted against current `apps/mobile` source (the testers ran builds 13/19; check git history where behavior may have changed). An unconfirmed candidate never becomes an issue — it stays a labeled hypothesis.
- **TF-008 (reassignment/duplicate cards)**: two-account repro against the LOCAL backend (create Ross-like + Beannie-like members; drive the offer→accept→reassign flow via server API and/or the web surface where shared); separately trace the mobile client path (`(home)/help.tsx`, `index.tsx`, `lib/api.ts`) for refetch/optimistic-state/duplication. Answer HANDOFF's discriminating question: server-side ownership vs client reflection.
- **TF-012 (medical-ID upload)**: two-attempt repro against the local file-store endpoint incl. a session round-trip; trace the mobile upload path (`(library)/index.tsx`, `upload-sheet.tsx`, `lib/api.ts`) for missing success/failure confirmation vs actual persistence loss.
- **Event model (TF-001/006/007)**: trace the mobile event model + editor + server event schema for end-date/all-day/notes support (including whether representations exist unexposed); Google-push payload builder trace for TF-003 (contract-level only — no live Google calls).
- **Runtime evidence routing**: playwright-web + local API + web comparison for shared logic; native-only rendering/behavior claims stay code-traced and labeled as native-verification-blocked parity risks. Never claim native verification from web evidence. If a quick `npx expo` local attempt (dev server / web target) is truthfully useful, you may try it — no accounts, no builds, record honestly if it doesn't run.
- **Personas**: exactly five canonical personas per the mandate — ground them in the real testers (Melissa the operator-parent, Jeannie the helper-grandmother figure) plus roles the app ships (child view, owner "Ross"-figure, sitter), with synthetic-research disclosure; journeys execute on the truthful lanes available and honestly mark native-blocked steps.

## Required outputs

- Everything under `runs/run-20260719-232201/`: init_audit registers, master report (25 sections, five personas, menu + ★ Recommended bundle + the exact selection question), agent delta at `agent-deltas/audit-lead-delta.md`, journal events + artifact registrations per memory protocol.
- Validation (verbatim in return): `python "D:\The Only Skill\top-gun-claude\skills\convergent-360\scripts\validate_audit.py" --project "D:\FamiliOS\FamiliOS" --stage audit` must pass; `validate_memory.py` clean.

## Write surface and collision risks

- May write: this run's dir (except `phase-state.md`, `handoffs/`), journal via scripts. Must not write: any product source, `runs/run-20260719-073933/**` (closed run), user drift files. Local backend state created via normal two-account testing is allowed (it's the resident claimed household's server — create clearly-named disposable test members, and note them for cleanup in your delta).
- No concurrent writers; the orchestrator stays off the run dir and emulator while you work.

## Model, effort, and budget

- Budget: 350k output tokens soft (seeded audit — the discovery phase is pre-paid by HANDOFF). Checkpoints: after screenshot indexing + code-confirmation sweep; after the TF-008/TF-012 repro work; at S4 synthesis. Nested delegation per lean-implementation criteria only; separated passes are fine.

## Stop conditions

Stop immediately when: an action would touch the production backend or any external service; an EAS/build/store action would be needed (record blocked instead); a secret would be exposed.

## Return format

Audit verdict; per-candidate confirmation table (confirmed/refuted/still-hypothesis with evidence IDs); TF-008 and TF-012 root-cause answers; coverage figures (execution vs verified, with native-blocked items named); menu location + recommended bundle contents; strengths worth preserving; validator output verbatim; budget consumed vs plan; blockers with exact unblock conditions. Final message is a report to the orchestrator, not the user.
