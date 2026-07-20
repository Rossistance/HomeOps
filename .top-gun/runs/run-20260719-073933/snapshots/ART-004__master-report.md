# Universal Convergent 360-Degree Product Experience and Full-Stack Truth Audit — Brownfield PRD and Implementation Mandate

Product: FamiliOS (repo "HomeOps AI", `D:\HomeOps\homeops-ai`) · Run: run-20260719-073933 · Date: 2026-07-19 (UTC) · Auditor: audit-lead (single agent; separated-pass mode, Agent-spawn not used) · HEAD: ffcfa33

---

## 1. Executive verdict and highest-value decision

FamiliOS is a genuinely impressive, design-led "family operating system": a local-first React app over a dependency-free Node control plane that owns OAuth, an encrypted vault, webhooks, jobs, a browser-automation boundary, and a per-household tenant database. Its defining bet is **trust through honesty** — "no simulated connectors and no fake success states." That bet is mostly *kept* and is the product's strongest asset: connector readiness states are accurate, agent runs halt at real approval gates, and a deterministic local engine builds agents and workflows with no cloud provider.

But the audit found a **P0 data-integrity defect** and a cluster of **P1 trust failures that land exactly where the product stakes its reputation — the first five minutes and the two most honest-by-design surfaces**:

- **P0 (ISS-001):** `npm test` writes into the *live* `server/.data` and permanently wedges a running backend into `disk I/O error` 500s. Found, root-caused, and recovered during this audit (backend restarted; DB intact). CI cannot see it (ISS-008).
- **P1 (ISS-002/003/003b):** First-run onboarding silently swallows total backend failure (no error, misleading "may need PIN"), and on any already-claimed server the "Create household", "Explore the sample", and "Reset sample data" paths orphan the household and dead-end at a stranger's lock screen.
- **P1 (ISS-004):** The headline "Ask FamiliOS" chat dead-ends with "No AI provider connected" even though the sibling Workflow Builder ships a working no-provider "built-in rules engine" — contradicting the local-first promise on the most prominent surface.
- **P2 (ISS-006):** The flagship out-of-box "live" Weather tool returns a *hollow success* (no temperature) instead of an honest `provider_error` — the one behavior the product promises never to do.

**Highest-value decision:** approve the **Recommended bundle (WP-001 + WP-002 + WP-003)** — stop the test suite from corrupting data, make first-run and sample paths honest and unbreakable, and make the headline assistant useful with no provider. This trio protects the product's core promise (honesty + local-first) at its highest-traffic, highest-risk moments, with no architectural upheaval. Full detail and the numbered menu are in §21.

## 2. Scope, environments, authorization, evidence limits, and production/source parity

- **In scope (executed):** the web app at mobile viewport (375x812 primary; 320x700 and 1280x800 responsive), its backend behavior reachable through the UI without external side effects, plus code review of CI/CD (`.github`, `render.yaml`) and the Expo app (`apps/mobile`, review-only).
- **Environments:** web http://localhost:5173 (Vite dev), backend http://localhost:8787 (`v1.2.0`, node v25.8.2, `authRequired`, `externalActionsEnabled:true`), browser runtime :9223. All findings are **local-runtime**; no deployed Render URL was probed (parity unresolved — HYP-006). `dist/` present but treated as stale.
- **Authorization honored:** product source / git / production / external services read-only; local in-app state creation allowed; NO external side-effect connector executions, NO OAuth/SMS, no secret files read, `.claude/launch.json` untouched. One permitted real read call (Weather → Open-Meteo) was executed.
- **Evidence limits:** one canonical persona (Maya) executed a live end-to-end journey; the other four are evidence-grounded and code-traced, with their distinct runtime paths (populated-data power use, child/grandparent/sitter role-gating, admin invite mgmt) **blocked** this run by the claimed-server state (see §6). Accessibility claims are keyboard/DOM/screenshot-level, not a full WCAG pass.
- **Parity:** production vs source unverified; the Node-version story is incoherent across README/engines/CI/dev/deploy (ISS-007).

## 3. Capability inventory and agent topology

