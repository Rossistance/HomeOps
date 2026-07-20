# App Functionality Inventory

Populated by audit-lead, run-20260719-073933. Denominator built from `src/App.tsx` SCREENS map, `src/components/Shell.tsx` NAV_GROUPS, screen tab definitions, `src/miniapps/index.tsx`, and the 74 backend route roots in `server/index.mjs`. In-scope = web app at mobile viewport (primary) + desktop comparison + backend behavior reachable through it without external side effects. `apps/mobile` and `mobile-version/` are code-review-only (not in the execution denominator). Status vocabulary: pass / fail / partial / blocked / not-applicable / unreachable / pending (pending = not yet attempted; none may remain at completion).

## Features

| FEAT-ID | Name | Role | Surface | Prerequisite state | Status | Persona coverage | Evidence IDs | Issue IDs |
|---|---|---|---|---|---|---|---|---|
| FEAT-001 | Onboarding: welcome + Create household path | any (fresh) | /onboarding | fresh browser state | pass | JRN-1 | EV-100,EV-119 | ISS-002 |
| FEAT-002 | Onboarding: Restore a backup path | any (fresh) | /onboarding | fresh + backup file | pending | | EV-120 | |
| FEAT-003 | Onboarding: third path (explore sample household) | any (fresh) | /onboarding | fresh | fail | JRN-1 | EV-138 | ISS-003b |
| FEAT-004 | Onboarding: member/household setup steps (names, members, spaces) | Owner | /onboarding wizard | create-household chosen | partial | JRN-1 | EV-119,EV-124 | ISS-002,ISS-003 |
| FEAT-005 | Lock screen: profile picker login (+PIN where set) | all roles | Lock | onboarded household | partial | JRN-1 | EV-123,EV-125 | ISS-003 |
| FEAT-006 | Lock screen: email sign-in / sign-up mode | Owner/adult | Lock | backend online | pass | JRN-1 | EV-126,EV-142 | |
| FEAT-007 | Session: logout / switch profile | all roles | sidebar/Shell | signed in | partial | JRN-1 | EV-140 | |
| FEAT-008 | Role guard: scoped roles bounced from restricted screens | child/grandparent/sitter | App.tsx guard | scoped session | blocked | | EV-139 | |
| FEAT-010 | Dashboard: hearth/briefing + Ask well | all | dashboard | session | pass | JRN-1 | EV-126 | |
| FEAT-011 | Dashboard: bento tiles (urgent, agents, approvals, events, quick actions) deep-link correctly | all | dashboard | seeded data | partial | JRN-1 | EV-126 | |
| FEAT-012 | Command bar (⌘K): search + navigate + run commands | all | global | session | pass | JRN-1 | EV-141 | |
| FEAT-013 | Space filter (topbar select) scopes lists | all | global topbar | spaces exist | pending | | | |
| FEAT-014 | Calm Mode toggle (visual flattening, persisted) | all | topbar + settings | — | pass | JRN-1 | EV-129 | |
| FEAT-015 | Mobile bottom nav (4 primary + Ask) + drawer nav | all | mobile shell | 375px viewport | pass | JRN-1 | EV-110,EV-141 | |
| FEAT-016 | Runtime pill: backend online/offline state honest | all | sidebar/drawer | — | partial | JRN-1 | EV-140 | ISS-002 |
| FEAT-020 | Assistant (Ask FamiliOS): chat send/respond | all (child gated by aiEnabled) | assistant | session | fail | JRN-1 | EV-130 | ISS-004 |
| FEAT-021 | Assistant: NL → agent/workflow build ("build" flow with streaming) | adult+ | assistant | backend online | pending | | EV-133 | |
| FEAT-022 | Assistant: conversation persistence across refresh | all | assistant | prior chat | partial | JRN-1 | EV-142 | |
| FEAT-030 | Agents list + status chips + search/filter | adult+ | agents | seeded agents | pass | JRN-1 | EV-127 | |
| FEAT-031 | Agent create from template | Adult Admin+ | agents → New | templates catalog | pass | JRN-1 | EV-127 | |
| FEAT-032 | Agent create from plain English (plan preview → approve) | Adult Admin+ | agents → New → prompt | backend online | pending | | EV-133 | |
| FEAT-033 | Agent detail: 11 tabs (overview/settings/instructions/connections/triggers/memory/files/runs/permissions/capabilities/versions) | adult+ | agents/:id drawer | agent exists | partial | JRN-1 | EV-127 | |
| FEAT-034 | Agent actions: run now, pause/resume, archive | Adult Admin+ | agent detail | agent exists | partial | JRN-1 | EV-128 | |
| FEAT-035 | Agent run produces run record + activity + (if external step) approval | adult+ | agents/runs | agent runnable | pass | JRN-1 | EV-128 | |
| FEAT-040 | Automations list + enable/disable | adult+ | automations | seeded automations | pass | JRN-1 | EV-131 | |
| FEAT-041 | Automation create/edit (trigger + steps) | Adult Admin+ | automations | — | partial | JRN-1 | EV-131 | ISS-005 |
| FEAT-042 | Workflow Builder: NL → plan preview → create automation | Adult Admin+ | automations → builder | backend online | pass | JRN-1 | EV-131,EV-132 | ISS-005 |
| FEAT-043 | Automation templates gallery → instantiate | adult+ | automations → templates | catalog | partial | JRN-1 | EV-131 | |
| FEAT-044 | Automation test-run + run history + live monitor | adult+ | automations → live/history | automation exists | pending | | | |
| FEAT-045 | Triggers tab (advanced): event triggers list/fire | adult+ (advanced) | automations → triggers | advanced mode on | pending | | | |
| FEAT-046 | Browser Workflows tab (advanced): honest runtime status + login handoff | adult+ (advanced) | automations → browser | advanced mode | partial | JRN-1 | EV-137 | |
| FEAT-047 | Background Jobs tab (advanced): scheduler status + run-now | adult+ (advanced) | automations → sandbox | backend online | pending | | | |
| FEAT-050 | Skills list + detail (advanced) | adult+ (advanced) | skills | advanced mode | pending | | | |
| FEAT-051 | Recipes tab (playbooks read-only) + legacy playbooks deep-link lands here | adult+ | skills → recipes | catalog | pending | | | |
| FEAT-052 | Functions screen (advanced): function list/draft/tool catalog | adult+ (advanced) | functions | advanced mode | pending | | | |
| FEAT-060 | Connections catalog by category + readiness states honest | adult+ (canConnect) | connections | backend online | pass | JRN-1 | EV-137 | |
| FEAT-061 | Connector configure (e.g. Weather location, RSS URL) + scopes view | adult+ | connections detail | backend online | partial | JRN-1 | EV-134 | |
| FEAT-062 | Connector tool run: read tool executes real (Weather) | adult+ | connections/agents | weather live | fail | JRN-1 | EV-134,EV-136 | ISS-006 |
| FEAT-063 | Connector write tool → approval_required (no fake success) | adult+ | any write tool path | unconfigured/risky tool | pass | JRN-1 | EV-128 | |
| FEAT-064 | OAuth start honest setup_required without credentials | adult+ | connections (Gmail/GCal) | no creds configured | partial | JRN-1 | EV-137 | |
| FEAT-065 | Webhook receiver: inbound event visible in UI | adult+ | connections/webhook | backend online | pending | | EV-104 | |
| FEAT-066 | Kill switch blocks write/send tools backend-side | Owner/admin | settings | backend online | partial | JRN-1 | EV-140 | |
| FEAT-070 | Messages inbox: threads, unread badges, reply to agent | all (scoped) | messages → inbox | seeded threads | pending | | | |
| FEAT-071 | Approvals inbox: approve / deny / edit-before-approve / ask-changes | Adult Admin+ | messages → approvals | pending approval exists | pending | | | |
| FEAT-072 | Contacts tab: contact methods + verification state | adult+ | messages → contacts | seeded contacts | pending | | | |
| FEAT-080 | Meals: week plan view + add/edit meal + sync | adult+ | meals | seeded meals | pending | | | |
| FEAT-081 | Meals: recipe import from URL (JSON-LD parse) | adult+ | meals | backend online | pending | | | |
| FEAT-090 | Calendar: month/week/day views + event create/edit/delete | adult+ (canEditCalendar) | calendar | seeded events | pending | | | |
| FEAT-091 | Calendar: ICS import + subscriptions | adult+ | calendar | backend online | pending | | | |
| FEAT-092 | Calendar: Google connect honest setup state + sync-all | adult+ | calendar | no creds | pending | | | |
| FEAT-093 | Calendar: recurring events (rrule) render + edit | adult+ | calendar | recurring seed | pending | | | |
| FEAT-100 | Files: upload, metadata, tags, sensitive flag | adult+ (canUpload) | files → files | session | pending | | | |
| FEAT-101 | Knowledge library: add/edit items, custom instructions, family facts | adult+ | files → knowledge | seeded knowledge | pending | | | |
| FEAT-110 | Mini Apps: Chore Board (kanban add/move/complete, persist) | all | miniapps | seeded | pending | | | |
| FEAT-111 | Mini Apps: Budget Snapshot (add rows/budgets, persist) | adult+ | miniapps | seeded | pending | | | |
| FEAT-112 | Mini Apps: Trip Planner (edit, persist) | adult+ | miniapps | seeded | pending | | | |
| FEAT-113 | Mini Apps: generate new mini app (NL → generated app) | Adult Admin+ | miniapps → generate | backend online | pending | | | |
| FEAT-120 | Household Spaces: spaces tab (create/edit spaces, membership) | Adult Admin+ | spaces → spaces | seeded spaces | pending | | | |
| FEAT-121 | Members tab: invite member, edit member/profile/avatar/color | Adult Admin+ | spaces → members | session | pending | | | |
| FEAT-122 | Roles & Access tab: role capability matrix + role editing | Owner/Admin | spaces → roles | members exist | pending | | | |
| FEAT-123 | Member PIN / profile editor | member self/admin | spaces → members | member exists | pending | | | |
| FEAT-130 | Activity log timeline + filtering | adult+ | activity → activity | seeded activity | pending | | | |
| FEAT-131 | Memory: add/edit/delete/approve memories, sensitive scoping, search | adult+ | activity → memory | seeded memories | pending | | | |
| FEAT-132 | Improvements (evolution proposals): review/approve | Owner/Admin | activity → improvements | proposals exist | pending | | | |
| FEAT-140 | Settings: profile & session section | all | settings | session | pass | JRN-1 | EV-140 | |
| FEAT-141 | Settings: backend runtime status + connectors summary | adult+ | settings | — | pass | JRN-1 | EV-140 | |
| FEAT-142 | Settings: AI providers (BYO key) honest states | Owner/Admin | settings → AI | backend online | partial | JRN-1 | EV-140 | |
| FEAT-143 | Settings: privacy, notifications, appearance/branding | adult+ | settings | — | pass | JRN-1 | EV-140 | |
| FEAT-144 | Settings: comfort & accessibility (Calm Mode etc.) | all | settings | — | pass | JRN-1 | EV-140,EV-129 | |
| FEAT-145 | Settings: advanced mode toggle reveals Skills/Functions/advanced tabs | adult+ | settings → advanced | — | partial | JRN-1 | EV-140 | |
| FEAT-146 | Settings: local data & backup (export/import JSON, reset to Harper sample, erase & start fresh) | Owner/Admin | settings → data | — | fail | JRN-1 | EV-138,EV-140 | ISS-003b |
| FEAT-147 | Settings: risk & approvals overrides | Owner/Admin | settings | backend online | partial | JRN-1 | EV-140 | |
| FEAT-148 | Settings: safety & disclaimers copy | all | settings | — | pass | JRN-1 | EV-140 | |
| FEAT-150 | PWA: manifest + service worker registered; refresh mid-flow safe | all | global | dev build caveat | partial | JRN-1 | EV-142 | |
| FEAT-151 | Responsive: 375x812 primary, 320x700 narrow, 1280x800 desktop, 1280x600 short | all | global | — | partial | JRN-1 | EV-137 | |
| FEAT-152 | Empty states: fresh household (no seed) shows guidance not blanks | all | all screens | fresh path | pass | JRN-1 | EV-126 | |
| FEAT-153 | Failure states: backend stopped → honest offline degradation | all | global | backend down (opportunistic via ISS-001 outage) | partial | JRN-1 | EV-119,EV-121 | ISS-002 |
| FEAT-154 | Broken-link sweep: footer/legal links (Privacy Policy, SMS Terms, Support), all nav destinations, deep links | all | global | — | pass | JRN-1 | EV-133 | |
| FEAT-160 | Backend: auth routes (signup/login/session/password-reset/verify-email) via UI | mixed | api | backend online | pending | | | |
| FEAT-161 | Backend: household claim + invites flow via UI | Owner→invitee | api | invite token | pending | | | |
| FEAT-162 | Backend: backups push/restore roundtrip via Settings | Owner/Admin | api | backend online | pending | | | |
| FEAT-163 | Backend: audit log records tool attempts (visible in UI or api read) | Owner/Admin | api/settings | tool run attempted | pending | | | |
| FEAT-164 | Backend: SMS webhook + gateway (code review only — no SMS sends) | n/a | server/sms.mjs | out of exec scope | pending | | | |
| FEAT-165 | Backend: RevenueCat webhook (code review only) | n/a | server route | out of exec scope | pending | | | |
| FEAT-166 | CI/CD: .github workflows + render.yaml correctness (Track B review) | n/a | repo | — | partial | | EV-143 | ISS-007,ISS-008 |
| FEAT-167 | Expo mobile app parity (code review only) | n/a | apps/mobile | — | partial | | EV-143 | ISS-007 |

