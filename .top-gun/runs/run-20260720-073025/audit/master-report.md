# Universal Convergent 360-Degree Product Experience and Full-Stack Truth Audit — Brownfield PRD and Implementation Mandate

Run run-20260720-073025 · FamiliOS (Ask Famili chat→execution chain) · HEAD c0c4596 · 2026-07-20

## 1. Executive verdict and highest-value decision

**Verdict: the chat→execution chain is real at the bottom and dishonest at the seams.** The engine, approval gates, and delivery layers are genuinely fail-closed — but four seams between them convert "nothing was delivered" into user-visible success, which is exactly what the user reported ("says it's a successful run, but never actually runs or sends the email… every single type of task"). All four were reproduced at HEAD with runtime evidence, and all four exist byte-identically in the user's production code lineage (ffcfa33):

1. **Build seam (P0, ISS-001):** a chat-built "daily 7 AM email agent" creates a skill, an agent, and a trigger — but the trigger's target structurally loses the skill and any goal (normalizeBuild strips them; materializeBuild falls back to agent-only). Every scheduled fire therefore runs a read-only "status pass" — in our repro, one garbage web search, or literally **zero steps** — and reports `completed`. The built briefing recipe is never executed. (EV-011, EV-015)
2. **Vacuous-step seam (P0, ISS-002):** the assistant is *instructed* to encode "notify/send" steps it can't match to a tool as `toolId:null` reasoning steps, and the engine marks every reasoning step `succeeded` — even with no AI provider. A do-now plan "sent" an email as a no-op step, completed 3/3, and the chat said "Done — finished (3/3 steps)" and "That worked. Want me to save this as a helper?" (EV-012)
3. **Silence seam (P1, ISS-004):** when a plan reaches a *real* send tool, it parks honestly (`waiting_for_approval` / `waiting_for_connector`) — but parked runs never report to the chat, approval expiry (30-min TTL) skips the run-finished hooks entirely, and both clients stop watching within minutes. The user's last message stays "On it — sending the briefing…" forever. (EV-013, EV-007)
4. **Schedule seam (P1, ISS-003):** "daily at 7 AM" is unexpressible — chat-built recurring triggers can only mean "every 24 h from the moment of creation." (EV-011: nextRunAt = creation + 24.00 h)

Plus a delivery-architecture gap (ISS-006): there is **no engine-reachable path to real unattended email** — `gmail.send` needs the actor's own Google account and a fresh human approval within 30 minutes of each 7 AM fire, the honest registry sender (`deliverNotification`) is HTTP-only (not a run tool), and `homeops.send_notification_draft` only drafts.

**Highest-value decision:** implement the Recommended bundle (WP-001+002+003+004) — wire the built skill into its trigger, anchor "7 AM" to 07:00, make runs and summaries truthful, and make parked/expired runs report back. That makes every chat-built agent actually run the right thing at the right time and *never lie about the outcome*. Unattended real delivery (WP-005) is a deliberate consent decision offered separately.

## 2. Scope, environments, authorization, evidence limits, and production/source parity

- **Scope:** the full chat task chain at HEAD on the local stack — POST /api/assistant(+stream), planner, buildFromChat entity creation, trigger scheduling, orchestrator/engine execution, notify/email gates, run-result→conversation honesty, both mobile run paths, web equivalents. Audit only; no product source changed. Out of scope: fixes, native iOS visual verification (lane closed by user decision DEC-10, prior run), store/EAS, Render deploy repair, production behavioral probes.
- **Environments:** local dev stack booted clean at HEAD (node 25.8.2, health OK — EV-020); runtime evidence produced on isolated harness servers (real server binary, temp data dirs, scripted fake Ollama provider) so no real family data was touched (DEC-A01). Production: one authorized GET /api/health (up, v1.2.0, node 24.18.0 — EV-019); nothing else.
- **Evidence limits:** no live Google calls, no external sends, no screenshots (see §25); the scripted provider means real-cloud-model output text is not covered (HYP-005) — but the P0 build seam is model-independent (the spec structurally cannot carry a target). Approval-approve→execute and TTL-expiry end states are code-traced, not clock-waited (HYP-006/007).
- **Production/source parity:** `git diff ffcfa33..HEAD` touches only unrelated routes in server/index.mjs (profiles privacy, event allDay, help-requests). **Every implicated file is identical between the user's prod lineage and HEAD** (EV-018). Separately, Render autodeploy is broken and prod serves the ffcfa33-lineage bundle (ART-002, historical, user-side) — real, but *not* the cause of the false success.