- **Use now:** Playwright MCP emulator (all product interaction), Read/Grep/Glob (source), PowerShell/Bash (read-only + validators), python 3.14 (mission scripts), backend HTTP read endpoints, node --test / tsc (baseline).
- **Use if needed / not needed this run:** chrome-devtools MCP (not required), design/product skills, connectors requiring OAuth (barred).
- **Blocked:** in-app Browser pane (recorded fallback → Playwright used throughout).
- **Agent topology:** the Agent tool was available but nested sub-agents were **not** spawned; per the mandate's separated-pass rule, the single audit-lead performed all logical roles (product/UX, visual, frontend, backend/data, workflow, security/privacy/perf, accessibility, five-persona simulation, evidence, synthesis) in clearly separated passes. This limitation is disclosed and does not affect evidence integrity.

## 4. Application understanding

- **Product purpose:** reduce household mental load via a team of permission-scoped "helper agents" that coordinate schedules, meals, documents, messages, bills, caregiving, school, travel, and recurring workflows — acting externally only through real connectors behind approval gates.
- **Target users:** parents, couples, caregivers, roommates, individuals; six roles (Owner, Adult Admin, Adult Member, Limited Member, Child View, Guest/Helper) mapping to five view modes (owner/adult/child/grandparent/sitter).
- **Core jobs:** create agents (template or plain English), build automations, approve sensitive actions, manage a family calendar/meals/files/knowledge, run mini apps, capture memory/activity, connect accounts.
- **Architecture and authority:** React 18 + Vite 8 + Tailwind 3 + Zustand 5 (store-based navigation; react-router-dom declared but unused), local-first via IndexedDB (`idb`); dependency-free Node "control plane v1.2.0" (`server/index.mjs`, 3214 lines, 74 route roots) with per-household `node:sqlite` tenant DBs, AES-256-GCM vault, audit log, in-process jobs, OAuth boundary, webhook receiver; separate Playwright browser runtime. Server `auth.mjs gate()` is the permission authority; client checks only hide what would 403.
- **Primary workflows:** onboarding → household → agents/automations → approvals; connector configure → tool run (read executes; write → approval).
- **Strengths worth preserving (see §12/§14):** honest connector readiness model; approval-gated runs; deterministic local engine; "Tactile Hearth" design system with Calm Mode; clean responsive behavior; comprehensive Settings with real safety disclaimers; 287/287 backend tests green.
- **Unresolved assumptions:** production parity; whether the claimed-server collisions vanish on a fresh server (HYP-001); exact weather-upstream trigger (HYP-003).

## 5. Observed product intent, inferred vision, success measures, integrations, and contradictions

Full register: `audit/product-intent-register.md` (PI-001..PI-015). Highlights:

- **Promise (confirmed):** "no simulated connectors and no fake success states" (PI-005); high-risk tools always create an approval request (PI-006); local-first with secrets only in the backend vault (PI-007).
- **Inferred vision:** trust is the differentiator vs generic AI assistants (PI-015); a paid iOS subscription distribution runs alongside the web build (RevenueCat webhook + TestFlight, PI-012).
- **Success measures (adopted from `08_SUCCESS_CRITERIA`):** no console errors, no dead-end buttons, responsive, accessible contrast, clear empty states (PI-011) — used as this audit's nonfunctional bar.
- **Contradictions (confirmed):** (a) product name split HomeOps AI vs FamiliOS (PI-009); (b) three-way Node version conflict (PI-010/ISS-007); (c) original PRD mandated *mock* adapters; the shipped build claims *real* adapters (PI-008 — deliberate scope growth); (d) README "11 product screens" vs 16 routed screens (EV-107); (e) README "every task resolves locally" vs the Assistant chat's provider dead-end (PI-005 vs ISS-004).

## 6. App Functionality Inventory and coverage

Full inventory + trace matrix: `audit/functionality-inventory.md` (82 in-scope FEAT ids).

```
Execution coverage: 40/82 = 49%
Verified coverage:  24/82 = 29%
Persona coverage:   40/82 = 49%
```

- One canonical persona (Maya) executed a real live journey covering ~18 features across onboarding, auth, dashboard, agents, assistant, automations, connections, settings, responsive, and Calm Mode.
- **Named gaps (honest, not counted as verified):** child/grandparent/sitter runtime role-gating, populated-data power journeys, and admin invite management were **blocked** by the claimed-server state (unblock: fresh `server/.data` or seeded multi-role roster). Meals, Calendar CRUD, Files upload, Knowledge, Mini Apps, Messages/Approvals decision flow, Household Spaces roles matrix, Activity/Memory, Skills/Functions advanced tabs, and OAuth click-through remain pending on budget — each is reachable, none is a product blocker. SMS/RevenueCat are code-review-only by authority boundary.

