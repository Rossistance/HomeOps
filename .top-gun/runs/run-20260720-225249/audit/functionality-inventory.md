# App Functionality Inventory

The functionality denominator for this build-from-spec run is the **22 candidate use-case templates** (`source-use-cases.txt`, ART-002), each mapped to its catalog home and its exact FamiliOS `tool_id` chain. `FEAT-0NN` ⇔ `UC-NN`.

**Status legend (build-readiness verdicts — nothing is implemented yet).** `build-ready` = fully buildable AND verifiable now on the active catalog; `build-ready*` = buildable now with a named verification caveat (partial); `blocked-inactive` = a required connector/tool is not connected, so the item is spec-and-criteria only. No template is implemented, so **verified feature coverage = 0/22** (see Coverage). Confirmed active/inactive split: **9 active / 13 inactive**, matching ART-001 with four corrections (UC-12 device-unverified, UC-14 RSS-partial, UC-20 attach mismatch, UC-22 digest-compose).

## Features

| FEAT-ID | Name | Role | Surface (catalog home + trigger) | Prerequisite state (connectors) | Status | Persona coverage | Evidence IDs | Issue IDs |
|---|---|---|---|---|---|---|---|---|
| FEAT-001 | UC-01 School Correspondence Organizer | Owner/Adult Admin | workflowTemplate + skill; Schedule (weekday AM) | Google (gmail.read+modify) — active | build-ready | JRN-1, JRN-2 | EV-007,EV-017 | — |
| FEAT-002 | UC-02 Emergency Work-to-Home Forwarder | Owner | workflowTemplate + skill; Email Received | MS365 (outlook.search) — INACTIVE | blocked-inactive | JRN-1 | EV-007,EV-017 | ISS-005 |
| FEAT-003 | UC-03 Urgent Slack Escalation | Owner | workflowTemplate + skill; Email Received | MS365 + Slack — INACTIVE | blocked-inactive | JRN-1 | EV-007,EV-017 | ISS-005 |
| FEAT-004 | UC-04 Grandparent Weekly Digest | Owner | workflowTemplate + skill; Schedule (Fri 4 PM) | MS365 (outlook.send) — INACTIVE | blocked-inactive | JRN-3 | EV-007,EV-017 | ISS-005,ISS-007 |
| FEAT-005 | UC-05 Cross-Calendar Conflict Sync | Owner | workflowTemplate + skill; Schedule (Sun PM) | MS365 (mscal.list) + Google — INACTIVE | blocked-inactive | JRN-1 | EV-007,EV-017 | ISS-005 |
| FEAT-006 | UC-06 Corporate Hold Generator | Owner | workflowTemplate + skill; Calendar Event Created | MS365 (mscal.create) — INACTIVE | blocked-inactive | JRN-1 | EV-007,EV-017 | ISS-005 |
| FEAT-007 | UC-07 Secure Document Cloud Sync | Owner | workflowTemplate + skill; Schedule | Google Drive (active) + MS365 OneDrive — INACTIVE | blocked-inactive | JRN-1 | EV-007,EV-017 | ISS-005,ISS-007 |
| FEAT-008 | UC-08 Secure Archive Builder | Owner | workflowTemplate + skill; File/Schedule | Dropbox — INACTIVE | blocked-inactive | JRN-1 | EV-007,EV-017 | ISS-005 |
| FEAT-009 | UC-09 Database-to-Checklist Pipeline | Owner | workflowTemplate + skill; Schedule | Notion + Todoist — INACTIVE | blocked-inactive | JRN-1 | EV-007,EV-017 | ISS-005 |
| FEAT-010 | UC-10 Vacation Project Onboarding | Owner | workflowTemplate + skill; Note/Manual | Notion + TickTick — INACTIVE | blocked-inactive | JRN-1 | EV-007,EV-017 | ISS-005 |
| FEAT-011 | UC-11 Overdue Chore Auditor | Owner/Adult Admin | workflowTemplate + skill; Manual | Todoist (todoist.listTasks) — INACTIVE | blocked-inactive | JRN-2 | EV-007,EV-017 | ISS-005,ISS-007 |
| FEAT-012 | UC-12 Smart Climate Night-Mode | Adult Admin | workflowTemplate + skill; Schedule (10 PM) | Google smarthome (SDM) — active-scope, device-unverified | build-ready* | JRN-2 | EV-007,EV-018,EV-017 | ISS-004 |
| FEAT-013 | UC-13 Smart Speaker Dinner Bell | Adult Admin | workflowTemplate + skill; Schedule (6 PM) | Amazon Alexa — INACTIVE | blocked-inactive | JRN-2 | EV-007,EV-017 | ISS-005 |
| FEAT-014 | UC-14 Morning Status Text | Owner | workflowTemplate + skill; Schedule (6:30 AM) | Weather + Text (active), RSS (INACTIVE) | build-ready* | JRN-1, JRN-3, JRN-4 | EV-008,EV-021,EV-017 | ISS-003 |
| FEAT-015 | UC-15 Family Dashboard API Bridge | Owner | workflowTemplate + skill; Schedule/Webhook | Custom HTTP (http.get/post) — INACTIVE | blocked-inactive | JRN-1 | EV-008,EV-017 | ISS-005 |
| FEAT-016 | UC-16 School Menu Data Harvester | Owner | workflowTemplate + skill; Schedule | Local Files (active) + Browser Automation — INACTIVE | blocked-inactive | JRN-1 | EV-008,EV-017 | ISS-005 |
| FEAT-017 | UC-17 Smart Recipe Extractor | Owner/any | skill (Manual/on-demand) | Web Search & Reading — active | build-ready | JRN-1 | EV-008 | — |
| FEAT-018 | UC-18 Digital Memory Scrapbooker | any (incl. Child View author) | skill (Manual) | FamiliOS-native (write_memory, create_artifact) — active | build-ready | JRN-5 | EV-009 | — |
| FEAT-019 | UC-19 Event Coordinator & Logistics Assigner | Adult Admin | skill (Manual) | FamiliOS-native (event/checklist/driver/what-to-bring) — active | build-ready | JRN-2 | EV-009 | — |
| FEAT-020 | UC-20 Chore Manager & Document Linker | Adult Admin | skill (Manual) | FamiliOS-native (task/list/attach) — active | build-ready* | JRN-5, JRN-4 | EV-009,EV-019 | ISS-001 |
| FEAT-021 | UC-21 Multi-Channel Meal Planner & Sign-Off | Adult Admin | agentTemplate + skill; Manual/Schedule | FamiliOS-native (plan_meal/notify/approval) — active | build-ready | JRN-2, JRN-3, JRN-4 | EV-009,EV-021 | — |
| FEAT-022 | UC-22 Internal System Sync | Owner | skill (Manual) | FamiliOS-native (write_memory + create_artifact); optional gmail.search — active | build-ready* | JRN-1 | EV-009,EV-020 | ISS-002 |

