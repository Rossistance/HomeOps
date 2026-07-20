# Capability-Task Matching Guide

- Run: run-20260719-232201 (FamiliOS TestFlight mobile mission)
- Author: matching-lead · Date: 2026-07-20 (UTC)
- Selection (fixed, pre-recorded): ★ Recommended bundle #9 = WP-001..004 (DEC-09; S5 pre-selection). Other menu items receive phase-matrix treatment only.
- Context gate: `product-management:write-spec` INVOKED (loaded; PRD structure applied to task decomposition below) and `design:design-critique` INVOKED (loaded; critique framework grounds the event-editor/upload-UX/one-save design directions). No fallback playback needed — both skills are available in this session.
- Spec framing (per write-spec): **Problem** — the mobile app's cooperative loop and calendar silently lie to real testers (ISS-001/002/003/004/005/006/008). **Users** — the five audit personas, concretely testers Melissa/Jeannie-class family members (PII stays in-run). **Scope** — WP-001..004 slices only, local repo, local backend. **Acceptance** — per-issue criteria in `audit/issue-register.md`; every task row below carries its verification surface.
- Design framing (per design-critique): stay inside Well/SectionHeader/PickerField patterns and iOS native compact pickers; ≥44pt targets; persistent (dismissable) confirmation beats an 800 ms flash for save-confidence; one primary Save with inline remembered Google consent preserves the approval-gate trust strength (DEC-06); calm card language with "(task moved to you)" microcopy.

## Capability Map

Inventory of THIS session, evidence-backed, probed 2026-07-19/20.

| Capability | Classification | Evidence | Side-effect authority | Timestamp (UTC) |
|---|---|---|---|---|
| Read/Grep/Glob/Edit/Write core tools | use now | prompt-visible tool list | local read/write | 2026-07-20 |
| Bash (Git Bash) + PowerShell | use now | prompt-visible; probes executed this session | local exec | 2026-07-20 |
| Skill tool + `product-management:write-spec` | use now | invoked this session; skill body loaded | none (guidance) | 2026-07-20 |
| `design:design-critique` (design:* family) | use now | invoked this session; skill body loaded | none (guidance) | 2026-07-20 |
| `verify`, `code-review` skills | use if needed | session skill listing | local exec | 2026-07-20 |
| Agent tool — general-purpose, Explore, Plan, feature-dev:code-architect/explorer/reviewer | use now | agent-types listing in session | per-brief | 2026-07-20 |
| Model aliases `haiku`/`sonnet`/`opus`/`fable` | use now | Agent tool schema enum observed this session | — | 2026-07-20 |
| ToolSearch (deferred-tool probe) | use now | used this session (loaded Playwright MCP + WebFetch schemas) | none | 2026-07-20 |
| Local backend API :8787 | use now | netstat LISTENING (PID 65696) | local-write (LOCAL store only; production backend FORBIDDEN) | 2026-07-20 |
| Vite web :5173 | use now | netstat LISTENING (PID 62260) | read (render checks) | 2026-07-20 |
| Browser runtime :9223 | use now | netstat LISTENING (PID 50760) | local browser | 2026-07-20 |
| `playwright-web` runtime driver (PRIMARY) | use now | `npx playwright --version` → 1.61.1; `tests/topgun/playwright.config.ts` + `tests/topgun/runtime-drivers.json` present; npm scripts `topgun:web[,ios,all]`; matches facts-and-notes probe | local browser + local files | 2026-07-20 |
| Playwright MCP tools (`plugin_playwright`) | use if needed | ToolSearch schema fetch succeeded this session | local browser | 2026-07-20 |
| Claude Browser pane / chrome-devtools MCP | use if needed | prompt-visible / deferred list | local browser | 2026-07-20 |
| `appium-device-cloud` runtime driver | blocked | facts-and-notes probe (this run): `BROWSERSTACK_APP_ID/USERNAME/ACCESS_KEY` absent; LT/`APPIUM_REMOTE_URL` absent | none | 2026-07-19 |
| `appetize-sim` runtime driver | blocked | facts-and-notes probe (this run): `APPETIZE_API_TOKEN`/`APPETIZE_PUBLIC_KEY` absent; no simulator build produced | none | 2026-07-19 |
| node v20.20.2 + npm scripts (`test`, `typecheck`, `topgun:*`) | use now | `node --version`; `package.json` scripts read | local exec | 2026-07-20 |
| Server test suite `node --test server/test/*.test.mjs` | use now | script present; 42+ test files listed; 291/291 baseline (run-1, historical — revalidate at impl start) | local exec | 2026-07-20 |
| Mobile typecheck (`tsc` against `apps/mobile`) | use now (command to revalidate) | `apps/mobile/package.json` has no tsc script — use `npx tsc --noEmit` in `apps/mobile`; impl lead confirms exact invocation | local exec | 2026-07-20 |
| Python 3.14.3 + mission scripts (mem/matching) | use now | `python --version`; init_matching + append_event ran OK | run-workspace write | 2026-07-20 |
| Google Calendar MCP connector (`mcp__06c82849…`) | blocked (policy-forbidden) | deferred list; mission forbids external mutations; DEC-08 containment | EXTERNAL write — never engage | 2026-07-20 |
| Build/store MCP (`mcp__933a786f…` build_run/testflight_*) & Vercel MCP | irrelevant (policy-forbidden) | deferred list; non-goals: EAS/store/deploys | external — never engage | 2026-07-20 |
| ~60 pending-auth MCP servers (legal/finance/etc.) | blocked | system listing "require authentication"; none needed by any task | — | 2026-07-20 |
| WebFetch/WebSearch | use if needed | WebFetch schema loaded via ToolSearch | network read | 2026-07-20 |
| EAS builds / simulator artifacts | unavailable | non-goal + billable, user-authorized only | — | 2026-07-19 |