## 7. Five canonical persona cards (synthetic-research disclosure)

> These five personas are **research instruments inferred from the code, seed data, roles, and copy — not interviewed users.** Their goals, frustrations, and quotes are simulated hypotheses requiring real-user validation.

### Persona 1 — Maya Chen-Okafor (First-time Owner, mobile, time-poor)
Newly-separated parent setting up a blended household on her phone during a lunch break. Low technical fluency, high urgency, wants "one place for everyone's schedule". Device: iPhone-class 375px. Data: empty → self-built. Success = a working household + one helper agent in under five minutes. Concerns: privacy of children's data, not wanting to "set up a server". Likely abandonment trigger: any dead-end or unexplained failure at first run. Evidence: onboarding copy, roles.ts Owner, seed owner shape. **Executed live (JRN-1).**

### Persona 2 — Alex Harper (Power Owner, populated household)
The seed household's owner (`m-alex`), a hands-on organizer running six family members, agents, automations, meals, and a calendar. High fluency, daily use, wants dense dashboards and fast repeat actions. Data: rich (seed "The Harper Family"). Success = at-a-glance control + trustworthy automation. Frustration: repetitive navigation, stale state after context switches. Evidence: `data/seed.ts` roster, 20 automation templates, populated collections. **Blocked runtime (claimed server); code-traced.**

### Persona 3 — Morgan Harper (Adult Admin / co-parent)
Second adult (`m-morgan`, Adult Admin) who manages members, invites the sitter, sets the Owner PIN, and approves sensitive actions but doesn't own billing. Medium-high fluency. Success = shared control without being the Owner; clean approvals inbox. Concern: knowing what was sent externally on the family's behalf. Evidence: roles.ts canManage/canInvite, approvals model, Settings Owner-PIN. **Blocked runtime (needs multi-role session); code-traced.**

### Persona 4 — Lily Harper (Child View, age 9)
A child (`m-lily`, Child View) who should see only Home + Calendar, and Ask only if an adult enabled AI. Low fluency, supervised. Success = see her chores/schedule, never reach settings/connectors/approvals. Risk the product must honor: no exposure to sensitive spaces or external actions. Evidence: roles.ts isChild + SCOPED_SCREENS child=[dashboard,calendar], canUseAI gate. **Blocked runtime; role-gating code-verified (EV-139).**

### Persona 5 — Elaine Brooks (Grandparent / caregiving Guest-Helper)
An older caregiving contact (`m-elaine`, Guest/Helper, grandparent relationship) who sees Home + Ask + Calendar, may connect her own calendar, and needs large, calm, low-stimulation UI. Low technical fluency, accessibility-sensitive (a strong fit for Calm Mode). Success = help with pickups and appointments without touching household admin. Scenario variant: **Sam Rivera (babysitter/sitter)** — same Guest/Helper role, sitter view mode adds Connections. Evidence: roles.ts isGrandparent/isHelper, SCOPED_SCREENS grandparent/sitter, seed m-elaine/m-sam, Calm Mode. **Blocked runtime; code-traced + Calm Mode executed.**

## 8. Five end-to-end journey narratives and step tables

