# Universal Convergent 360-Degree Product Experience and Full-Stack Truth Audit — Brownfield PRD and Implementation Mandate

Run run-20260719-232201 · FamiliOS **native mobile app** (`apps/mobile`, ai.familios.app) · seeded by 12 real TestFlight submissions / 13 screenshots (ART-001) · 2026-07-19. Deep detail lives in the audit registers (linked per section); this report merges every material finding.

## 1. Executive verdict and highest-value decision

FamiliOS mobile is a well-architected family-OS client — server-owned truth, honest role gates, approval-gated external writes, an assistant that degrades honestly — but the field feedback found exactly where the product's promises outrun its behavior: the cooperative help loop and event logistics.

**Verdict:** all 11 seeded candidates resolved against current source (HEAD ffcfa33): 9 confirmed as real issues/gaps, 1 (TF-ISS-02 upload data loss) **refuted and reclassified** as a save-confidence UX gap, 1 (TF-ISS-11 assistant connector boundary) confirmed as **correct intended behavior**. Highest-value decision: **fix help-accept reassignment on the server** (ISS-001, P1) — a two-account repro proved accepting help never transfers the task, which breaks the core promise AND manufactures the duplicate-card symptom the tester photographed.

**Recommended release:** §21 ★ bundle = WP-001+WP-002+WP-003+WP-004 — "the app tells the truth and the calendar works."

## 2. Scope, environments, authorization, evidence limits, and production/source parity

- In scope: `apps/mobile/**` + shared server paths it calls. Out: web-app rework (run-1 protected), EAS/store actions, `mobile-version/`.
- Environments: source at HEAD ffcfa33 (post-dates tester builds 13/19; every candidate re-confirmed at HEAD); LOCAL backend :8787 (claimed resident household — disposable, clearly-named test entities only, all deleted afterward); production Render backend **never touched** (live family data). Production/source parity: unresolved by policy (HYP-07) — server claims are local-HEAD truths.
- Evidence limits: **no native iOS runtime lane** (appium-device-cloud and appetize-sim blocked — credentials/simulator build absent). Native rendering claims are code-traced, corroborated by field screenshots, and labeled **native-verification-blocked**. Web evidence never counted as native.
- **Boundary incident (disclosed):** one probe of POST `/api/calendar/push/<test-event>` reached the live Google API because the resident local household holds a stale connected Google account; Google rejected it 401 → `needs_reconnect`. No external state changed; route not probed again (DEC-08); TF-003 stayed contract-level. Journal event #10.
- Product source read-only throughout; writes confined to the run dir + journal. No git mutations.

## 3. Capability inventory and agent topology

Drivers (probed pre-dispatch): `playwright-web` use-now; `appium-device-cloud` **blocked** (BROWSERSTACK_*/LT_*/APPIUM_REMOTE_URL absent); `appetize-sim` **blocked** (APPETIZE_* absent + no simulator build). Unblock is user-side; never self-provisioned. Lanes used: source trace (Read/Grep), local backend API (two-account + two-attempt repros), git history, 13 inspected screenshots, mem/validators. Topology: single audit lead in separated passes (no parallel persona subagents — limitation disclosed §7). Native-harness prep: `audit/element-map.md` (zero testIDs; 80+ accessibilityLabels).

## 4. Application understanding

A household operating system: three-layer shared calendar (canonical/linked/public), tasks & lists, meals/groceries, document library, help requests, agents/automations, assistant — server owns all family data; each member gets a role/relationship-fit home (owner, adult, child, grandparent, sitter). Full map: `audit/architecture-authority-map.md`.

**Strengths worth preserving (credited):** server-side visibility filtering (child 403s verified live); approval-gated external writes; honest assistant degradation (planner.mjs:240 — matches TF-010/011 screenshots exactly); offline task queue; two-way Google sync with edit-own-calendar-only discipline; role-free help asks; consistent design system with strong accessibility labeling.

Unresolved assumptions: production parity (HYP-07); exact build↔commit mapping for builds 13/19 (HYP-05).

## 5. Observed product intent, inferred vision, success measures, and contradictions

Register: `audit/product-intent-register.md` (PI-01..10). Intent: trustworthy shared family logistics with honest AI assistance; success = a helper-grandmother and an operator-parent can run a week of family life without the app misleading them. **Central contradiction (PI-08):** the event editor's minimalism (one date, no notes, no all-day) contradicts the logistics ambition (driver, what-to-bring, Google sync) — and the server model is already richer than the editor exposes (notes + multi-day proven, EV-NET-02).