Drift note: facts-and-notes recorded node v25.8.2 at handoff; this session resolves v20.20.2 on PATH — harmless for the planned lanes, but the implementation lead should confirm the server under :8787 keeps running against whichever node launched it (PID 65696 predates this session).

## Phase Matrix

| Phase | Capabilities engaged | Explicitly not engaged (why) |
|---|---|---|
| MATCHING (this phase) | mem scripts, matcher scripts, write-spec + design-critique gates, Read/Grep, Bash probes, ToolSearch | Runtime drivers (no runtime work in matching); subagents (no delegation value — single-document composition) |
| IMPLEMENTATION — WP-001..004 slices | Edit/Write on selected surfaces; node test suite; mobile tsc; local backend :8787 (two-account flows); playwright-web for web-parity render checks; feature-dev/general-purpose subagents where the delegation test passes; mem scripts for deltas/journal | Google Calendar MCP + any `/api/calendar/push/*` live probing (DEC-08 hard constraint — contract/mock only); appium/appetize (blocked); EAS/build/store MCPs (non-goal); pending-auth connectors (not needed); production backend (forbidden) |
| VERIFICATION / INTEGRATION | Full server suite, mobile tsc, playwright-web smoke on affected web surfaces, two-account API regression repros, evidence registration via mem | Native runtime verification (blocked drivers — parity risks recorded instead, per runtime-drivers hard platform-fit constraint); live Google verification (policy) |
| CLOSEOUT | mem validate (--strict), snapshots, budget ledger reconciliation | — |
| DEFERRED (not this mission) — WP-005 task edit, WP-006 location, WP-007 accept parameters | none engaged — outside the fixed ★ selection (DEC-09) | all — next-release candidates |
| DEFERRED — WP-008 testIDs (ISS-013) | none — **phase-matrix note, not a task row**: the bundle's verification lanes are local-API contract tests, mobile tsc, and web-parity checks; none consume native locators while appium/appetize stay blocked, so testID instrumentation adds no value to THIS bundle and stays deferred with `audit/element-map.md` as its ready blueprint | native locator work (no consumer this mission) |

## Task Matrix

Write surfaces are separated server vs `apps/mobile` throughout; no task spans both (T-303 was split for exactly this reason). Class per budget-policy task-class table.