## 3. Capability inventory and agent topology

- Used now: node 25.8.2 toolchain; scripts/dev.mjs stack; server test harness + fakeProvider pattern (the decisive instrument); git/GitHub read; mem/convergent-360 scripts.
- Used if needed (not needed): Playwright/Chrome/browser pane (skipped per DEC-A03), Gmail MCP observation inbox (no live-send lane authorized).
- Unavailable/blocked: Render API (no key), native simulator lane (closed by DEC-10, user decision), live Google mutations (policy), production probes beyond health (policy), interactive OAuth MCPs (non-interactive session).
- Topology: one physical audit lead held all logical roles (product-intent, backend/data, workflow-alignment, persona simulation, synthesis) in **clearly separated passes** — code-trace pass, runtime repro pass (repro-false-success.mjs), persona role-variant pass (persona-passes.mjs), synthesis pass. No parallel independent review occurred and none is claimed (mandate rule 3 disclosure).

## 4. Application understanding

- **Purpose:** FamiliOS is a family operating system; Ask Famili chat is the one front door that answers, executes one-off plans immediately, and builds durable helpers (skill+agent+automation) from conversation (PI-01).
- **Users:** Owner/Adult Admin parents, gated Child View kids, Guest/Helper caregivers (server-authoritative roles — EV-016/027).
- **Core jobs:** ask about the household; do a thing now; automate a recurring thing; keep external actions family-safe (approvals, registries, kill switch).
- **Architecture & authority:** single Node backend, per-tenant SQLite; canonical durable run engine (orchestrator→engine) with server-authoritative approval, idempotency, recovery; thin mobile/web observers. Full map: `audit/architecture-authority-map.md`.
- **Primary workflow (this mission):** chat → plan/build → trigger → run → steps → chat summary.
- **Strengths worth preserving:** the durable engine (leases, idempotency, at-most-once recovery); consume-once input-hash-bound approvals; the fail-closed notify registry (verified+opt-in+per-agent allowlist — EV-017); server-owned conversations; per-household tick fairness; honest child AI gating; the self-repair scaffolding; server-durable mobile dispatch at HEAD (EV-021 — a prior 30-day goal, done).
- **Unresolved assumptions:** household timezone source for scheduling (WP-002 decision); whether a standing per-agent send allowlist is acceptable consent for unattended email (WP-005 decision).

## 5. Observed product intent, inferred vision, success measures, and contradictions

Full register: `audit/product-intent-register.md`. Vision (strongly inferred): "a family's trustworthy operations agent — real actions, never simulated, always consented." Success measure for this mission (user-stated): a chat-created scheduled agent actually fires and actually attempts real delivery, or honestly reports why it can't — no false success anywhere.
Confirmed contradictions: PI-07 (success language without effect — the mission bug), PI-08 (7 AM unexpressible), PI-09 (built skill never wired), PI-10 (Draft/live/fires-anyway incoherence). The "no simulation" doctrine (PI-02) holds at the tool layer and is broken at the seams — the product simulates *success*, not actions.

## 6. App Functionality Inventory and coverage

Full inventory + trace matrix: `audit/functionality-inventory.md` (22 in-scope FEAT rows over the chain).

```
Execution coverage: 13/22 = 59%
Verified coverage:  10/22 = 45%
Persona coverage:   13/22 = 59%
```