## UI-to-Backend Trace Matrix

Meaningful actions reconciled UI→authority this run. Parity column: prod unverified (no deployed URL probed); all rows are local-runtime evidence.

| FEAT-ID | UI control | Frontend component/state | Request/IPC | Endpoint/handler | AuthZ rule | Domain logic | Data mutation | Response contract | Visible status | Parity | Recovery | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-004 | "Create household" submit | Onboarding → store.completeOnboarding("create") | POST /api/household/claim | index.mjs:590 claim handler | origin-gated, one-time (seed-roster only) | archive demo roster, register owner, createSession | tenant DB member + session cookie | `{member,session}` +set-cookie | routed to Lock then dashboard | local only | on 409 already_claimed → loginAs fallback | partial (works on unclaimed; ISS-003 on claimed) | EV-119,EV-125,EV-124 |
| FEAT-006 | Email "Create household"/"Sign in" | Lock → store.signupHousehold/loginWithEmail | POST /api/signup, /api/login, /api/session | index.mjs signup/login | password (≥8), invite token opt | new tenant DB, session | tenant row + cookie | `{session}` or typed error | dashboard on success | local only | typed errors surfaced (email_taken, weak_password) | pass | EV-126,EV-142 |
| FEAT-031 | Agent template card | Agents modal → store.addAgent | (local store; server sync on run) | — (local-first create) | client canManage; server gate on run | seed agent from template | IndexedDB appdata.agents | local state | agent appears Active | local only | n/a | pass | EV-127 |
| FEAT-034/035 | Agent "Run now" | Agents drawer → store.runAgent → runtime.ts | POST /api/runs/start (+ approvals) | index.mjs runs/approvals | server session; risk→approval | run engine; external step → approval_required | run record + approval + audit | run row "Waiting for Approval" | honest "Paused — connect the required service" | local only | approve/deny in Messages | pass (honest halt) | EV-128 |
| FEAT-042 | Workflow Builder "built-in rules engine" | Automations → lib/ai.ts deterministic planner | (local; no provider) | — | client | detectIntent/detectApprovalGates; creates automation | IndexedDB appdata.automations | automation created Enabled | card shows plan | local only | n/a | pass w/ defect (trigger=Manual, ISS-005) | EV-131,EV-132 |
| FEAT-020 | Assistant suggestion chip / send | Assistant → ai chat path | POST /api/ai/chat (provider) | index.mjs ai/chat | server session | provider router (no local fallback for chat) | conversation record | "No AI provider is connected" | dead-end (ISS-004) | local only | add provider in Settings | fail (dead-end vs local-first promise) | EV-130 |
| FEAT-062 | Weather "Current conditions" Run | Connections drawer → api.executeTool | POST /api/tools/weather.current/execute | connectors.mjs:397 executor | server session (401 unauth) | fetch Open-Meteo, map current | none (read) | `{location,fetchedAt}` (temp dropped) | hollow success (ISS-006) | local only | none surfaced | fail (fake success vs promise) | EV-134,EV-136 |
| FEAT-060 | Connections catalog render | Connections → store.connectors | GET /api/connectors, /api/providers | index.mjs connectors | server session | readiness computation | none | live/local-only/setup-required/runtime-not-connected badges | honest, accurate | local only | health check button | pass (strength) | EV-137,EV-134 |
| FEAT-146 | Settings "Reset sample data" | Settings → store.reseed → loginAs(m-alex) | POST /api/login (m-alex) | index.mjs login | server gate: unknown_actor on claimed | reseed local; login attempt | IndexedDB Harper sample | 403 /api/session → Lock(stranger) | broken on claimed (ISS-003b) | local only | none | fail (dead-end) | EV-138 |
| FEAT-014 | Calm Mode toggle | Shell CalmToggle → prefs.useCalmMode | (local; data-calm on html) | — | client | toggle + persist | localStorage | data-calm=true; glow display:none | pass | local only | persists reload | pass (strength) | EV-129(calm),transcript |
| FEAT-151 | Viewport resize 320/1280 | AppShell responsive classes | — | — | — | breakpoints | none | no horizontal overflow (320 & 1280) | pass | local only | n/a | pass | transcript(320:310px,1280:1270px) |
| FEAT-154 | Footer legal links | contentinfo links | GET /privacy.html,/terms.html (static) | vite static / dist | public | — | none | 200 static files exist | pass (not dead) | local only | n/a | pass | EV-133 |