## UI-to-Backend Trace Matrix

One row per use-case's primary action chain (design-time: the skill step graph → the real executor). "Endpoint/handler" cites the actual runtime path a materialized skill step would take. Parity: prod live-seed is blocked (scripted mutation, EV-017); local-stack `materializeBuild` + `runSkill`/`executeTool` is the verifiable path.

| FEAT-ID | UI control | Frontend component/state | Request/IPC | Endpoint/handler | AuthZ rule | Domain logic (tool_id chain) | Data mutation | Response contract | Visible status | Parity | Recovery | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-001 | Run automation / Approve label | Automations + Approval card | POST /api/skills/:id/test, POST /api/approvals/:id | runSkill → executeTool | Adult Admin; gmail.modify scope | gmail.search → gmail.listLabels → gmail.modifyLabels(approval) | Gmail labels changed on account | {modified,added,removed,createdLabels} | Approval card → run log | prod-blocked / local-ok | typed provider_error; skip non-existent labels | build-ready | EV-007 |
| FEAT-012 | Nightly run / Approve setpoint | Automation + Approval card | POST /api/skills/:id/test | executeTool via provider api() | Adult Admin; smarthome scope | smarthome.listDevices → smarthome.setThermostat(approval) | Nest heat setpoint (real device) | {ok,deviceId,heatCelsius} | run log | prod-blocked / local-contract-only | fail-closed if no SDM project id | build-ready* | EV-018 |
| FEAT-014 | 6:30 AM schedule | Automation (Schedule, anchor 06:30) | trigger → runSkill | weather.current + [rss.latest stub] + notify_contact | agent on method allowlist | weather.current → (RSS optional) → homeops.notify_contact | text delivered via registry | {delivered,channel} | run log + delivery audit | prod-blocked / local-ok | notify_contact refuses unverified method (honest) | build-ready* | EV-008,EV-021 |
| FEAT-017 | Ask / Run | Chat plan or skill | POST /api/skills/:id/test | executeTool (web) | any role | web.search → web.read → web.recipe | none (read-only) | {source,recipe{ingredients,instructions}} | inline result | prod-ok(read) / local-ok | typed error if page unreadable | build-ready | EV-008 |
| FEAT-018 | Run scrapbook | Skill run | POST /api/skills/:id/test | internal fn run | any (author) | homeops.write_memory → homeops.create_artifact | memory + artifact rows | {id,title,kind} | artifact in space | prod-blocked / local-ok | empty_text guard | build-ready | EV-009 |
| FEAT-019 | Run coordinator | Skill run | POST /api/skills/:id/test | internal fn run | Adult Admin | create_event_draft → update_event_checklist → assign_driver → assign_what_to_bring (chain event id) | event draft + checklist + driver + bring | {id,status,...} | event drawer | prod-blocked / local-ok | event_not_found if id not threaded | build-ready | EV-009 |
| FEAT-020 | Run chore manager | Skill run | POST /api/skills/:id/test | internal fn run | Adult Admin | create_task → create_list_item → attach_note_or_file_reference(**events only**) | task + list item (+ note in task.notes) | {id,title,listName} | task card | prod-blocked / local-ok | attach targets events → put ref in task.notes | build-ready* | EV-009,EV-019 |
| FEAT-021 | Plan week / Approve sign-off | Meal planner + Approval | POST /api/skills/:id/test, POST /api/approvals/:id | internal fn run | Adult Admin | plan_meal → send_notification_draft → notify_contact(Send) → create_approval(approval,Send) | meal+groceries+event, draft, delivery, approved-decision artifact | {mealId,groceryItems,eventId,delivered,recorded} | planner + approval card | prod-blocked / local-ok | notify_contact honest refusal; approval gate | build-ready | EV-009,EV-021 |
| FEAT-022 | Run sync | Skill run | POST /api/skills/:id/test | internal fn run + provider | Owner | write_memory → (gmail.search or reason over activity) → create_artifact (digest) | memory + digest artifact | {id,title,kind} | dashboard artifact | prod-blocked / local-ok | **no built-in "inbox digest" tool — compose** | build-ready* | EV-009,EV-020 |
| FEAT-002..011,013,015,016 | (13 inactive) | n/a — spec+criteria only | n/a | tool exists but connector not connected | n/a | required tool ids present in catalog but `connected=false` | none | n/a | "Setup by admin" / not configured / runtime unavailable | blocked | connect the named connector to unblock | blocked-inactive | EV-007,EV-008,EV-017 |

## Coverage

```
Execution coverage: 22/22 = 100%   (all 22 use-cases fully traced against the real FamiliOS tool catalog; baseline build/test/typecheck green — EV-014,EV-015,EV-016)
Verified coverage:  0/22 = 0%      (no template is implemented yet — this run is the validated BUILD PLAN, not the build; implementation is the next phase. Of the 22: 9 build-ready-active, 13 blocked-inactive)
Persona coverage:   22/22 = 100%   (every use-case assigned to ≥1 of the five canonical persona journeys JRN-1..JRN-5, design-time)
```

Build-readiness of the in-scope active set: 6 build-ready-clean (UC-01,17,18,19,21 + note UC-21 clean) and 3 build-ready-with-caveat (UC-12 device-unverified, UC-14 RSS-partial, UC-20 attach-mismatch, UC-22 digest-compose) — 9 active total. The 13 inactive items are blocked with a single named unblock each: connect the named connector. Blocked, partial, and inactive items are never counted as verified.