Every non-executed row names its gap and next check. The only hard blockers: native client lane (closed by user decision) and live-send prohibition (policy). Nothing blocked is counted verified.

## 7. Five canonical persona cards

> Synthetic-research disclosure: these five personas are research instruments inferred from the seeded roster, roles, contact registry, and the user's own report — not interviewed customers. Their reactions are simulated hypotheses requiring real-user validation.

### Persona 1 — Alex Harper, the Owner-operator
Owner parent (seed m-alex), high technical fluency, runs the household's automation. Goal: "create an agent that emails me a 7 AM briefing" and trust it happened. Urgency: daily cadence; data: full household. Device: iPhone (TestFlight). Permissions: everything. Trust requirement: absolute — a false "Done" is worse than an error. Mistakes: assumes "Done — I set up" means "it will work." Evidence: seed roster, ART-002 user report. Speculative: temperament.

### Persona 2 — Morgan Harper, the pragmatic co-admin
Adult Admin parent (m-morgan), medium fluency, builds chore/reminder helpers in plain English and doesn't inspect internals. Goal: weekly chores reminder that just works. Data: verified email contact method. Frustration trigger: setting something up twice because the first silently did nothing. Evidence: seed roster + JRN-2. Speculative: division of labor.

### Persona 3 — Lily Harper, the gated child
Child View (m-lily, age 9 per seed relationship), low fluency, AI chat off by default. Goal: ask the assistant anything. Expected outcome: a clear, kind refusal that names the path (a parent enables it). Evidence: seed roster, EV-016. Speculative: motivations.

### Persona 4 — Sam Rivera, the occasional helper
Guest/Helper babysitter (m-sam), low domain fluency, unverified contact method (registry: Pending). Goal: ask chat to notify the family about something. Risk: being led down flows they cannot complete. Evidence: seed roster, JRN-4 (build card offered, then 403). Speculative: schedule.

### Persona 5 — Elaine Brooks, the recipient who never sees the app
Grandparent/caregiving contact (m-elaine), interacts through DELIVERED messages (text/email), not the UI. Goal: actually receive what the family's agents claim to have sent. The false-success bug makes her the invisible victim: nothing ever arrives and nobody is told. Evidence: seed contact registry (verified, opted-in), EV-010/017. Speculative: everything about her day.

## 8. Five end-to-end journey narratives and step tables

Journeys executed as separated API-level persona passes on the harness (DEC-A03); raw outputs: `audit/evidence/repro-output.json`, `audit/evidence/persona-output.json`.

**JRN-1 (Alex): the daily 7 AM briefing agent — the user's exact request.**
| # | Intention | Action | Expected | Actual | Status |
|---|---|---|---|---|---|
| 1 | Ask for the agent | POST /api/assistant with the verbatim request | build proposal | kind=build, "I'll set up a Morning Briefing helper…" | pass |
| 2 | Approve the build | POST /api/assistant/build | skill+agent+automation wired together | created, chat: "Done — I set up skill…helper…automation…"; agent tools preselected (web.search, gmail.send) | pass (surface) |
| 3 | Inspect the automation | GET /api/triggers | target runs the skill at 07:00 | target `{agentId, skillId:null, goal:null}`; nextRunAt = creation+24.00h | **fail** (ISS-001, ISS-003) |
| 4 | It fires | POST /api/triggers/:id/fire (as tick would) | briefing composed, email attempted | 1-step read-only web.search with garbage query; run `completed`; trigger lastStatus "queued" | **fail** (ISS-001, ISS-009, ISS-010) |
| 5 | Do-now variant | "send me the briefing right now" | real send or honest block | run completed 3/3 with a toolId:null "Send email" step; chat: "Done — finished (3/3)" + "That worked. Want me to save…" | **fail** (ISS-002) |
| 6 | Real-tool variant | plan with gmail.send, no Google connected | honest needs-setup in chat | run parks waiting_for_approval; chat stays "On it —…" forever | **fail** (ISS-004) |
| 7 | Policy variant | agent allowed only web.search, goal includes email | visible refusal | send step silently dropped; run `completed` | **fail** (ISS-005) |