## 6. App Functionality Inventory and coverage

Register: `audit/functionality-inventory.md` — 30-feature denominator + trace matrix.

```
Execution coverage: 30/30 = 100%  (source trace all; local-API runtime on 9)
Verified coverage:   9/30 = 30%   (authority-layer verified; native rendering verified for NOTHING)
Persona coverage:   14/30 = 47%
```

Blocked lanes named: native iOS rendering/interaction (drivers), push notifications end-to-end (device), live Google mutation (policy), production behavior (policy). Blocked never counts as verified.

## 7. Five canonical persona cards

> **Synthetic-research disclosure:** these five personas are research instruments, not interviewed customers. Personas 1–2 are grounded in the two real TestFlight testers' observed behavior (their notes and screenshots); Personas 3–5 are inferred from shipped roles, seed data, and code. All quotes/preferences are simulated hypotheses requiring real-user validation.

### Persona 1 — Melissa, the operator-parent
Grounding: real tester (10 of 12 submissions). Role: Adult Admin; runs school logistics, events, uploads, assistant. Fluency: high app fluency, moderate technical. Goal: capture family logistics fast and trust Google sync. Device iPhone 14, iOS 26.5.x, bilingual (EN/ES keyboard observed). Data: dense — tasks, events, 31 knowledge items. Urgency: high (school-week pressure). Trust requirement: what she enters must survive sync and uploads must visibly save. Frustrations (evidence-backed): multi-day/all-day/notes gaps (TF-001/006/007), Google push losing what-to-bring (TF-003), dual save buttons (TF-004), free-text location (TF-005), non-editable tasks (TF-002), upload confidence (TF-012). Abandonment trigger: silent data divergence between FamiliOS and Google.

### Persona 2 — Beannie, the helper-grandmother
Grounding: real tester (TF-008/009). Role: Limited Member, relationship Grandmother → calm grandparent home. Fluency: low-moderate; large type matters. Goal: "tell me how I can help, and don't make me wonder." Data: sparse own-data; sees family calendar. Frustrations: accepting help doesn't move the task (TF-008), duplicate cards, no way to bound availability (TF-009). Trust requirement: an accepted promise must be reflected everywhere. Abandonment trigger: feeling her acceptance "didn't count."

### Persona 3 — Ross, the owner
Grounding: real household owner figure (driver chips, TF-008 narrative). Role: Owner. Goal: delegate and see truthful state ("did Beannie really take this?"). Frustration: after her accept, the task still sits under his name → he re-asks → duplicates. Trust requirement: the roster of who-owns-what is never stale.

### Persona 4 — Mia, the child (synthetic)
Grounding: shipped Child View role + kid home + aiEnabled gate. Goal: see her day and chores without adult noise. Verified: server-side filtering, 403 on create/upload (EV-NET-02 P5). Risk points: none confirmed; protection posture is a strength.

### Persona 5 — Priya, the sitter (synthetic)
Grounding: shipped Guest/Helper role + sitter home + role-free help asks. Goal: a scoped evening view: today's events, her assigned tasks, help requests. Shares HelpRequestsSection → inherits ISS-001's broken promise on accept.

## 8. Five end-to-end journey narratives and step tables

Journeys executed on the truthful lanes available (local API + code trace + field screenshots); every native-UI step is marked **[native-blocked]**. Full runtime transcripts: `audit/evidence/tf008-tf012-repro-transcript.txt`, `event-model-role-probes.txt`.

**JRN-1 · Melissa — capture a multi-day school event, sync to Google, upload the medical ID.**
| # | Step | Lane | Result |
|---|---|---|---|
| 1 | Create event "campout" Jul 25 9 PM → Jul 27 2 PM | API | pass server-side (span stored) — **mobile form cannot express it** (fail at editor; EV-CODE-01) |
| 2 | Add notes | API | pass server-side; **no notes field on mobile** (fail at editor) |
| 3 | Edit via mobile-shaped PATCH | API | pass; notes preserved (EV-NET-02 P2) |
| 4 | Push to Google | contract | payload drops what-to-bring; description=notes only (EV-CODE-04); live call forbidden — one 401-rejected probe disclosed |
| 5 | Upload medical ID twice + logout/login | API | pass — both persist, bytes intact (EV-NET-01) |
| 6 | See save confirmation, find file in category | code [native-blocked] | 800 ms flash; default space files under Home → perceived "not saved" (ISS-002) |

