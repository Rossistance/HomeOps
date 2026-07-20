# App Functionality Inventory — apps/mobile (run-20260719-232201)

Denominator = every discoverable capability of the native app at HEAD ffcfa33 (screen + API surface). Evidence lanes available this run: source trace (all features), local backend API (server-authority verification), screenshots (field evidence, builds 13/19). **Native iOS rendering/interaction verification is blocked for every feature** (appium/appetize drivers blocked) — no feature is claimed natively verified; "verified" below means the feature's *authority layer* (server + client code contract) was verified in the current run.

## Features

| FEAT-ID | Name | Role | Surface | Prerequisite state | Status | Persona coverage | Evidence IDs | Issue IDs |
|---|---|---|---|---|---|---|---|---|
| FEAT-01 | Sign-in (profile picker, PIN, email, invites) | all | Lock.tsx, /session /login /signup /invites | claimed household | partial (API login verified; native UI blocked) | JRN-2,JRN-3 | EV-NET-01, EV-CODE-02 | — |
| FEAT-02 | Today home (adult/owner) | Owner/Adult | (home)/index.tsx | session | partial (code-traced; help cards logic verified) | JRN-1,JRN-4 | EV-CODE-10, EV-SS-02 | ISS-001 |
| FEAT-03 | Child home | Child View | (home)/kid.tsx | child member | partial (role gates API-verified; UI blocked) | JRN-5 | EV-NET-02 P5, EV-CODE-11 | — |
| FEAT-04 | Grandparent home | grandparent view | (home)/grandparent.tsx | grandparent relationship | partial (card logic verified vs field SS) | JRN-2 | EV-SS-09/10, EV-CODE-10 | ISS-001, ISS-009 |
| FEAT-05 | Sitter home | Guest/Helper | (home)/sitter.tsx | sitter relationship | partial (shares HelpRequestsSection) | JRN-3 | EV-CODE-10 | ISS-001 |
| FEAT-06 | Calendar (agenda/month, 3 layers, colors) | Limited+ | (home)/calendar.tsx | events | partial (code-traced) | JRN-1 | EV-CODE-01 | ISS-004/005 |
| FEAT-07 | Event create | Limited+ | event-form.tsx, POST /events | session | **verified (authority)** — server CRUD + model probed | JRN-1 | EV-CODE-01/07, EV-NET-02 | ISS-004/005/006/007 |
| FEAT-08 | Event edit/delete (canonical + linked-Google two-way) | Limited+/adult | event-form.tsx, PATCH/DELETE /events/:id | event exists | **verified (authority)** | JRN-1 | EV-CODE-07, EV-NET-02 P2 | ISS-008 |
| FEAT-09 | Google push/pull + conflict resolve | Adult | /calendar/push/:id, pull-google-edits | Google account | partial (payload contract code-verified; live call forbidden) | JRN-1 | EV-CODE-04, EV-NET-02 P3 | ISS-003, ISS-008 |
| FEAT-10 | Calendar subscriptions (ICS/Google/paste) | Limited+ | (settings)/connections.tsx | — | executed (code-traced only) | — | EV-CODE-02 | — |
| FEAT-11 | Help send (ask/offer, link event/task, free-busy hint) | all | (home)/help.tsx, POST /help-requests | ≥2 members | **verified (authority)** | JRN-2,JRN-4 | EV-NET-01, help.tsx | ISS-010 |
| FEAT-12 | Help respond/cancel | recipient | /respond /cancel | pending request | **verified (authority)** — including the missing-reassignment defect | JRN-2,JRN-4 | EV-NET-01, EV-CODE-03 | **ISS-001** |
| FEAT-13 | Tasks & lists (view/add/complete/delete, groups) | Limited+ | (settings)/tasks.tsx | session | **verified (authority)** | JRN-1,JRN-5 | EV-CODE-06, EV-NET-01 | ISS-011 |
| FEAT-14 | Task EDIT (title/due/assignee/priority) | — | absent on mobile (server PATCH exists) | — | fail (feature gap confirmed) | JRN-1 | EV-CODE-06 | **ISS-011** |
| FEAT-15 | Meals + groceries (plan, to-calendar, to-grocery) | Limited+ | (settings)/meals.tsx, groceries.tsx | — | executed (code-traced only) | — | EV-CODE-02 | — |
| FEAT-16 | Library files (list/search/preview/delete, spaces grid) | Adult upload; all view | (library)/index.tsx | files | **verified (authority)** | JRN-1 | EV-CODE-05, EV-NET-01 | ISS-002 |
| FEAT-17 | Upload (camera/Photos/Files, front+back pages, sensitive) | Limited+ | upload-sheet.tsx, POST /files | permissions | **verified (authority)** — durable, cap honest | JRN-1 | EV-NET-01, EV-CODE-05 | **ISS-002** |
| FEAT-18 | Knowledge/memory/artifacts (CRUD where allowed) | Limited+ | (library)/index.tsx | — | executed (code-traced only) | — | EV-CODE-02 | — |
| FEAT-19 | Ask Famili chat (durable conversations, plans, builds, runs) | all (child gated) | (ask)/index.tsx, /assistant /conversations /runs | AI provider | partial (honesty policy code-verified; live AI not probed) | JRN-4 | EV-CODE-08, EV-SS-11/12 | ISS-012 (roadmap) |
| FEAT-20 | Agents (list/run/pause/duplicate/delete) | Adult Admin | (agents)/, /agents | — | executed (code-traced only) | — | EV-CODE-02 | — |
| FEAT-21 | Automations/triggers (+test run progress) | Adult Admin | (settings)/automations.tsx | — | executed (code-traced only) | — | EV-CODE-02 | — |
| FEAT-22 | Approvals inbox + risk overrides | Adult | (home)/inbox.tsx, /approvals /risk-overrides | pending approvals | executed (code-traced only) | JRN-1 | EV-CODE-01 | — |
| FEAT-23 | Household settings (members, invites, rename, avatar, roles) | Owner/Admin | (settings)/index.tsx, /members /invites | — | **verified (authority)** — member CRUD probed | JRN-2 | EV-NET-01/02 | — |
| FEAT-24 | Connections (Google OAuth start, providers) | varies | (settings)/connections.tsx, /oauth /providers | — | executed (code-traced; OAuth forbidden) | — | EV-CODE-02 | — |
| FEAT-25 | Contact methods + verification loop | adults/self | (settings)/contacts.tsx | — | executed (code-traced only) | — | EV-CODE-02 | — |
| FEAT-26 | AI provider config/health/activate | Adult Admin | (settings)/ai.tsx | — | executed (code-traced only) | — | EV-CODE-02 | — |
| FEAT-27 | Playbooks browse | all | (settings)/playbooks.tsx | — | executed (code-traced only) | — | EV-CODE-02 | — |
| FEAT-28 | Push notifications + in-app notifications | all | /push-tokens /notifications | device token | blocked (native push needs device) | — | EV-CODE-02 | — |
| FEAT-29 | Offline task queue + replay | all | lib/offline-queue.ts | offline | executed (code-traced only) | — | api.ts:229 | — |
| FEAT-30 | Activity / audit view + evolutions review | Adult | (home)/activity.tsx, /audit /evolution | — | executed (code-traced only) | — | EV-CODE-02 | — |