### JRN-1 — Maya creates a household on her phone (EXECUTED, 375x812)
1. Fresh load → onboarding "Welcome to FamiliOS", three cards (Create / Restore / Explore sample). *Pass* (EV-100).
2. "Create household" → wizard (household + owner name) → submit. Backend was mid-outage from ISS-001: `/api/household/claim` 500 with **no user-visible error**; landed at Lock showing "may need PIN". *Fail — silent degradation* (ISS-002, EV-119/120).
3. After backend restart (DEC-001), reload → Lock showed a **stranger's** profile ("Ross"), Maya's local household hidden. *Fail — orphaned* (ISS-003, EV-123/124).
4. Recovered via **email signup** (DEC-002) → healthy dashboard: hearth greeting "Good morning, Maya", calm empty states, 4 live connectors. *Pass* (EV-126).
5. Created a **Family Briefing Agent** from template → Active; opened the 11-tab detail drawer. *Pass* (EV-127).
6. "Run now" → run halts at **"Waiting for Approval / Paused — connect the required service"**, Gmail tool "Connect your Google account". *Pass — honest halt, strong* (EV-128).
7. "Ask FamiliOS" → chip "Plan three dinners…" → **"No AI provider is connected"** dead-end. *Fail vs local-first promise* (ISS-004, EV-130).
8. Workflow Builder → "built-in rules engine" → real automation created with **no provider**, but trigger "Manual" for "every morning at 7am". *Pass with defect* (ISS-005, EV-131/132).
9. Connections → readiness states all accurate; Weather "Current conditions" Run → **hollow `{location,fetchedAt}` success** (no temperature). *Fail vs no-fake-success* (ISS-006, EV-134/136).
10. Calm Mode on (data-calm, glow removed); 320px no overflow; desktop 1280 sidebar, no overflow; session persisted across reload. *Pass* (EV-129/137/142).
11. Settings → "Reset sample data" → 403, dead-ends at stranger Lock. *Fail* (ISS-003b, EV-138).

### JRN-2 — Alex Harper's populated morning (code-traced; runtime blocked)
Intended: sign in → dense dashboard (calendar, needs-you, bills, briefing, agents, activity) → run/approve → context-switch by space. Trace: dashboard tiles + space filter + briefing are wired to seed collections (EV-110); role rank Owner passes all `SCREEN_MIN_ROLE`. Blocked at sign-in on the claimed server; would run on an unclaimed server (HYP-001). Debrief hypotheses in §15.

### JRN-3 — Morgan invites the sitter and approves an action (code-traced; blocked)
Intended: Adult Admin → Household Spaces → invite Sam → set Owner PIN → approve a pending high-risk tool with Approve/Deny/Edit/Ask-changes. Trace: roles.ts canInvite/canManage, `/api/invites`, approvals model + double-decide race test green (EV-104). Blocked (needs multi-role session).

### JRN-4 — Lily (Child) is correctly fenced in (role-gating code-verified)
Intended: child session shows only Home + Calendar; Ask hidden unless an adult set `aiEnabled`; any attempt to reach settings/connectors is bounced with a toast. Verified in code: `SCOPED_SCREENS.child=[dashboard,calendar]`, `canUseAI` gate, App.tsx guard redirect+toast (EV-139/111). Runtime child session blocked; the *guard mechanism* is verified, the *rendered child experience* is not.

### JRN-5 — Elaine (Grandparent) helps with a pickup in Calm Mode (partial)
Intended: calm, low-stimulation grandparent view (Home + Ask + Calendar); accept a help request; connect her own calendar (sitter variant). Executed: Calm Mode flattening + glow removal verified (EV-129); grandparent SCOPED_SCREENS code-verified. Runtime grandparent session blocked. The "Ask for or offer help" surface was observed on the dashboard (EV-126) but not completed (needs a second member).

## 9. Visual and product design audit

- **Navigation:** clear five-group sidebar (desktop) and a 4+Ask bottom nav + drawer (mobile), advanced items (Skills/Functions) correctly hidden by default. Consistent, low-load. *Strong.*
- **Workflow:** onboarding → household → agents/automations is coherent; approval gating is legible ("proposes; you approve").
- **Layout & hierarchy:** the "Tactile Hearth" system is realized well — one ember CTA per view, one hearth panel, bento grid on desktop, generous spacing. Display serif (Fraunces) used with restraint for greetings/stats.
- **Components & containment:** shared `ui.tsx` primitives (Card/Drawer/Tabs/Badges) used consistently; agent detail drawer scrolls its 11 tabs cleanly.
- **Responsive:** no horizontal overflow at 320px (310px content) or 1280px (1270px); mobile bottom nav + drawer correct. *Strong.* (Short-height 1280x600 and zoom 125/150/200% not exercised — named gap.)
- **Accessibility (evidence-limited):** semantic headings, `role=switch`/`role=dialog`, aria-labels present; Calm Mode + reduced-motion are first-class; modal drawers focus-trap. Not a full WCAG pass. One a11y-tree quirk (empty h2) proved a false alarm on inspection (real textContent present).
- **System states:** empty states are calm and directional ("A calm day — nothing scheduled"). The **critical gap** is that *failure* states are indistinguishable from *empty* states (ISS-002).
- **Visual credibility & trust:** high — honest badges, redaction messaging, real safety disclaimers. Undercut only where the promise breaks (ISS-004/006).