**JRN-2 · Beannie — accept Ross's ask.** Login as disposable Limited Member → GET help-requests (pending visible) → accept → **task still Ross's, her list empty** → Ross re-asks (no dedupe) → accept → **two accepted records = the two cards of TF-SS-09**. All API-verified (EV-NET-01); card rendering code-traced [native-blocked].

**JRN-3 · Priya — sitter evening.** Same respond path as JRN-2 (shared component) → inherits ISS-001; sitter home + complete-button code-traced [native-blocked].

**JRN-4 · Ross — delegate and verify.** Create task → ask → after accept his /tasks still shows him as assignee (EV-NET-01); home "waiting" card only tracks pending (his accepted asks vanish from his view — no "Beannie is on it" state) — code-traced.

**JRN-5 · Mia — child boundary.** Login as disposable Child View member → sees household events; POST /events 403; POST /files 403 (EV-NET-02 P5). Kid home render [native-blocked].

Persona debriefs → §15.

## 9. Visual and product design audit

From inspected field screenshots + source (native rendering current-build **blocked**): consistent Hearth design system (Well/Card/Chip/SectionHeader), dark+light both observed in the field shots; calm large-type grandparent home is genuinely differentiated; tab IA (Today/Ask/Agents/Library/Settings) clean. Issues surfaced visually: three stacked buttons on edit-event read as duplicates (TF-SS-04/05, ISS-008); time wheel forced for all-day realities (TF-SS-07); task rows show no affordance that they can't be tapped (TF-SS-02, ISS-011); duplicate help cards (TF-SS-09, ISS-001); "Processing" badge ambiguity in Library (ISS-002). System states are generally honest (Notice/EmptyState/ErrorState components used throughout).

## 10. Full-stack audit

Register: `audit/architecture-authority-map.md`. Frontend: Expo Router screens fetch-on-focus + rev polling; minimal client state — sound for a truth-owning server. Backend: node-http monolith, JSON keyed collections, role gate on every route (verified by probes); help respond lacks the reassignment write (ISS-001 root cause); files store durable with honest caps (verified); Google payload builder single choke point (good — one fix site, ISS-003). Security/privacy: bearer in secure-store, server-side filtering verified, approval gates on external writes; PII rides in family data as expected — kept in-workspace here. Reliability: offline queue for tasks only; stale_write 409s exist server-side but mobile surfaces them generically. Maintainability: legacy `src/components/ui.tsx` shadowing noted in comments; zero testIDs (ISS-013).

## 11. UI-to-Backend Trace Matrix

Canonical matrix (9 meaningful actions incl. the two failing ones): `audit/functionality-inventory.md` §Trace Matrix. Headline rows: `I can help` → respond handler → **no task mutation** (fail, ISS-001); task-row tap → **no handler** (fail, ISS-011); `Upload & file` → durable POST + transient flash (feedback gap, ISS-002); `Update in Google` → approval-gated push → description=notes only (ISS-003).

## 12. Convergence and misalignment map

- Design and architecture reinforce: role-scoped homes ↔ server-side filtering (verified); approval sheets ↔ server approval gates; honest assistant copy ↔ planner policy.
- UI masks backend limitation: accepted help card *asserts* "You're helping Ross" while the backend never recorded an ownership change — the sharpest language-vs-behavior contradiction found (ISS-001).
- Product language contradicts behavior: "Files stay in your household library" is TRUE but the save cue is too weak for users to believe it (ISS-002).
- Technical capability lacks product expression: server already stores notes + multi-day spans that the mobile editor cannot enter (ISS-004/006); server responseNote exists but accept-side UI never offers it (ISS-010).
- Backend complexity leaks into UI: canonical-vs-linked event save semantics produce the two-button confusion (ISS-008).

## 13. Canonical master issue register

Canonical register (13 rows, severity-ordered, full fields): `audit/issue-register.md`. Summary: P1 ISS-001 (help reassignment); P2 ISS-002 (upload confidence, refuted-P1), ISS-003 (Google drops what-to-bring), ISS-004 (no end date), ISS-005 (no all-day), ISS-006 (no notes on mobile), ISS-007 (location plain text), ISS-011 (tasks not editable); P3 ISS-008 (dual save), ISS-009 (lingering cards), ISS-010 (accept parameters), ISS-013 (no testIDs); P4/by-design ISS-012 (honest connector boundary — keep).

## 14. Accessibility, responsive, performance, security/privacy, resilience, content, and trust summaries

