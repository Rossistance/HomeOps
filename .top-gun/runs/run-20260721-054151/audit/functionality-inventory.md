# App Functionality Inventory — run-20260721-054151

Denominator scope: FamiliOS web app (src/ + server/) on a live local dev instance, fresh tenant, plus read-only resident-tenant data. Native iOS surfaces and externally-gated connectors (Google OAuth, Microsoft, Slack, Dropbox, SMS/Twilio, Alexa/Google Home, Notion/Todoist/TickTick) are in-denominator but unreachable without credentials/OAuth apps — each named below rather than counted as verified.

## Features

| FEAT-ID | Name | Role | Surface | Prerequisite state | Status | Persona coverage | Evidence IDs | Issue IDs |
|---|---|---|---|---|---|---|---|---|
| FEAT-001 | Shell navigation + command palette + space filter + Calm Mode | any | Shell | signed in | pass | JRN-1,JRN-2 | EV-002,EV-033 | ISS-013 |
| FEAT-002 | Onboarding: create household / restore backup / sample; lock & profile switch | any | Onboarding, Lock | none | partial (create=pass; restore/sample not executed; profile switch broken for signed-up households) | JRN-2,JRN-3 | EV-001,EV-025,EV-027 | ISS-012,ISS-015 |
| FEAT-003 | Account auth: signup, email sign-in, sign-out, PIN option | any | Onboarding/Lock/Settings | none | pass | JRN-2 | EV-001,EV-027,EV-032§7 | — |
| FEAT-004 | Dashboard: greeting, calendar peek, Needs-you, briefing, quick actions, helper/connector peeks | any | Dashboard | signed in | partial (renders; Needs-you blind to server approvals; tasks invisible) | JRN-2 | EV-002,EV-015 | ISS-001,ISS-008 |
| FEAT-005 | Task + list-item creation via chat tools (homeops.create_task / create_list_item) | member+ | server tools | provider active | pass (server write verified; result surface missing) | JRN-2 | EV-032§4 | ISS-008 |
| FEAT-006 | Ask FamiliOS chat: scope tabs, recents, attach, streamed answer | member+ | Assistant | provider active | pass | JRN-1,JRN-2 | EV-003,EV-006 | ISS-016 |
| FEAT-007 | Chat → plan → AUTO-EXECUTED durable run | Limited+ | Assistant→engine | provider active | pass (mechanics) | JRN-2 | EV-029,EV-032 | ISS-003,ISS-004,ISS-005,ISS-009 |
| FEAT-008 | Chat → build proposal → materialize skill/agent/automation (+ edits) | Adult Admin | Assistant→/api/assistant/build | provider active | partial (card rendered; materialize not executed this run) | JRN-1 | EV-006 | — |
| FEAT-009 | No-provider honest refusal in chat | any | Assistant | no provider | pass | JRN-2 | S1 first repro; EV-032§3 error thread | ISS-016 |
| FEAT-010 | Approvals: create, TTL, decide, consume-once, role-filtered visibility | Owner/Adult | server + Messages→Approvals | gated step ran | FAIL on web surface (server contract passes; UI shows 0) | JRN-2 | EV-004,EV-005,EV-032§1-2 | ISS-001 |
| FEAT-011 | In-app notifications (addNotification → GET /api/notifications, read-state) | any | server; no web surface | any notifier ran | FAIL (no consumer; verified empty render path) | JRN-2 | EV-030,EV-032§3 | ISS-002 |
| FEAT-012 | Registry delivery homeops.notify_contact (verified+opt-in+per-agent allowlist; email/SMS/in-app) | agent runs | server | contact method registered | blocked from chat (no agentId); external channels unreachable (no Google/SMS in env) | — | EV-023,EV-034 | ISS-004 |
| FEAT-013 | Helper Agents: list/filters, create (template/plain-English), detail (11 tabs), Run now, pause/duplicate/archive | Adult Admin | Agents | signed in | partial (create+run=pass; status label wrong; history local-only) | JRN-1 | EV-007,EV-008,EV-009 | ISS-005,ISS-011,ISS-013 |
| FEAT-014 | Improvements/evolution: trace-based proposals, AI enrichment, judge-gated auto-apply, Improvements tab | Owner | ActivityMemory + engine | failed run | partial (engine path code-verified + resident data; UI empty-state only; no diff/revert) | JRN-1 | EV-013,EV-031 | ISS-007 |
| FEAT-015 | Automations screen: list, Live, Workflow Builder (plain English + rules), 23 templates, Browser Workflows, Run History | Adult Admin | Automations | signed in | partial (surfaces render; history omits chat runs; builder generate not executed) | JRN-1 | EV-010,EV-011,EV-026 | ISS-005,ISS-013 |
| FEAT-016 | Durable runs: steps, statuses, retries, idempotency, park/resume, SSE, recovery, stall sweeper | system | engine + /api/runs | — | pass (observed park→resume→complete + clean completion; recovery code-verified) | JRN-2 | EV-032,EV-038 | ISS-003,ISS-009,ISS-017 |
| FEAT-017 | Activity Log (audit trail) with filters | any | ActivityMemory | signed in | partial (renders; raw strings) | JRN-1 | EV-012 | ISS-014 |
| FEAT-018 | Memory: homeops.write_memory, auto memory-judge after runs, Memory tab | any | ActivityMemory + engine | provider | partial (auto-judge exercised via fake=declined; write_memory not run; resident memory.json 3.3 KB) | JRN-1 | EV-029,EV-031 | — |
| FEAT-019 | Knowledge capture: run reasoning → artifact; Files & Knowledge library; uploads | any | FilesKnowledge | completed run | FAIL for run artifacts surface (server writes; screen reads /api/knowledge only); uploads not tested | JRN-2 | EV-019,EV-032§5 | ISS-003 (linked), ISS-002-adjacent |
| FEAT-020 | Live sync loop (poll 10 collections + /api/rev) | system | client | signed in | partial (works; storm) | all | EV-030 | ISS-010 |
| FEAT-021 | Calendar: list/month, add event, subscriptions, Google push/auto-sync | member+ | Calendar | Google for sync | partial (local render+form pass; Google paths unreachable) | JRN-2 | EV-016 | — |
| FEAT-022 | Meals: planner form, slots, ingredients→groceries, plan_meal tool | member+ | Meals | — | partial (form renders; pipeline not executed live) | JRN-2 | EV-017 | — |
| FEAT-023 | Household Spaces: spaces, members CRUD, roles & access | Owner/Admin | HouseholdSpaces | signed in | pass (member add verified server-side) | JRN-3 | EV-014,EV-037 | ISS-012 |
| FEAT-024 | Mini Apps: starter templates, add-to-my-apps, AI-generated mini app | member+ | MiniApps | provider for AI-gen | partial (catalog renders; add/gen not executed) | JRN-2 | EV-018 | ISS-008 (chore board as task home) |
| FEAT-025 | Messages: family threads, new update, escalate/resolve; Contacts registry with verify+opt-in+allowlist | member+ | Messages | signed in | partial (surfaces render; thread send not exercised; verification path needs channel) | JRN-2,JRN-4 | EV-004,EV-023,EV-024 | ISS-002 |
| FEAT-026 | Help requests (ask/offer help) with targeted push | member+ | Dashboard HelpCard | 2+ members | partial (composer renders; send needs second signed-in profile — blocked by ISS-012 on web) | JRN-3 | EV-002 | ISS-012 |
| FEAT-027 | Connections: per-actor OAuth cards, health, admin-configured providers | Owner/Admin | Connections | OAuth apps configured | partial (renders truthful states; OAuth flows unreachable in audit env) | JRN-1 | EV-020 | — |
| FEAT-028 | Settings: runtime, kill switch, calendar auto-sync, auto-approve improvements, timezone, privacy, notifications, appearance, Calm, Advanced, risk overrides, backup/export/reset | Owner/Admin | Settings | signed in | pass (renders; ollama config+active exercised; kill switch not toggled) | JRN-1 | EV-032, S3 crawl | ISS-007 (default) |
| FEAT-029 | AI providers: 6 adapters, discover models, test, set active, send test message | Owner/Admin | Settings/AIProviders | provider reachable | partial (ollama pass; lmstudio FAIL auth; cloud not keyed) | JRN-1 | EV-029,EV-035 | ISS-006 |
| FEAT-030 | Local AI providers end-to-end (Ollama/LM Studio) | Owner/Admin | Settings + ai.mjs | runtime up | partial (ollama-protocol pass via harness; LM Studio blocked by token) | JRN-1 | EV-029,EV-035 | ISS-006 |
| FEAT-031 | Triggers/scheduler: schedule/recurring (tz-anchored), webhook, connector_event, manual | Adult Admin | server + Automations | automation exists | partial (code + resident data verified; live fire not awaited) | JRN-5 | EV-039,EV-031 | ISS-017 |
| FEAT-032 | Skills builder (+ Recipes) and versioning | Advanced | SkillBuilder | Advanced Mode | partial (renders; create/test not executed) | JRN-1 | EV-021 | ISS-013 |
| FEAT-033 | Functions builder (test-gated availability) | Advanced | FunctionBuilder | Advanced Mode | partial (renders; create/test not executed) | JRN-1 | EV-022 | ISS-013 |
| FEAT-034 | Backups: export/import household bundle; reset sample | Owner | Settings + backup.mjs | signed in | not executed (UI present; resident lastBackupAt shows live use) | — | EV-031 | — |
| FEAT-035 | Mobile/responsive web layout (375px) + bottom nav | any | all screens | — | partial (Messages/others render at 375px; not all screens swept) | JRN-4 | EV-024 | — |
| FEAT-036 | Self-repair of failed chat runs (one-shot) + save-as-helper offer | system | engine hooks | failed/completed chat run | partial (offer observed live; repair path code-verified, not triggered) | JRN-2 | EV-006,EV-034 | ISS-003 (gate uses same delivered heuristic) |