**JRN-2 (Morgan): weekly chores helper.** Build accepted; agent's only capability = the draft-only notification tool; fired run had **zero steps** and reported `completed` (EV-015). fail (ISS-001 starkest form).
**JRN-3 (Lily): child asks chat.** 403 `ai_disabled`, honest, path to enablement exists. pass (EV-016).
**JRN-4 (Sam): guest asks for an automation.** Chat presents a build card; build route 403s `insufficient_role` — a dead end the chat itself created. partial fail (ISS-011).
**JRN-5 (Elaine, via registry): the delivery layer itself.** /api/notify with her family's verified, opted-in method and no Google account → `{ok:false, delivered:false, needsSetup:"google"}` — the one layer that never lies. pass (EV-017). But no run can reach it (ISS-006).

## 9. Visual and product design audit

Limited lane this run (no screenshots — §25, DEC-A03); findings from code-level UI reading:
- Success language overpromises at every seam: BuildCard "Done — your new helper is live with its tools preselected" for a Draft agent whose automation will run nothing (EV-022); PlanCard "Already on it — progress and results land right here" for runs that may park silently.
- Status vocabulary is strong at the step level (waiting/needs-approval badges exist) but there is NO chat-level state for parked/expired runs — the thread simply ends (ISS-004).
- The Automations surface shows nextRunAt/lastStatus that are respectively wrong-time (ISS-003) and stale ("queued" forever — ISS-009).
- Role-blind proposals: guests get build cards they can't use (ISS-011).
- Positive: the chat's inline run cards, approval badges, and honest error bubbles are a solid design system for truth — the fix is to feed them truthful states, not to redesign.

## 10. Full-stack audit

- **Frontend (both clients):** thin, server-truth observers at HEAD; mobile plan dispatch is server-durable (EV-021 — historical local-runner hypothesis HYP-003 refuted). Weaknesses: bounded silent polling (3–5 min) with no terminal message for parked runs; optimistic copy (ISS-004/007).
- **Backend:** the durable engine is the strongest asset (leases, idempotency keys, at-most-once recovery, consume-once approvals bound to input hashes, per-household fairness). Defects are at composition points: orchestrator's silent clamp (ISS-005), reasoning-step vacuous success (ISS-002), expiry path skipping hooks (ISS-004), trigger-target construction (ISS-001).
- **State & data:** per-tenant SQLite; conversations/runs/triggers durable and consistent; trigger lastStatus never reconciled (ISS-009).
- **APIs/jobs/integrations:** tick 10s wired; provider adapters real with fallback; email delivery paths inventoried (gmail.send tool vs HTTP-only registry vs draft tool — ISS-006).
- **Security & privacy:** approvals, role gates, tenancy checks held up in every pass (child gate, guest gate, cross-owner conversation protection in the suite). The false-success seams are *honesty* defects, not authorization defects. WP-005 would expand send authority and must keep registry gates + kill-switch coverage.
- **Reliability:** recovery/quarantine on restart is thoughtful; stall sweeper honest. Silent-expiry alerting gap (ISS-008).
- **Maintainability:** seams lack tests precisely where they lie — the repro scripts in evidence/ are designed to become permanent regression tests.

## 11. UI-to-Backend Trace Matrix

Maintained in `audit/functionality-inventory.md` (one row per meaningful action, with parity and evidence columns). Headline rows: build confirm (FEAT-004/005, fail at target construction), background fire (FEAT-006/007, fail), run summary (FEAT-014, fail), approvals (FEAT-010/011, partial/blocked), registry delivery (FEAT-012, honest).

## 12. Convergence and misalignment map