- Accessibility: strong label coverage (80+), roles/states set on interactive elements; grandparent home uses larger type deliberately. Limits: no native screen-reader run (blocked); long-press-only task menu is an a11y risk (no visible alternative — ISS-011 fix should add one).
- Responsive/platform: phone-first; iOS native pickers vs dialog fallback code-paths exist; no current-build native render check (blocked).
- Performance: fetch-on-focus + rev polling is chatty but simple; no measured evidence this run (not claimed).
- Security/privacy: verified role floors (403 probes), bearer secure-store, approval gates; screenshot PII kept in-workspace.
- Resilience: offline task queue; honest 413/403/409 errors server-side; mobile shows generic messages for 409 (minor).
- Content/trust: honest degraded assistant is a standout; the one place the copy lies is the accepted help card (ISS-001).

## 15. Persona debrief (labeled synthetic hypotheses)

- Melissa: "One improvement? One save button that also updates Google and never loses what I typed." Wish: address autocomplete + directions. Would stop using if Google sync silently diverges.
- Beannie: "Tell me it moved to my list — I accepted twice because nothing changed." Wish: say when I'm available.
- Ross: "Show me it's off my plate." Wish: a 'Beannie is on it' state on his own list.
- Mia: no friction found (protection posture works).
- Priya: "The evening view is right; make accepting mean something."
All synthetic hypotheses, not customer quotes.

## 16. Comparator and research insights

No external web research was run (mission is field-evidence-seeded; budget routed to code+runtime truth). Comparator baseline from domain knowledge, labeled inference: family organizers (Cozi, Google Family Calendar, Apple Reminders sharing) all treat multi-day/all-day as table stakes (supports P2 on ISS-004/005), and chore apps (OurHome) make assignment transfer the core loop (supports ISS-001 priority). Run-1's web audit principles (honest degradation, sync fidelity) reused as principles only per HANDOFF §2.

## 17. Opportunity register and novel-feature portfolio

Evidence-traced opportunities (not speculative): OPP-1 availability windows on help accept (ISS-010 → helper scheduling); OPP-2 "helping" state surfaced on tasks (from ISS-001 fix — show helper avatar on the task row both sides); OPP-3 upload destination intelligence ("Let Famili decide" actually deciding via mime/name/knowledge, honestly disclosed); OPP-4 Alexa/phone-call connector (TF-010/011 roadmap); OPP-5 Google extendedProperties for structured what-to-bring round-trip (DEC-04 deferral); OPP-6 testID instrumentation enabling the native harness (WP-008).

## 18. Prioritized remediation plan

1. P1 stabilization: WP-001 (help-loop integrity).
2. Trust quick win: WP-002 (upload save-confidence).
3. Cross-layer MVP shaping: WP-003 (event editor completeness: end date, all-day, notes).
4. Sync fidelity + interaction refinement: WP-004 (Google description + one-save UX).
5. Feature completion: WP-005 (task edit), WP-006 (location), WP-007 (accept parameters).
6. Deferred/enabling: WP-008 (testIDs), opportunities §17.

## 19. Implementation-ready brownfield PRD

Problem statement, evidence, current behavior, root causes: §§1–13 + issue register. Target users/personas: §7. Goals: (G1) accepting help transfers ownership visibly on both members' surfaces; (G2) every upload yields a persistent, location-naming confirmation; (G3) events support end-date/all-day/notes on mobile at parity with the server model; (G4) Google description carries notes + what-to-bring losslessly; measurable via the acceptance criteria in `audit/issue-register.md` (every criterion observable/testable; no vague terms). Non-goals: web rework, EAS/store, live Google verification (blocked by policy), Alexa/phone connector (roadmap). Solution choices + rejected alternatives with trade-offs: `audit/decision-log.md` DEC-01..DEC-09 (two-path comparison recorded for every nontrivial call). State handling: loading/empty/error/offline states already exist as components; slices must cover 409 stale_write surfacing, 413 cap messaging, approval-denied, and connector-unavailable paths. Data/migration: `allDay` flag is additive; help respond adds a task PATCH in the same handler (no schema migration; JSON stores). Testing: server unit/integration tests per slice (mock Google fetch; no live calls), two-account API repros as regression fixtures, web render checks for shared-server changes, mobile tsc. Rollout: slice-ordered per WP sequence; rollback = per-slice revert (no destructive migrations). Risks/blockers: native visual verification stays blocked until drivers unblock — ship with code+web+API evidence and the field testers as the final visual check via the next TestFlight build (explicitly user-authorized, out of this run's scope).