| Task | IDs | Primary route | Fallback route | Agent role | Model | Effort | Budget | Concurrency group | Checkpoints | Drift signals | Verification | Return contract |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T-101 Server: respond-handler transactional reassign (accept+taskId → task PATCH + notify + audit `reassigned:true`, ask+offer directions) [M] | ISS-001, FEAT-11/12, TF-008, WP-001 s1 | Inline lead edit of `server/index.mjs` + new `server/test/help-reassign.test.mjs`, red→green via `npm test` | general-purpose subagent (code+test only, no runtime) if lead context is saturated | inline (default) | sonnet | high | 40k soft | G-SRV (serialized) | 2 (post-red test; post-green) | any write outside server/index.mjs+tests; touching client files; test count dropping below 291 baseline | server suite green incl. new ask+offer cases; helper's `/tasks` contains task post-accept (API assert) | delta + test output + diff summary |
| T-102 Server: help-request create-dedupe (409/merge on same taskId+toActorId pending) [S] | ISS-009, WP-001 s2 | Inline lead edit `server/index.mjs` + focused test | same-pattern subagent | inline | sonnet | medium | 15k soft | G-SRV (serialized, after T-101) | 1 midpoint | new endpoint creation (forbidden — WP says no new endpoints) | dedupe test red→green; suite green | delta + test output |
| T-103 Mobile: accepted-card lifecycle + duplicate-render guard + "(task moved to you)" microcopy ((home)/index.tsx, grandparent.tsx, sitter.tsx, (settings)/tasks.tsx helping indicator) [M] | ISS-001/009 client side, WP-001 s3 | Inline lead edits per element-map locators; design per design-critique framing (≥44pt targets, calm card language) | feature-dev:code-architect blueprint first if the card-state model proves ambiguous | inline | sonnet | medium | 35k soft | G-MOB-B | 2 | edits outside the four named files; server edits; new deps | `npx tsc --noEmit` (apps/mobile) clean; code-trace vs element-map; native render = parity risk (blocked) | delta + tsc output + parity-risk note |
| T-105 VERIFY WP-001: two-account API regression rerun + web help-surface render check [S] | WP-001 s4, EV-NET-01 lineage | Bash scripted two-account repro against LOCAL :8787 (pattern of `audit/evidence/tf008-tf012-repro-transcript.txt`) + playwright-web render check on :5173 help surfaces | Playwright MCP interactive session if scripted check flakes | inline (lead-serialized runtime) | sonnet | medium | 12k soft | G-VER (serialized) | 1 | any request to production backend; any Google-route call | transcript saved under run evidence; render screenshot artifact | regression transcript + screenshot registered via mem |
| T-201 Mobile: upload persistent confirmation banner "Saved to <category> · View" (upload-sheet.tsx, (library)/index.tsx) [S] | ISS-002, FEAT-16/17, TF-012, WP-002 s1 | Inline lead edit; design-critique framing: persistent dismissable banner replaces 800ms flash, names REAL rendered category | subagent (code-only) | inline | sonnet | medium | 20k soft | G-MOB-B | 1 | server edits (WP prefers client-only); category name hardcoding | tsc clean; banner logic unit-testable where cheap; API repro rerun in T-601 | delta + tsc output |
| T-202 Mobile: honest categorization — default-space explicit filing, `/id/` word-boundary regex fix, drop/rename time-based "Processing" badge [S] | ISS-002, WP-002 s2+s3 | Inline lead edit `(library)/index.tsx` (spaceOf/badgeFor) + unit cases proving `video.mp4`/`Friday.pdf` no longer match Medical & IDs | subagent (code-only) | inline | sonnet | medium | 18k soft | G-MOB-B (after T-201, same file) | 1 | regex change without unit cases (fabricated-fix tell) | unit cases pass; Medical & IDs-tagged upload appears instantly (API-backed check) | delta + unit output |
| T-301 Mobile: Notes field on event-form (form state + save body) [S] | ISS-006, WP-003 s1 — unblocks T-401's full value | Inline lead edit `event-form.tsx` (multiline within Well/SectionHeader pattern) | subagent (code-only) | inline | sonnet | medium | 12k soft | G-MOB-A (serialized: event-form.tsx single-writer) | 1 | schema invention (server already stores notes — EV-NET-02) | tsc clean; API probe shows notes persisted round-trip | delta + probe output |
| T-302 Mobile: end-date support — endDay picker when hasEnd, end>start cross-day validation, multi-day render (calendar.tsx + grandparent/kid/sitter/today renderers) [M] | ISS-004, WP-003 s2 | Inline lead edit; replace `stamp(day,end)` per WP spec | feature-dev:code-architect blueprint if renderer coupling proves worse than audited | inline | sonnet | high | 45k soft | G-MOB-A after T-301 | 2 | renderer edits beyond the named screens; server edits (belongs to T-303) | tsc clean; EV-NET-02 probes rerun; web render check (shared model semantics) | delta + probe + tsc output |
| T-303 Server: `allDay` concept — events passthrough (`server/index.mjs`) + Google push `date`-form (`server/calendar.mjs`) + server test [S] | ISS-005 server side, WP-003 s3 | Inline lead edit + unit test with MOCKED fetch (no live Google — DEC-08) | subagent (code+test only) | inline | sonnet | high | 20k soft | G-SRV (serialized, after T-102) | 1 | ANY live `/api/calendar/push/*` invocation against the resident household (hard stop, DEC-08); date/dateTime mixing untested | server suite green; payload fixture asserts `date` vs `dateTime` | delta + test output |
| T-304 Mobile: All-day toggle suppressing time pickers + all-day/multi-day display in renderers [M] | ISS-005 client side, WP-003 s3 | Inline lead edit event-form.tsx + renderers (iOS native compact pickers preserved) | subagent (code-only) | inline | sonnet | medium | 30k soft | G-MOB-A after T-302 | 2 | fake-time fallback reintroduced (the audited lie) | tsc clean; form-logic code trace; native visual = parity risk | delta + tsc + parity-risk note |
| T-305 VERIFY WP-003: EV-NET-02 probe rerun (multi-day/all-day/notes round-trip) + web render check [S] | WP-003 acceptance, EV-NET-02 lineage | Bash API probes vs :8787 (pattern of `audit/evidence/event-model-role-probes.txt`) + playwright-web render on :5173 calendar | Playwright MCP interactive | inline (lead-serialized runtime) | sonnet | medium | 12k soft | G-VER | 1 | probing production; live push | probe transcript + screenshot registered | transcript + screenshot via mem |
| T-401 Server: Google description composer (pushEventToGoogle + editLinkedGoogleEvent) + lossless pull-merge delimiter + unit tests (mocked fetch) [M] | ISS-003, FEAT-08/09, TF-003/004, WP-004 s1, DEC-04 | Inline lead edit `server/calendar.mjs` + fixture tests: description carries notes + "Bring:"; pull does NOT re-import composed Bring block | subagent (code+test only) | sonnet — but see rationale: sync semantics reviewed at high effort | sonnet | high | 30k soft | G-SRV (serialized, after T-303; depends on T-301 for full value) | 2 | ANY live Google call (hard stop, DEC-08 — contract/mock level ONLY); delimiter convention undocumented | payload fixtures green; pull-merge round-trip test green; suite green | delta + fixture output |
| T-402 Mobile: one-save action row — primary "Save changes" + inline remembered Google consent (DEC-06) [S] | ISS-008, WP-004 s2 | Inline lead edit `event-form.tsx` action row per design-critique framing (approval gate preserved, no silent external write) | subagent (code-only) | inline | sonnet | medium | 18k soft | G-MOB-A after T-304 | 1 | silent auto-push introduced (violates PI-07/DEC-06) | tsc clean; approval-flow test (mock) green; consent copy reviewed | delta + tsc + flow-test output |
| T-501 HYGIENE: purge ~7 terminal `TG-…` help-request residue records from `server/data/help-requests.json` (audit repro leftovers referencing deleted members) [XS] | audit-lead-delta §cleanup; run hygiene | Bash/python edit of the LOCAL data file with server-safe procedure (stop-write window or restart), then `GET /help-requests` shows no TG- records | manual jq-style filter via node one-liner | inline | haiku-class (or inline lead) | low | 6k soft | G-HYG (serialized with G-SRV restarts) | return only | touching production data (n/a — local only); deleting non-TG records | `GET /help-requests` on :8787 clean; server suite still green | before/after record count + transcript |
| T-601 FINAL VERIFY + integration: full server suite (291+new), mobile tsc, playwright-web smoke on affected web surfaces (`npm run topgun:web` scoped), both API regression repros rerun, evidence bundle + named native-blocked parity risks registered [M] | all bundle IDs; reserve-funded | Lead-serialized runtime verification (run-1 lesson: ONE browser resource — never parallel runtime agents) + mem registration | opus/fable adversarial review pass of P1 claims if any evidence is contested | inline lead; optional frontier reviewer | fable (session top-tier) | xhigh | 30k soft | G-VER (strictly serialized, last) | per slice | verification skipped "to save tokens" (forbidden); pass claims without artifacts | all suites green; artifacts registered; parity-risk register complete | final evidence manifest + budget ledger actuals |