- **Reinforcing:** the engine's honest step statuses ↔ the clients' status badges; the registry's fail-closed gates ↔ the family-safety promise; server-owned conversations ↔ durable history.
- **UI masks backend truth:** "Done — I set up…" masks an unrunnable automation (ISS-001); "Done — finished (n/n)" masks vacuous steps (ISS-002); "helper is live" masks Draft (ISS-007); thread silence masks parked/expired runs (ISS-004).
- **Backend capability lacking product expression:** deliverNotification's registry (the *right* delivery model) is invisible to the planner/engine (ISS-006); routing.droppedSteps exists but nothing renders it (ISS-005).
- **Product language contradicts behavior:** "every day at 7 AM" accepted, "every 24h from now" stored (ISS-003).
- **Intended workflow lacking technical support:** the entire "build me an agent that emails…" promise currently has no path to unattended delivery (ISS-006).

## 13. Canonical master issue register

Full register: `audit/issue-register.md`. Order: ISS-001 (P0) → ISS-002 (P0) → ISS-003 (P1) → ISS-004 (P1) → ISS-005 (P1) → ISS-006 (P1) → ISS-007 (P2) → ISS-008 (P2) → ISS-009 (P3) → ISS-010 (P3) → ISS-011 (P3). All confirmed observed except ISS-008's expiry end-state (code-traced, high confidence).

## 14. Accessibility, responsive, performance, security/privacy, resilience, content, and trust summaries

- **Accessibility:** not audited this run (no rendered surface exercised — named gap; the mobile code shows systematic accessibilityRole/Label usage, unverified). No WCAG claim is made.
- **Responsive:** not audited (same gap). Code shows deliberate keyboard/inset handling on mobile.
- **Performance:** engine step timeout 60s, chat provider timeout 120s, tick 10s, poll 1.5–2.5s — sane; status-pass runs waste a live web call per fire (ISS-010). No load testing performed.
- **Security/privacy:** gates verified honest in all persona passes; no secrets in evidence; repro used isolated stores. Prod probe limited to health.
- **Resilience:** restart recovery + stall sweeps good; silent expiry is the resilience blind spot (ISS-004/008).
- **Content/trust:** the central defect class — success copy decoupled from effects (ISS-002/004/007). Trust repair is the bundle's core outcome.

## 15. Persona debrief (synthetic hypotheses)

- Alex: "What helped: building in one sentence. What broke trust: 'Done' with an empty inbox — I'd rather see 'blocked: connect Gmail'. First improvement: make the automation actually run the skill. Wish: a morning digest of what my agents really did." 
- Morgan: "I can't tell a draft from a live helper. First improvement: one truthful status per helper."
- Lily: "The refusal was clear." (No change requested.)
- Sam: "Don't offer me buttons that end in 'you're not allowed'."
- Elaine: "I only exist if the send happens. Verify my address once, then deliver."
All synthetic; validate with the real household.

## 16. Comparator and research insights

External comparator research was not performed this run (mission is a defect audit with a pre-narrowed hypothesis space; no external claims are made that require sourcing). Internal comparator: the product's own `/api/notify` registry is the honest model the run engine should adopt (EV-017) — the strongest available "comparator" is the codebase's best self.

## 17. Opportunity register and novel-feature portfolio

Evidence-backed opportunities (beyond fixes):
- **OPP-01 Agent truth digest:** daily in-app summary "what your agents actually did / delivered / skipped," built from existing audit rows (fits PI-02; serves Alex/Morgan; small scope once WP-003 lands).
- **OPP-02 Standing-consent delivery (== WP-005):** the per-agent contact allowlist as the product's headline safety story ("your family decides once, visibly, who an agent may message").
- **OPP-03 Build-time dry-run:** materializeBuild immediately fire a sandboxed first run and show the real step list in the build confirmation ("here's exactly what tomorrow 7 AM will do") — would have exposed ISS-001 to users instantly; reuses manual fire.
- **OPP-04 Schedule phrasebook:** normalize human schedules ("weekdays at 7", "first of the month") into anchor fields at build time (extends WP-002).

## 18. Prioritized remediation plan