## 20. Orchestrator-ready implementation work packages

Full contract-compliant packages WP-001..WP-008: `audit/implementation-queue.md` (objectives, slices, acceptance criteria, validation, risk, rollback, sequence).

## 21. Numbered implementation menu and recommended bundle

| # | Item | Value | Scope | Deps | Risk | Effort | Evidence |
|---|---|---|---|---|---|---|---|
| 1 | WP-001 Help-loop integrity (ISS-001+009) | Core promise kept; kills duplicate cards | server respond/create + 4 mobile surfaces | — | low-med | M | EV-NET-01 |
| 2 | WP-002 Upload save-confidence (ISS-002) | "Did it save?" never asked again | mobile library/upload | — | low | S | EV-NET-01, EV-CODE-05 |
| 3 | WP-003 Event editor completeness (ISS-004/005/006) | Multi-day, all-day, notes on mobile | event-form + renderers + allDay model | — | med | L | EV-NET-02, EV-CODE-01 |
| 4 | WP-004 Google sync fidelity + one-save UX (ISS-003/008) | Nothing dropped on push; one save action | server calendar.mjs + form actions | #3 (notes) | low-med | M | EV-CODE-04 |
| 5 | WP-005 Task tap-to-edit (ISS-011) | Edit without delete+recreate | tasks screen + sheet | — | low | S-M | EV-CODE-06 |
| 6 | WP-006 Location suggestions + directions (ISS-007) | Real places, one-tap navigation | form + places util | — | low-med | M | EV-CODE-09 |
| 7 | WP-007 Help-accept parameters (ISS-010) | "Yes, after 3pm" | accept flow UI | #1 | low | S | EV-CODE-10 |
| 8 | WP-008 testID instrumentation (ISS-013) | Native harness readiness | app-wide mechanical | — | low | S | EV-DEC-01 |
| **9** | **★ Recommended bundle: #1 + #2 + #3 + #4** | **"The app tells the truth and the calendar works" — both P1/P2 trust repairs + the editor pass that unblocks sync fidelity (DEC-09)** | WP-001..004 | internal | med | L | all above |

Which numbered improvement, feature, or recommended bundle should I implement now?

*(Mission pre-selection recorded per facts handoff: the ★ Recommended bundle (#9) is the selection — logged in the decision log for S5; no pause required.)*

## 22. Decision log and rejected alternatives

Canonical: `audit/decision-log.md` — DEC-01 server-first reassignment (vs client-side), DEC-02 TF-012 downgrade rationale, DEC-03 one editor pass (vs micro-fixes), DEC-04 server-side description composer (vs client), DEC-05 OS geocoder (vs Places API), DEC-06 keep approval gate in one-save UX (vs silent push), DEC-07 evidence routing / no expo-web attempt, DEC-08 halt Google probes after the 401 incident, DEC-09 bundle composition.

## 23. Remaining unknowns and next discriminating checks

`audit/hypothesis-queue.md`: HYP-06 (was her exact second upload oversize? — unknowable, design fix covers all modes), HYP-07 (production parity — forbidden this run), HYP-08 (native rendering — unblock = BROWSERSTACK_*/APPETIZE_* creds + EAS artifacts, then run the element-map-driven smoke), HYP-05 residual (exact build↔commit map). Next checks post-implementation: rerun both API repros as regressions; verify with testers on the next authorized TestFlight build.

## 24. Evidence index

`audit/evidence-ledger.md`: EV-SS-01..13 (inspected originals), EV-CODE-01..11, EV-NET-01..02, EV-DEC-01. Runtime transcripts under `audit/evidence/`.

## 25. Screenshot gallery

Inspected originals (unmodified; no annotated copies were produced — originals unambiguous). All under `audit/evidence/`:
TF-SS-01 (TF-001 end-time-only) · TF-SS-02 (TF-002 task list) · TF-SS-03/04 (TF-003 Google vs FamiliOS what-to-bring) · TF-SS-05 (TF-004 three buttons) · TF-SS-06 (TF-005 free-text location) · TF-SS-07 (TF-006 forced time wheel) · TF-SS-08 (TF-007 no notes) · TF-SS-09 (TF-008 duplicate accepted cards) · TF-SS-10 (TF-009 pre-accept card) · TF-SS-11/12 (TF-010/011 honest assistant) · TF-SS-13 (TF-012 file present in Medical & IDs). Descriptions + what each does/doesn't prove: evidence ledger.