### Route comparisons (scored per matching-policy rubric; rejected route + reason)

- **T-101/102/303/401 (server slices)**: inline-lead vs code-only subagent. Inline wins on collision risk (G-SRV is one write surface — `server/index.mjs`/`calendar.mjs` single-writer) and context already loaded (audit evidence in-lead); subagent is the fallback purely for context-budget relief. Rejected: parallel per-slice subagents — shared-file contention, weighted score loses on collision (2×5→2×1) despite speed.
- **T-103/201/202/301/302/304/402 (mobile slices)**: inline vs feature-dev subagents. Mobile files are disjoint from server; G-MOB-A (event-form.tsx chain) must serialize internally, G-MOB-B (help cards / library) may run parallel to G-SRV as code+typecheck-only work (run-1 lesson: parallel agents OK when they never touch the browser/runtime). Rejected: single monolithic WP-scale agent — violates bounded-task decomposition and the two-crash chunked-write lesson.
- **T-105/305/601 (verification)**: scripted Bash+playwright-web vs interactive Playwright MCP. Scripted wins on evidence quality (repeatable transcripts, registrable artifacts) and determinism; MCP interactive is the fallback for flake diagnosis. Rejected: chrome-devtools MCP as primary — adds tooling surface without adding truth for these checks.
- **Google-fidelity verification (T-303/T-401)**: mocked-fetch contract tests vs live push probe. Live probe VETOED (safety veto — DEC-08: one contained 401 incident already; mission forbids external mutations; stale resident Google account makes any push route live). No score can override the veto.
- **Native rendering claims (T-103/304)**: code-trace + parity-risk label vs expo-web pseudo-native evidence. DEC-07 already rejected expo-web: it produces WEB evidence that must never be claimed as native (runtime-drivers platform-fit hard constraint) and burns budget.
- **T-501 (hygiene)**: direct data-file edit vs building a delete-API. Data-file edit wins (fewer moving parts, zero product-surface change); a delete endpoint is out-of-scope feature work. Fallback is a node one-liner filter.