## 10. Full-stack audit

- **Frontend architecture:** single large Zustand store (2763 lines) owns all app data + auth/session; route is a store field; lazy screens with a reload-once chunk-recovery guard. Clean typed API client. Debt: unused react-router-dom (ISS-010); very large store and 3214-line server file are maintainability risks (not defects).
- **Backend architecture:** dependency-free Node http, 74 route roots, per-tenant `node:sqlite` DBs with legacy-JSON→tenant migration + corruption quarantine (tests green, EV-104). Solid, unusually disciplined for an MVP.
- **State & data:** local-first IndexedDB is the client authority; server owns connectors/secrets/approvals/jobs/audit; `/api/backups` bridges them. The claimed-resident-tenant model is the root of the ISS-003 family.
- **APIs/events/jobs/providers:** honest readiness engine; in-process scheduler; webhook receiver with optional HMAC (prod rejects unsigned — EV-104); OAuth boundary returns honest setup_required.
- **Security & privacy:** AES-256-GCM vault, secrets redacted in responses, server-side gate is authority, kill switch present. Risks: unauthenticated pre-auth roster exposure incl. child ages/relationships (ISS-009); LAN IPs in `.env.example` (minor).
- **Reliability & performance:** 287/287 tests; but the test harness itself can corrupt live data (ISS-001). Perf not profiled (named gap).
- **Maintainability & operations:** strong docs and tests; deploy Node-pinning gap (ISS-007); CI blind to ISS-001 (ISS-008).

## 11. UI-to-Backend Trace Matrix

Full matrix in `audit/functionality-inventory.md` (12 reconciled rows). Representative truths:
- Agent "Run now" → `/api/runs/start` → engine → external step → `approval_required` → visible "Waiting for Approval". **UI truthfully represents authority.** *Pass.*
- Weather Run → `/api/tools/weather.current/execute` (200) → executor drops undefined temp → UI shows hollow success. **UI claims success before/without authoritative data.** *Fail (ISS-006).*
- Assistant send → `/api/ai/chat` (provider) → no local fallback → dead-end. **Backend capability (local engine) not exposed on this surface.** *Fail (ISS-004).*
- Reset sample → `loginAs(m-alex)` → server 403 → Lock(stranger). **Local action depends on a server actor that can't exist.** *Fail (ISS-003b).*

## 12. Convergence and misalignment map

- **Design ↔ architecture reinforce:** the honest readiness badges are backed by a real readiness engine; approval gating in the UI maps to real server-side approval records. (Preserve.)
- **Visual design communicates authority truth:** connector states, redaction copy, and "Waiting for Approval" all tell the true backend state. (Preserve.)
- **UI masks backend limitation:** the Weather tool renders success over a missing payload (ISS-006); onboarding renders health over total failure (ISS-002).
- **Backend complexity leaks into UI:** the claimed-resident-tenant model surfaces as a stranger's lock screen and orphaned households (ISS-003/003b); "Rename in src/brand.ts" tells a user to edit source.
- **Product language contradicts behavior:** "every task resolves locally" vs the Assistant provider dead-end (ISS-004).
- **Intended workflow lacks technical support:** "Explore the sample" / "Reset sample data" assume a server actor that a claimed tenant denies.
- **Technical capability lacks product expression:** the deterministic local engine (proven in the Workflow Builder) is absent from the headline Assistant chat.

## 13. Canonical Master Issue Register (ordered by severity and dependency)

Full detail: `audit/issue-register.md`. Ordered:

1. **ISS-001 (P0)** — Test suite corrupts live `server/.data` and wedges the running backend (`disk I/O error`). Found+recovered this run.
2. **ISS-002 (P1)** — First-run onboarding silently swallows total backend failure; misleading "may need PIN"; no mobile runtime affordance.
3. **ISS-003 (P1)** — Locally-created household orphaned/hidden on a claimed server; self-heal path unreachable.
4. **ISS-003b (P1)** — Same root cause: "Reset sample data" / "Explore the sample" dead-end at a stranger's lock on a claimed server.
5. **ISS-004 (P1)** — "Ask FamiliOS" chat dead-ends without a provider despite a working local engine elsewhere; contradicts local-first promise.
6. **ISS-006 (P2)** — Flagship Weather tool returns a hollow success instead of `provider_error`.
7. **ISS-005 (P2)** — Rules-engine builder ignores schedule phrasing (trigger "Manual" for "every morning at 7am").
8. **ISS-007 (P2)** — Incoherent Node version story + render.yaml pins no Node → production deploy risk.
9. **ISS-008 (P2)** — CI structurally cannot see ISS-001.
10. **ISS-009 (P2)** — Unauthenticated pre-auth household roster exposure (names/roles/relationships incl. child ages).
11. **ISS-010 (P3)** — Unused `react-router-dom` production dependency.

## 14. Accessibility, responsive, performance, security/privacy, resilience, content, and trust summaries

- **Accessibility (evidence-limited):** good semantics, aria roles, focus-trapped drawers, Calm Mode + reduced-motion first-class; NOT a full WCAG pass; keyboard-only and zoom 125/150/200% not exercised (gap).
- **Responsive:** no overflow at 320/375/1280; short-height and zoom untested (gap).
- **Performance:** not profiled (gap); bundle carries an unused router dep (ISS-010).
- **Security/privacy:** strong vault + redaction + server-authority + kill switch; weaknesses ISS-009 (roster PII) and minor LAN-IP leakage in `.env.example`.
- **Resilience:** excellent server test discipline (287/287) and migration/quarantine; undermined by ISS-001 (test-induced corruption) and the silent-failure UX (ISS-002).
- **Content & trust:** warm, honest, direction-not-mood copy; real safety disclaimers; trust breaks only where the four promise-integrity issues live.

## 15. Persona debrief (labeled synthetic hypotheses)

> Simulated, not real feedback.
- **Maya (executed):** "Setup looked friendly, but when something failed I couldn't tell — it just showed a stranger's name. Once I used email it worked and the approval step made me trust it." First improvement: *tell me when the runtime is down.* Wish: *let me try the sample without a login wall.*
- **Alex (hypothesis):** wants denser repeat-action shortcuts and reliable scheduled automations (ISS-005 would bite him). Wish: *space-scoped quick actions.*
- **Morgan (hypothesis):** wants a clear record of what was sent externally and a clean approvals queue. Concern: knowing the sitter's access is truly limited.
- **Lily (hypothesis):** should never see settings/connectors — the code fences her correctly; needs a visibly child-appropriate home.
- **Elaine/Sam (hypothesis):** Calm Mode is a genuine draw; wants only pickups/appointments and her own calendar, nothing else. Wish: *bigger text, fewer choices* (Calm Mode already helps).

## 16. Current comparator and research insights with citations

No external web research was run this session (comparators are inference from the domain). Closest analogues by function: shared family organizers (Cozi, Maple, Skylight) and local-first/agentic assistants. FamiliOS's credible differentiator vs those is its **honesty-first connector/approval model + local-first data ownership** — a defensible position *if* the four promise-integrity issues (ISS-002/003/004/006) are fixed, because they are precisely the moments a skeptical family would test the trust claim. (Sourced comparator research deferred — named gap; would strengthen §17.)

## 17. Opportunity register and novel-feature portfolio