1. **Immediate P0 stabilization:** WP-001 (build seam), WP-003 (truthful runs/summaries).
2. **Cross-layer MVP shaping:** WP-002 (7 AM anchor), WP-004 (parked-run honesty).
3. **Consent-gated capability:** WP-005 (real unattended delivery) — needs a user decision.
4. **Refinement:** WP-006 (surface truth polish), OPP-03 dry-run.
5. **Deferred:** OPP-01/04; accessibility/responsive audit pass; live-provider transcript check (HYP-005); web journey (HYP-008).

## 19. Implementation-ready brownfield PRD

**Problem statement:** chat-created tasks and agents report success while delivering nothing, for every task type (user report; reproduced as ISS-001/002/003/004/005/006 with EV-011..EV-017).
**Target users/personas:** Alex, Morgan (builders); Elaine (recipient); household trust overall.
**Current behavior and root cause:** see §1; mechanisms fully traced in the issue register.
**Goals / measurable success:**
- G1: For the verbatim repro-A request, the created trigger targets the created skill, nextRunAt is the next local 07:00 ±1 min, and the fired run's steps are the skill's steps. (Tests: extended repro A.)
- G2: No run summary may claim delivery without a delivering tool step having succeeded; effect-free completions must say so explicitly. (Snapshot tests on runOutcomeText; repro B.)
- G3: Every parked run produces a conversation message ≤5 s after parking; every expired run produces a terminal message; two consecutive expiries alert the Owner. (TTL-fixture test; repro B2.)
- G4: No plan step may be silently removed: policy-blocked steps are visible with a reason. (Repro C.)
- G5 (WP-005, if selected): an allowlisted agent's scheduled send delivers via the registry (mocked Gmail) or returns the registry's typed refusal; kill switch halts it.
**Non-goals:** redesigning the chat UX; new connectors; native visual verification (lane closed); production deploy (user-side Render fix).
**Chosen solution & rejected alternatives:** per work package; key decisions DEC-A02/A04 (e.g. "wire skill into target" chosen over "planner emits target JSON" — smaller surface, model-independent; "visible skipped steps" over "hard-fail on clamp" — preserves partial value with honesty; both compared in WP docs).
**Target end-to-end journey:** Alex's JRN-1 with steps 3–7 flipped to pass/honest-block.
**UX/UI & content requirements:** use existing badges/cards; new states: `skipped (not permitted)`, `waiting for approval (expires…)`, `expired — nothing sent`, `composed but not sent`. All states must render on narrow mobile widths with the existing components; no new layout primitives.
**State/data/API:** additive trigger fields (target.skillId/goal already in schema; new `anchor`); new step statuses through publicRun (clients' mapStepStatus default-tolerant — verify); no DB migration (JSON docs per tenant).
**AuthN/Z & privacy:** no gate relaxation in WP-001..004; WP-005 formalizes the allowlist as standing consent; every delivery audited.
**Performance/reliability budgets:** no new polling; hook work is fire-and-forget; anchor math O(1) per tick.
**Observability:** audit rows for park/expire messages, clamp skips, anchor recomputes; keep failureClass taxonomy.
**Acceptance criteria:** G1–G5 above plus per-WP criteria (all observable/testable; no "intuitive/fast" language used).
**Validation plan:** harness tests grown from the two evidence scripts (unit: trigger math; integration: build→fire→run→summary; contract: publicRun statuses; scoped e2e: conversation messages; manual: one web journey; live send only with explicit authorization).
**Slices in dependency order:** WP-001 → WP-002 → WP-003 → WP-004 → (gate: user consent) WP-005 → WP-006.
**Rollout/compat/rollback:** all server changes additive & revert-safe; clients tolerate old servers; feature-flag WP-005's tool registration. Prod delivery of the fix additionally requires the user-side Render deploy repair — stated plainly: until then, production keeps the bug regardless of local fixes.
**Risks/open questions:** household timezone source (WP-002); consent wording (WP-005); real-model build JSON variance (HYP-005); Render deploy (external).
**Definition of done:** G1–G4 green in CI + the repro scripts pass inverted + slice log five-point checks `ship` — production claims only after an authorized deploy and re-test.

## 20. Orchestrator-ready implementation work packages

Full contract-form packages: `audit/implementation-queue.md` (WP-001…WP-006, each with slices, acceptance criteria, validation, risk, rollback, sequence).

## 21. Numbered implementation menu and recommended bundle

| # | Item | User value | Scope | Deps | Risk | Effort | Leverage | Evidence |
|---|---|---|---|---|---|---|---|---|
| 1 | WP-001 Wire built skill → automation (kill status-pass) | Chat-built agents actually run what was built | server build/trigger path | — | low-med | S–M | Highest (P0 root) | EV-011, EV-015 |
| 2 | WP-002 "7 AM" means 07:00 (anchor scheduling) | Right time, every day | trigger math + prompt | after 1 | low | S | High | EV-011 |
| 3 | WP-003 Truthful runs & summaries (no vacuous sends, visible clamps) | Chat never claims an effect that didn't happen | planner/engine/summary | — | med | M | Highest (P0) | EV-012, EV-014 |
| 4 | WP-004 Parked/expired runs report back | No more silent "On it…" dead ends | engine hooks + chat + clients | pairs 3 | low-med | S–M | High | EV-013, EV-007 |
| 5 | WP-005 Real unattended delivery via contact registry (standing consent) | The briefing email actually arrives at 7 AM | new engine tool + notify | 1; user consent decision | med-high | M | High | EV-010, EV-017 |
| 6 | WP-006 Surface truth polish (statuses, copy, role-aware proposals) | What you see is what will run | clients + copy | 1 | low | S | Medium | EV-016, EV-022 |
| 7 | **Recommended bundle: items 1+2+3+4** — one coherent vertical release: chat-built agents run the real skill at the real time, and every outcome (success, waiting, expired, blocked, skipped) is told truthfully in the thread. Delivers the user's stated definition of done except unattended delivery, which is item 5's explicit consent decision. | | | | | M–L | | all above |

Which numbered improvement, feature, or recommended bundle should I implement now?

## 22. Decision log and rejected alternatives

`audit/decision-log.md` — DEC-A01 (isolated-harness evidence over live-tenant/browser), DEC-A02 (single seam-cluster root cause; stale-prod refuted as cause), DEC-A03 (API-level persona passes; visual lane deferred with named trade-off), DEC-A04 (bundle composition; WP-005 consent-gated), DEC-A05 (foreign-row handling).

## 23. Remaining unknowns and next discriminating checks

- HYP-005: real cloud-model build JSON variance → one authorized live-provider chat turn locally, inspect emitted automation JSON.
- HYP-006: approve→consume→gmail.send happy path → harness test with mocked Gmail fetch asserting the RFC822 payload.
- HYP-007: TTL-expiry end-to-end silence → shortened-TTL fixture run.
- HYP-008: web client parity → one browser journey on the local stack (TG- records, cleanup).
- Prod bundle identity → after the user repairs Render deploy, verify build hash then re-run the affected journey before any production claim.

## 24. Evidence index

`audit/evidence-ledger.md` — EV-001…EV-028 (each with what it proves / does not prove). Raw artifacts: `audit/evidence/repro-false-success.mjs`, `audit/evidence/repro-output.json`, `audit/evidence/persona-passes.mjs`, `audit/evidence/persona-output.json`.

## 25. Screenshot gallery

Empty by disclosed decision, not omission: no screenshots were captured this run. The native iOS lane is closed by user decision (prior-run DEC-10); the decisive evidence for this mission is server-side runtime state (runs, triggers, conversation records), captured as JSON in the evidence artifacts; a web visual pass was deferred with rationale and trade-offs in DEC-A03. No screenshot or annotation IDs are claimed anywhere in this report.