## Model and Effort Rationale

Per the canonical tables in `top-gun:lean-implementation/references/budget-policy.md`; aliases restricted to those observed in this session's Agent tool schema (`haiku`, `sonnet`, `opus`, `fable`).

- **haiku-class / low**: T-501 only — XS mechanical data-file filter, zero design judgment ("Small/fast: XS/S mechanical work"). Inline-lead execution is equally acceptable; do not spawn an agent just to use the cheap alias.
- **sonnet / medium**: T-102, T-103, T-105, T-201, T-202, T-301, T-304, T-305, T-402 — S/M routine implementation and standard tests ("Mid: default implementation… S/M slices, tests"). No cross-layer ambiguity once the audit's code traces are in hand.
- **sonnet / high**: T-101 (transactional reassignment on the shared server path — the P1 trust repair; competing failure modes around notify/audit ordering), T-302 (renderer changes across five screens — cross-layer within the client), T-303 + T-401 (sync semantics: date vs dateTime, lossless pull-merge — "migration design"-grade care). Effort raised, model held at mid: the audit already resolved the root causes (EV-NET-01/02, EV-CODE-04); these are implementations of decided designs (DEC-01/03/04), not arbitration.
- **fable (session top-tier) / xhigh**: T-601 — "final verification of P0 scope… adversarial verification of P0/P1 claims" is exactly the frontier-class row. Effort xhigh pairs with explicit evidence requirements (artifacts, transcripts), not depth for its own sake.
- **inherit**: the implementation lead runs inline tasks at its own dispatched class; the table above governs only spawned subagents.

