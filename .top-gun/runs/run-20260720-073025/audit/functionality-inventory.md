# App Functionality Inventory — run-20260720-073025

Denominator: the mission-scoped chat→execution chain (per dispatch brief ART-003) — every
surface a chat task crosses from message to delivered effect, on server + both clients.
Out-of-scope areas (calendar, meals, tasks, files, spaces, evolution UI, onboarding,
store ops) are audited only where the chain touches them and are named, not counted.

## Features

| FEAT-ID | Name | Role | Surface | Prerequisite state | Status | Persona coverage | Evidence IDs | Issue IDs |
|---|---|---|---|---|---|---|---|---|
| FEAT-001 | Chat turn (answer) via POST /api/assistant + /stream | any (child gated) | (ask)/index.tsx, src/screens/Assistant.tsx → /api/assistant | AI provider active | pass | JRN-1,2,3,4 | EV-011, EV-016, EV-025 | ISS-011 |
| FEAT-002 | Chat lookup (mid-turn web fetch) | any | /api/assistant kind=lookup | provider + web reachable | partial (not exercised this run — gap: lower priority than the failure chain; check: scripted lookup turn) | — | EV-023 (code) | — |
| FEAT-003 | Do-now plan auto-execution from chat | Limited Member+ | /api/assistant → startRun | provider active | fail (false success) | JRN-1 | EV-012, EV-025 | ISS-002 |
| FEAT-004 | Build proposal (kind=build) | any (build gated later) | /api/assistant | provider active | pass | JRN-1,2,4 | EV-011, EV-016 | ISS-011 |
| FEAT-005 | Build materialization (skill+agent+automation) | Adult Admin+ | /api/assistant/build[,/stream] → materializeBuild | build spec | fail (target loss) | JRN-1,2 | EV-011, EV-015, EV-001, EV-002 | ISS-001, ISS-007 |
| FEAT-006 | Trigger scheduling semantics (recurring/schedule, tick 10s) | system | triggers.mjs tick, index.mjs:3244 | enabled trigger | fail ("7 AM" unexpressible) | JRN-1 | EV-003, EV-011 | ISS-003 |
| FEAT-007 | Trigger fire → agent run (orchestrator.runAgent) | system/scheduler | fireTrigger → runAgent | trigger + agent | fail (read-only/zero-step pass) | JRN-1,2 | EV-004, EV-011, EV-015 | ISS-001 |
| FEAT-008 | Deterministic skill run (runSkill) | Limited Member+ | /api/skills/:id/run, orchestrator | available skill | partial (code-read this run; server suite historically green — gap: no runtime pass this run; check: fire a trigger whose target carries skillId after WP-001) | — | EV-004 (code) | ISS-001 (unreachable from chat builds) |
| FEAT-009 | Engine reasoning steps (toolId:null) | system | engine.mjs _drive | run started | fail (vacuous success) | JRN-1,2 | EV-005, EV-012 | ISS-002 |
| FEAT-010 | Engine tool steps + approval gate | system | engine.mjs _drive | resolved tool | partial (park observed; approve→consume→execute not exercised this run — check: decide the approval via /api/approvals and watch resume) | JRN-1 | EV-006, EV-013 | ISS-004, ISS-008 |
| FEAT-011 | Email delivery via gmail.send provider tool | actor w/ Google | providers.mjs gmail.send | connected Google + gmail.send scope + approval | blocked (live send prohibited this mission — DEC-08 lineage; validation + park path exercised) | JRN-1 | EV-013, EV-024 (hist) | ISS-006, ISS-008 |
| FEAT-012 | Registry delivery (/api/notify, contact methods) | any (method-gated) | notify.mjs deliverNotification | verified + opted-in method | partial (fail-closed gate verified; actual delivery blocked: no Google account in lane) | JRN-5 | EV-010, EV-017 | ISS-006 |
| FEAT-013 | homeops.send_notification_draft (draft-only) | system | internal-functions.mjs | run step | partial (code + historical test/audit evidence; not executed this run) | — | EV-009, EV-024 (hist) | ISS-006 |
| FEAT-014 | Run-result → conversation summary (hooks) | system | assistant-runs.mjs | conversation-born run | fail (dishonest "Done"; silent for parked) | JRN-1 | EV-008, EV-012, EV-013 | ISS-002, ISS-004 |
| FEAT-015 | Self-repair loop (failed conversation runs) | system | assistant-runs.mjs repairFailedRun | failed run + provider | partial (not triggered this run — no failed conversation run produced; check: force a hard tool failure in a conversation plan) | — | EV-008 (code) | — |
| FEAT-016 | Mobile Ask chat (send/stream/watch/build) | any | apps/mobile (ask)/index.tsx | device/simulator | blocked (native visual lane CLOSED by user decision DEC-10 — code-read only) | — | EV-021, EV-022 | ISS-004, ISS-007 |
| FEAT-017 | Mobile "Run this plan" (useRun().startRun) | Limited Member+ | run-context.tsx → /api/runs/start | plan card w/o autorun | blocked (same closed lane; code confirms server-durable at HEAD) | — | EV-021 | ISS-004 |
| FEAT-018 | Web Assistant chat equivalents | any | src/screens/Assistant.tsx | vite + session | partial (code parity check only — gap: browser pass skipped per DEC-A03; check: one web journey against local stack with TG- records) | — | EV-025 (shared routes) | — |
| FEAT-019 | Run expiry/stall sweeps | system | engine.mjs expireStaleRuns | parked/stalled runs | partial (code-read; 30-min waits not run — check: clock-shifted harness test) | — | EV-007, EV-026 | ISS-004, ISS-008 |
| FEAT-020 | Agent capability policy (clamp + engine re-validation) | system | agents.mjs, orchestrator.mjs | agent with allow-list | fail (silent pre-run drop) | JRN-1 | EV-004, EV-014 | ISS-005 |
| FEAT-021 | Manual trigger fire route | Adult Admin+ | POST /api/triggers/:id/fire | trigger exists | pass | JRN-1,2 | EV-011, EV-015 | — |
| FEAT-022 | Approval push notification (Expo) | system | notify.mjs pushApprovalNotification | registered push tokens | partial (no tokens in lane; code-read; no-op observed implicitly) | — | EV-013 (silent park) | ISS-008 |