## UI-to-Backend Trace Matrix (meaningful actions on the audited surfaces)

| FEAT | UI control | Frontend component/state | Request | Endpoint/handler | AuthZ | Domain logic | Data mutation | Response contract | Visible status | Parity (prod vs local) | Recovery | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-07 | `Add event` | event-form state {day,start,hasEnd,end,…} | POST /api/events | index.mjs:1237 | Limited+ | stamp(day,time) client-side collapses span to one day | events.json put | {event} | haptic + router.back(); errors → Notice | unresolved (prod not probed) | Notice on error | verified-authority | EV-CODE-01/07 |
| FEAT-08 | `Save changes` | same, isEdit | PATCH /api/events/:id | index.mjs:1259 | adult/owner; linked=own-Google-only | patch provided keys; notes preserved | events.json | {event} / stale_write 409 | haptic+back; 409 unhandled distinctly on mobile (generic message) | unresolved | refetch on focus | verified-authority | EV-NET-02 P2 |
| FEAT-09 | `Update in Google` | push() approval flow | POST /api/calendar/push/:id | index.mjs → calendar.mjs:338 | Adult+ approval | payload {summary, description:=notes, dateTime, location} — whatToBring dropped | Google event + provenance | {ok,googleEventId,action} / needsApproval / errors | Notice with mapped messages | unresolved | error notices | partial (contract-verified; live forbidden) | EV-CODE-04, EV-NET-02 P3 |
| FEAT-12 | `I can help` | HelpRequestsSection respond() | POST /help-requests/:id/respond | index.mjs:1421 | recipient only | status:=accepted + notify — **no task PATCH** | help-requests.json only | {helpRequest} | card flips to "You're helping X" (forever, max 3) | unresolved | reload on focus | **fail — ISS-001** | EV-NET-01, EV-CODE-03/10 |
| FEAT-11 | `Ask/Offer …` | help.tsx send() | POST /help-requests | index.mjs:1395 | any session | no dedupe per task/recipient | help-requests.json | {helpRequest} | haptic + back | unresolved | Notice | verified-authority (dedupe gap noted) | EV-NET-01 |
| FEAT-17 | `Upload & file` | upload-sheet submit() | POST /api/files | index.mjs:2236 | Limited+ | base64 cap/page; tags from space choice (default = none) | files.json + blobs | {file} / 413 / 403 | ~800 ms flash → sheet closes; list refresh | unresolved | error Notice persists | verified-authority; feedback gap ISS-002 | EV-NET-01, EV-CODE-05 |
| FEAT-13 | checkbox toggle | tasks.tsx toggle() | PATCH /api/tasks/:id | index.mjs:1352 | assignee may set status; adults edit all | patch | tasks.json | {task} | animated check | unresolved | offline queue replay | verified-authority | EV-NET-01 |
| FEAT-14 | tap on task row | Pressable **without onPress** | — none — | — | — | — | — | — | nothing happens | n/a | n/a | **fail — ISS-011** | EV-CODE-06 |
| FEAT-03 | child write attempts | kid view gates | POST /events, /files | gate() | Child View floor | 403 insufficient_role | none | {error} | UI hides buttons (cosmetic) + server enforces | unresolved | — | verified-authority | EV-NET-02 P5 |

## Coverage

```
Execution coverage: 30/30 = 100%   (every in-scope feature investigated through the safely available lanes: source trace for all; local-API runtime for 9)
Verified coverage:  9/30  = 30%    (authority-layer verified via current-run runtime evidence: FEAT-01*,07,08,11,12,13,16,17,23 — *login only; native rendering verified for NOTHING — all native claims are code-traced, labeled native-verification-blocked)
Persona coverage:   14/30 = 47%    (features exercised by ≥1 of the five persona journeys JRN-1..5)
```

Blocked lanes (never counted as verified): native iOS rendering/interaction (appium-device-cloud, appetize-sim — credentials + simulator build absent; unblock = user supplies BROWSERSTACK_* or APPETIZE_* env + EAS artifacts); push notifications end-to-end (real device); live Google mutation (forbidden by mission authority); production backend behavior (forbidden — live family data).