Respawn protocol (budget-policy) applies unchanged: model/effort switches require stop → correction event → brief revision → respawn.

## Planned Budget Ledger

All budgets SOFT — the host enforces no hard token limit for these lanes (claiming otherwise would be a fabricated control). Supervisor enforces at checkpoints via the 60/150% ratio rules.

| Task | Budget (output tokens) | Soft/Hard | Rationale |
|---|---|---|---|
| T-101 | 40k | soft | M-class, under 60k cap; P1 core repair with red/green tests |
| T-102 | 15k | soft | S-class dedupe + focused test |
| T-103 | 35k | soft | M-class, four client files |
| T-105 | 12k | soft | S-class scripted verification |
| T-201 | 20k | soft | S-class UI state change |
| T-202 | 18k | soft | S-class logic + unit cases |
| T-301 | 12k | soft | S-class single-form field |
| T-302 | 45k | soft | M-class, five renderers + validation |
| T-303 | 20k | soft | S-class server passthrough + fixture test |
| T-304 | 30k | soft | M-class toggle + renderers |
| T-305 | 12k | soft | S-class scripted verification |
| T-401 | 30k | soft | M-class composer + round-trip fixtures |
| T-402 | 18k | soft | S-class action-row merge |
| T-501 | 6k | soft | XS hygiene |
| T-601 | 30k | soft | M-class integration verification (reserve-funded) |

- Per-WP totals: WP-001 = 102k (T-101/102/103/105) · WP-002 = 38k (T-201/202) · WP-003 = 119k (T-301/302/303/304/305) · WP-004 = 48k (T-401/402) · Hygiene = 6k · Cross-WP final verification = 30k.
- Mission total planned: **343k output tokens (soft)** — recommended implementation-phase ceiling **≤360k** (≈5% contingency).
- Reserve: **54k (15.7%)** = T-105 + T-305 + T-601, verification/integration only — never spent on feature work (reserve rule satisfied).

## Concurrency and Write-Ownership Plan