## UI-to-Backend Trace Matrix (meaningful actions exercised this run)

| FEAT-ID | UI control | Frontend component/state | Request/IPC | Endpoint/handler | AuthZ rule | Domain logic | Data mutation | Response contract | Visible status | Parity (prod vs local) | Recovery | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-003 | Create household form | Onboarding local state | POST /api/signup | index.mjs signup | none (public) | identity+tenant create | _system identities/sessions + new tenant dir | {session} | dashboard loads | local only | re-login works | pass | EV-001,EV-002 |
| FEAT-029 | Ollama Save/Test/Set active | Settings provider card | POST /api/ai/providers/ollama/config, /health, /api/ai/active | ai.mjs setProviderConfig/providerHealth/setActiveProvider | Owner/Admin session | probe /api/tags; persist health | connectors.json + settings.aiActiveProvider | provider snapshot with readiness | "Configured · reachable · 1 models" | local only | health re-probe | pass | EV-029, net log |
| FEAT-007 | Chat send (fence task) | sendToAssistant → SSE | POST /api/assistant/stream | index.mjs:2921 → assistantStream → startRun | session + childAiGate + planGate | plan normalize; server-authoritative approvals | conversations + runs + tasks | SSE progress + done{result,run} | "On it—…" then run_result "Done (2/2)" | local only | thread persists refresh | pass | EV-032§4 |
| FEAT-010 | (Expected) approve in Inbox | Messages→Approvals reads LOCAL store | NONE issued | GET /api/approvals exists unused | canApprove filter server-side | consume-once w/ input hash | approvals row | {approvals:[…]} | "Pending (0)" while server pending | local only | run expires after 30 min | FAIL | EV-004,EV-005,EV-030,EV-032§1 |
| FEAT-010 | Decide via server contract (control) | page fetch (same session/CSRF) | POST /api/approvals/:id/decide | index.mjs decide → resumeRun | allowedApproverRoles | approve→consume→execute | approval status; run steps | {approval} | run completed; chat run_result | local only | idempotent consume | pass | EV-032§2-3,EV-038 |
| FEAT-011 | In-App notification step | — | run step homeops.send_notification_draft | internal-functions:380 | run ctx | writes DRAFT artifact only | artifacts.json | {draft:true} | chat says "delivered"; /api/notifications EMPTY; no UI row | local only | none | FAIL (semantics+surface) | EV-032§3 |
| FEAT-013 | Agent "Run now" | Agents detail panel | POST agent run (console path) | orchestrator.runAgent → readonly plan | Adult Admin | policy clamp; readiness | runs row | run snapshot | chip "Waiting for Approval" (wrong) + "connect service" | local only | resumable on connect | partial | EV-009,EV-032§6 |
| FEAT-023 | Add member (child) | Members tab form | POST /api/members | members handler | Owner/Admin | roster append | members.json | {member} | roster shows Kid Tester | local only | — | pass | EV-037 |
| FEAT-002 | Sign out → profile picker | Lock.tsx | GET /api/profiles | profiles handler | public | resident-tenant profiles only | — | {profiles:[Ross]} | own household absent | local only | email re-login | FAIL | EV-025,EV-027 |
| FEAT-016 | Run detail poll | chat run watcher | GET /api/runs/:id (×~60) | runGet | session household | — | — | {run} | live status in chat card | local only | poll gives up 2.5 min w/ honest text | pass | EV-030,EV-032 |

## Coverage

```
Execution coverage: 30/36 = 83%   (FEAT rows exercised at least partially in-run; unexecuted: FEAT-034 backups, parts of FEAT-008 materialize, FEAT-012 external channels, FEAT-021 Google sync, FEAT-022 meal pipeline, FEAT-026 second-profile send)
Verified coverage:  11/36 = 31%   (pass rows with UI+server evidence; partial/blocked/fail never counted)
Persona coverage:   27/36 = 75%   (exercised by ≥1 canonical persona journey; core chat-task flow exercised by two personas)
```

Named gaps and blockers: Google/Microsoft/Slack/Dropbox/SMS/Alexa/GoogleHome/Notion/Todoist/TickTick require OAuth apps or API keys absent in the audit environment (also "Not configured by deployment", EV-020) — these gate 13 of the 22 use-cases (see journey register). LM Studio requires the user's API token (EV-035). Child-session UI blocked by ISS-012. Backup/restore left unexecuted to avoid touching resident backup files.