## Coverage

```
Execution coverage: 40/82 = 49%   (features exercised in the emulator or via direct runtime/code proof this run)
Verified coverage:  24/82 = 29%   (UI behavior + matching implementation/data evidence, pass or documented fail)
Persona coverage:   40/82 = 49%   (exercised by >=1 canonical persona; only P1 Maya executed a live journey this run)
```

Coverage honesty notes:
- One canonical persona (P1 Maya) executed a real end-to-end live journey; personas P2–P5 are evidence-grounded and code-traced but their DISTINCT runtime paths (populated-data power use, child/grandparent/sitter role-gating, admin invite management) were BLOCKED this run by the claimed-server state (ISS-003 family) which prevents minting child/grandparent/sitter/other-owner sessions against the resident tenant. Unblock: an UNCLAIMED server (fresh `server/.data`) or a seeded multi-role roster, then switch profiles. This is named, not counted as verified.
- FEAT-164 (SMS), FEAT-165 (RevenueCat) are code-review-only by authority boundary (no external sends) — not executed.
- FEAT-153 (backend-down degradation) was OBSERVED opportunistically (the ISS-001 outage) but not deliberately re-run; counted as partial.
- ~42 features remain pending/blocked (Meals, Calendar CRUD, Files upload, Knowledge, Mini Apps kanban, Messages/Approvals decision flow, Household Spaces roles matrix runtime, Activity/Memory, Skills/Functions advanced tabs, OAuth honest-state click-through). Each is reachable; the gap is journey time/budget and the role-session blocker, not a product blocker. Named here so coverage is not overclaimed.