- **G-SRV** (T-101 → T-102 → T-303 → T-401): strictly serialized — `server/index.mjs`, `server/calendar.mjs`, `server/test/*` are one write surface shared with the running :8787 process and the web app. Order honors dependencies (T-401 after T-303; T-401's full value after T-301).
- **G-MOB-A** (T-301 → T-302 → T-304 → T-402): serialized — all touch `event-form.tsx`; single-writer chain in WP order.
- **G-MOB-B** (T-103; T-201 → T-202): T-103 and the T-201/202 pair touch disjoint files and may run parallel to each other AND to G-SRV as code+typecheck-only work. Run-1 lesson applied: parallel agents never touch the browser/runtime.
- **G-VER** (T-105, T-305, T-601): lead-serialized — exactly one browser/runtime consumer at a time (run-1 emulator-serialization lesson); T-601 runs last, after all feature groups close.
- **G-HYG** (T-501): serialized against G-SRV (server data file; coordinate with any server restart window).
- Canonical registers (`facts-and-notes.md`, `phase-state.md`, ledgers, journal via script only) remain single-writer by the orchestrator/mem contract; implementation agents write deltas under `agent-deltas/` and this run's `implementation/` only.
- Chunked-write discipline (two mid-response API crashes this mission): every long document is composed across multiple small tool calls, written to disk as it goes.

## Authority Constraints

No route, primary or fallback, may without NEW explicit user authorization:

1. Call `/api/calendar/push/*` (or any Google-touching route) against the resident local household, or engage the Google Calendar MCP — a live call already fired once and was contained (DEC-08). Google fidelity is verified at the payload-builder/contract level with mocked fetch ONLY.
2. Mutate the production backend (`https://homeops-ai.onrender.com`) — all runtime work targets LOCAL :8787.
3. Run EAS builds, store/TestFlight actions, or the build/store MCP tools; create cloud-driver accounts or upload app artifacts.
4. Trigger OAuth/auth flows on any pending-auth MCP server, send external messages, or perform any external write.
5. Touch secret files (`.env`, vault, `.p8`/twilio files) or externalize tester PII (real names stay inside the run workspace).
6. Write outside the selected bundle's surfaces (`server/index.mjs`, `server/calendar.mjs`, `server/test/*`, `server/data/help-requests.json` for T-501 only, the named `apps/mobile` files) plus run-workspace areas; run-1 uncommitted worktree changes are preserved untouched.
7. Git mutations (commit/branch/reset) and deploys remain out of scope.

## Unavailable Capability Effects

| Capability | State | Effect on plan | Workaround | Unblock condition |
|---|---|---|---|---|
| appium-device-cloud | blocked | No real-device native verification: T-103/T-304 UI claims ship code-traced only | Parity-risk labels + field-tester visual check on next authorized TestFlight build; element-map ready for the day drivers unblock | User supplies BROWSERSTACK_*/LT_*/APPIUM_REMOTE_URL creds + uploaded app artifact (per tests/topgun/.env.topgun, docs/SETUP-CLOUD.md) |
| appetize-sim | blocked | No simulator screenshot sweeps for the new editor states | Same parity-risk route; web render checks cover shared semantics only (never claimed as native) | User supplies APPETIZE_API_TOKEN + APPETIZE_PUBLIC_KEY + a simulator build (EAS ios.simulator profile — billable, user-authorized) |
| Live Google push verification | policy-forbidden (DEC-08) | needsApproval runtime path and real Google round-trip stay unobserved; description fidelity proven at fixture level | Mocked-fetch contract tests at the single choke point (DEC-04); delimiter convention documented in code | Explicit user authorization of a sandboxed Google test account |
| Google Calendar MCP connector | blocked/forbidden | None — no task needs it | — | Not sought; would still be out of mission authority |
| Pending-auth MCP servers (~60) | blocked | None — no bundle task routes through any of them | — | User authorizes via connector settings (not requested) |
| EAS/store tooling | unavailable (non-goal) | Testers cannot receive this bundle within the run | Next TestFlight build is a user-owned follow-up | User-initiated, billable |
| Native `tsc` script in apps/mobile | minor gap | Typecheck command not pre-baked | `npx tsc --noEmit` in `apps/mobile` (impl lead confirms on first use) | — |

## Reassessment Triggers

Standard set (matching-policy): capability appears/disappears/changes auth state; host model-alias or effort options change; any task overruns 150% of budget at a checkpoint; scope/selection changes; a route fails twice for the same cause; phase transition into implementation (**mandatory revalidation**: :8787/:5173/:9223 still up, server suite baseline green — 291/291 is run-1 historical, playwright version, node/PATH state, worktree still at HEAD ffcfa33 with run-1 changes intact).

Mission-specific:
- Any live Google contact by ANY route → immediate stop, incident event, orchestrator escalation (do not retry, per DEC-08 pattern).
- BROWSERSTACK_*/APPETIZE_* credentials or a simulator build appear → re-run driver probes and re-match T-103/T-304 verification rows (native lanes become routable; WP-008 testID work re-enters consideration).
- The resident local household's data shifts under test (e.g. another writer on :8787) → re-verify repro baselines before trusting regression diffs.
- calendarAutoSync flips on in the household → T-402's consent UX premise changes (DEC-06 notes the UI collapses naturally).
- Server test count drops below baseline at any checkpoint → halt G-SRV, root-cause before proceeding.