Evidence-backed, traces to existing intent/data/capability; two paths compared where nontrivial:
- **OPP-1 (MVP): Local-first Assistant.** Route the Assistant chat through the existing deterministic engine when no provider is set (extends ISS-004 fix into a feature: the product's headline works offline). Path A: full local NLU; Path B: reuse `lib/ai.ts` intent/plan builders (preferred — lower risk, already proven). Serves all personas.
- **OPP-2 (near-term): Trust ledger.** Surface the existing audit log as a family-readable "what agents did / what was sent externally" view (Morgan's wish; backend already records it). High trust value, low new surface.
- **OPP-3 (near-term): Sample/Demo mode as a first-class client session** (generalizes the ISS-003b fix): a labeled, server-free "try it" mode — the strongest onboarding lever for a skeptical audience.
- **OPP-4 (later): Space-scoped quick actions** for power users (Alex) — reduce repetitive navigation using existing space filter + quick-action infra.
- **OPP-5 (later): Weather/briefing provenance** — once ISS-006 is fixed, show source + timestamp on briefing data (trust + decision support).

## 18. Prioritized remediation plan

- **Immediate P0/P1 stabilization:** WP-001 (test isolation), WP-002 (degraded-mode + claimed-server onboarding/sample), WP-003 (local Assistant + trigger fix).
- **Cross-layer MVP shaping:** OPP-1/OPP-3 fold naturally out of WP-003/WP-002.
- **Visual/interaction refinement:** distinguish failure vs empty states (part of WP-002); align suggestion chips (WP-003).
- **Architecture correction:** reconsider the single-claimable-resident-tenant model vs client-only local/sample sessions (WP-002 core).
- **Performance/reliability:** WP-004 (weather honesty), WP-005 (deploy Node pin, CI reproduction of ISS-001).
- **Deferred enhancements:** OPP-2/4/5; comparator research; full a11y/perf passes; the blocked role-gating runtime journeys.

## 19. Implementation-ready brownfield PRD

**Problem & evidence:** the product's trust promise (PI-005/006/007) breaks at first-run and on its two most honest-by-design surfaces (ISS-002/003/004/006), and its own tests can corrupt live data (ISS-001).
**Target users/personas:** §7 (Maya/Alex/Morgan/Lily/Elaine).
**Current behavior & root cause:** §11–§13 + issue register.
**Goals / measurable success / non-goals:** (a) `npm test` leaves `.data` byte-identical and server healthy; (b) 0 silent-failure first-run paths (every backend failure surfaces a status); (c) sample/local household reachable on a claimed server; (d) no-provider Assistant returns a local plan or scoped prompt (never a bare dead-end); (e) Weather tool never renders success without data. Non-goals: production deploy, new connectors, redesign.
**Scope / out-of-scope:** WP-001..005; out: mobile app changes, new integrations, visual redesign.
**Chosen solution & rejected alternatives:** see decision log (DEC-002/003/005) and each WP; e.g., mint local sessions for sample/local mode (rejected: forcing a server actor — the current bug).
**Target end-to-end journey:** fresh user → (backend up or down, always known) → working household or clearly-labeled local/sample mode → create agent → honest run → ask locally → build scheduled automation that actually fires.
**UX/content requirements (existing design system):** degraded banner uses amber attention vocabulary + role=status; failure vs empty copy distinct; sentence case; preserve Calm Mode.
**States to handle:** loading, empty, success, invalid, unauthorized, denied, offline, slow, error, retry, cancel, recovery, responsive, a11y, integration-unavailable (this is the crux — most already exist except honest *failure* surfacing).
**Frontend/back-end/data/security/observability/acceptance/validation/slices/rollout/rollback/risks:** enumerated per WP in `audit/implementation-queue.md`. Every acceptance criterion there is observable/testable.

## 20. Orchestrator-ready implementation work packages

Full detail: `audit/implementation-queue.md` — WP-001 (test isolation, P0), WP-002 (degraded-mode + claimed-server onboarding/sample, P1), WP-003 (local Assistant + trigger fix, P1), WP-004 (weather honesty, P2), WP-005 (deploy/privacy/debt hygiene, P2/P3). Each carries objective, IDs, files, thin slices, acceptance criteria, validation, risk, and rollback.

## 21. Numbered implementation menu and recommended bundle

Each option lists value · scope · dependencies · risk · effort · leverage · evidence.

1. **WP-001 — Stop tests corrupting live data (P0).** Value: eliminates a data-integrity/availability defect. Scope: `server/test/*`, `store.mjs`, CI. Deps: none. Risk: low. Effort: S. Leverage: high (protects every other change + any developer). Evidence: ISS-001/008, EV-116/117/118/122.
2. **WP-002 — Honest degraded-mode + fix claimed-server onboarding/sample (P1).** Value: repairs first-run trust and the "try it"/reset paths. Scope: store + Onboarding/Lock/Shell/Dashboard. Deps: none (coordinate roster trim with #5). Risk: medium. Effort: M. Leverage: high. Evidence: ISS-002/003/003b, EV-119..125/138.
3. **WP-003 — Local "Ask FamiliOS" fallback + fix rules-engine trigger (P1).** Value: makes the headline surface work offline; scheduled automations fire. Scope: Assistant/ai.ts/Automations. Deps: none. Risk: low-med. Effort: M. Leverage: high (headline). Evidence: ISS-004/005, EV-130/131/132/133.
4. **WP-004 — Weather connector fails honestly (P2).** Value: closes a "fake success" on the flagship connector. Scope: `connectors.mjs` weather executor. Deps: none. Risk: low. Effort: S. Leverage: medium. Evidence: ISS-006, EV-134/135/136.
5. **WP-005 — Deploy Node pin + roster privacy + drop dead dep (P2/P3).** Value: removes production deploy risk + PII exposure + bundle debt. Scope: render.yaml/package.json/README/ci.yml/`/api/profiles`. Deps: none. Risk: low. Effort: S-M. Leverage: medium. Evidence: ISS-007/009/010, EV-102/106/143.
6. **Full slate (WP-001→005).** Value: comprehensive stabilization. Risk: medium (sequenced). Effort: L. Leverage: highest overall.

### ★ Recommended bundle — "Trust at first contact" = Options 1 + 2 + 3 (WP-001 + WP-002 + WP-003)
A coherent vertical release that protects the product's core promise where it matters most: it stops the test-induced data corruption (P0), makes the first five minutes and the sample/reset paths honest and unbreakable (P1), and makes the headline "Ask FamiliOS" useful with no provider while fixing scheduled automations (P1). No architectural upheaval, no new dependencies, and each piece is independently shippable and testable. WP-004 and WP-005 are strong fast-follows.

**Which numbered improvement, feature, or recommended bundle should I implement now?**

## 22. Decision log and rejected alternatives

Full log: `audit/decision-log.md` (DEC-001..006). Key rejected alternatives: restarting both tiers (rejected — surgical backend-only restart preserved the session, DEC-001); claiming runtime role verification (rejected — fabrication; code-traced instead, DEC-003); dismissing the weather hollow-success as sandbox no-egress (rejected — host egress works + siblings do it right, DEC-005).

## 23. Remaining unknowns and next discriminating checks

Full queue: `audit/hypothesis-queue.md` (HYP-001..006). Top checks: (1) rerun onboarding/sample/role-switching on an UNCLAIMED server to confirm the ISS-003 family is claimed-tenant-specific and unblock role-gating journeys (HYP-001); (2) capture the server-side weather fetch status to pin the exact upstream trigger (HYP-003); (3) confirm `/api/profiles` exposure persists post-claim (HYP-004); (4) a single read-only GET on the Render URL if one is authorized, to resolve parity (HYP-006).

## 24. Evidence index

Full ledger: `audit/evidence-ledger.md` (EV-100..EV-143). Subtypes used: SS (screenshots, all inspected), DOM/CON/NET (emulator a11y/console/network), CODE (source), TEST/LOG/DATA (baseline + runtime + IndexedDB), plus decision links. Screenshots: SS-000 (bootstrap), SS-001 (onboarding), SS-002 (orphan lock), SS-003 (Maya dashboard), SS-004 (agent drawer), SS-005 (connections readiness), SS-006 (320px+Calm), SS-007 (desktop) — under `audit/evidence/`.

## 25. Screenshot gallery (inspected originals)

Under `.top-gun/runs/run-20260719-073933/audit/evidence/`:
- SS-000-bootstrap-mobile-onboarding.jpeg — first mobile screen (bootstrap).
- SS-001-onboarding-375.jpeg — onboarding, three cards, 375px.
- SS-002-lock-shows-server-profile-not-local-household.jpeg — ISS-003 orphaned lock (stranger "Ross").
- SS-003-maya-fresh-dashboard-375.jpeg — healthy dashboard after email signup, 4 live connectors, calm empty states.
- SS-004-agent-detail-drawer-heading.jpeg — Family Briefing Agent detail (11 tabs, safety limits).
- SS-005-connections-readiness-states.jpeg — honest connector readiness catalog (strength evidence).
- SS-006-connections-320-narrow-calm.jpeg — 320px narrow + Calm Mode active, no overflow.
- SS-007-dashboard-desktop-1280.jpeg — desktop bento + grouped sidebar + runtime pill.
- backend-restart-log.txt — ISS-001 recovery evidence.
(No annotated copies were produced this run; originals are sufficient for every cited callout.)