## UI-to-Backend Trace Matrix

One row per meaningful action in the audited chain (status refers to contract truth, not merely "it responded").

| FEAT-ID | UI control | Frontend component/state | Request/IPC | Endpoint/handler | AuthZ rule | Domain logic | Data mutation | Response contract | Visible status | Parity (prod vs local) | Recovery | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-001 | Send message | (ask)/index.tsx send() / Assistant.tsx | POST /api/assistant[/stream] | assistantRespond/Stream | gate()+childAiGate+planGate | planner ASSISTANT_SYS over live catalog | conversation messages appended | {ok,kind,answer,plan?,build?,run?} | reply bubble | identical (EV-018) | error turn persisted | pass | EV-011, EV-016 |
| FEAT-003 | (automatic — "Already on it") | PlanCard autoRun + watchServerRun | startRun inside /api/assistant | engine startRun→_drive | roleAtLeast Limited Member | plan steps frozen server-side | run + steps rows | out.run public | inline progress card | identical | watch stops silently at 3 min | fail | EV-012, EV-022 |
| FEAT-004/005 | "Approve & build" | BuildCard runBuild | POST /api/assistant/build | materializeBuild | Adult Admin+ | createSkill/createAgent/createTrigger; target FALLBACK loses skill/goal | skills/agents/triggers rows; conversation build_result | {ok,created,notes} | "Done — I set up …" + "helper is live" | identical | 422 on hard failure | fail | EV-011, EV-015, EV-001 |
| FEAT-006/007 | (none — background) | — | tick() 10s | fireTrigger→runAgent | synthetic session (scheduler/owner) | goal=null,skillId=null → buildReadonlyPlan | run rows; trigger lastStatus "queued" (never terminal) | {ok,runId} | Automations list shows nextRunAt | identical | skipped fires stay due | fail | EV-003, EV-004, EV-011, EV-015 |
| FEAT-009 | — | — | — | _drive reasoning branch | — | LLM or vacuous skip | step succeeded | {text,data} | step dot green | identical | none | fail | EV-005, EV-012 |
| FEAT-010/011 | Approve in Inbox | approvals UI | POST /api/approvals/:id/decide | consumeApproval→execResolved | canApprove roles | gmail.send validation → Google API | approval consumed; step result | typed errors (no_account, needsSetup) | "Needs approval" badge | identical | 30-min TTL → expired (silent) | partial/blocked | EV-006, EV-013, EV-007 |
| FEAT-012 | (API/settings surface) | — | POST /api/notify | deliverNotification | session + method ownership + verified + opt-in + agent allowlist | channel routing | notification row (in-app) | {ok,delivered,needsSetup?} | honest message | identical | fail-closed | partial | EV-010, EV-017 |
| FEAT-014 | (none — arrives in thread) | refreshConversation | onRunFinished hook | runOutcomeText | household match | counts "succeeded" steps incl. vacuous | run_result message | "Done — finished (n/n)" | identical | none for parked/expired | fail | EV-008, EV-012, EV-013 |
| FEAT-020 | — | — | — | runAgent clamp + engine re-validation | allow−deny | silent step drop pre-run | routing.droppedSteps only | run without the step | nothing user-visible | identical | none | fail | EV-004, EV-014 |
| FEAT-021 | "Fire now" (Automations) | Automations screens | POST /api/triggers/:id/fire | fireTrigger | Adult Admin+ | as FEAT-007 | run + audit | {ok,runId} | run appears | identical | 422 on error | pass | EV-011, EV-015 |

## Coverage

```
Execution coverage: 13/22 = 59%
Verified coverage:  10/22 = 45%
Persona coverage:   13/22 = 59%
```

Verified counts features whose behavior (pass OR confirmed-fail) has matching runtime + implementation evidence from this run. Blocked/partial rows are never counted verified. Every non-executed row names its gap and the next discriminating check inline. The two `blocked` client rows share one named blocker: native visual lane closed by user decision (prior-run DEC-10) — not re-opened per brief.
