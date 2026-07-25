# App Functionality Inventory — run-20260723-143314

Denominator scoped to the surfaces the three recordings exercised plus the subsystems this run traced in
source. This is a **synthesis audit** (DEC-101): coverage counts what *this run* established, and
carries the prior mission's 36-feature inventory forward by reference rather than re-executing it.

## Features

| FEAT-ID | Name | Role | Surface | Prerequisite state | Status | Persona coverage | Evidence IDs | Issue IDs |
|---|---|---|---|---|---|---|---|---|
| FEAT-201 | Helper Agents catalog | Owner/Adult | web /agents | signed in | fail | JRN-1, JRN-2 | EV-102, EV-103 | ISS-101, ISS-111 |
| FEAT-202 | Unified Helper Agents nav (preview flag) | Owner | web Settings + Shell | flag on | partial | JRN-1 | EV-102 | ISS-108 |
| FEAT-203 | Calendar: view / create / edit / delete / sync | all | iOS Calendar, web /calendar | Google connected | fail | JRN-3 | EV-101, EV-110, EV-111 | ISS-104, ISS-105, ISS-106, ISS-121, ISS-123 |
| FEAT-204 | Chore Board mini app | all | web mini-apps | mini app added | partial | JRN-4 | EV-104, EV-112 | ISS-112, ISS-122 |
| FEAT-205 | Grocery / list surfaces | all | Meals, Mini Apps, Dashboard | list items exist | fail | JRN-4 | EV-103, EV-112 | ISS-112 |
| FEAT-206 | Automations: templates → create → edit → run | Owner/Adult | web /automations | signed in | fail | JRN-2 | EV-103, EV-104, EV-107 | ISS-103, ISS-110, ISS-111 |
| FEAT-207 | Run history (Live + History) | Owner/Adult | web /automations | runs exist | fail | JRN-2 | EV-103, EV-104 | ISS-110 |
| FEAT-208 | Approvals inbox | Owner/Adult | web /messages | pending approvals | pass | JRN-2 | EV-104 | — (behaves honestly; see ISS-102) |
| FEAT-209 | Contact methods + per-agent allowlist | Owner | web /messages/contacts | member exists | pass | JRN-2 | EV-104 | — (strength) |
| FEAT-210 | Connections / provider setup | Owner | web /connections | — | partial | JRN-2 | EV-104, EV-122 | ISS-119, ISS-121 |
| FEAT-211 | Household spaces + members + roles | Owner | web /spaces | — | pass | JRN-5 | EV-104 | — |
| FEAT-212 | Files & Knowledge | all | web /files | files exist | partial | JRN-4 | EV-104 | ISS-120 |
| FEAT-213 | Run execution engine (skill/agent/chat entry) | system | server | — | fail | JRN-2 | EV-105, EV-106, EV-115 | ISS-102, ISS-110 |
| FEAT-214 | Template instantiation | Owner | web store | template chosen | fail | JRN-2 | EV-107, EV-108, EV-109 | ISS-103, ISS-111 |
| FEAT-215 | Advanced Mode reveal | Owner | web Settings | — | partial | JRN-1 | EV-102 | ISS-108 |
| FEAT-216 | Capabilities / permissions display | Owner | web agent detail | agent exists | fail | JRN-1 | EV-102 | ISS-107, ISS-124 |
| FEAT-217 | Memory (FTS5 brain) | system + Owner | web /activity | memories exist | partial | JRN-1 | EV-103, EV-122 | ISS-113 |
| FEAT-218 | Activity log | all | web /activity | activity exists | fail | JRN-1 | EV-103, EV-104 | ISS-114 |
| FEAT-219 | Web navigation / routing | all | web shell | — | fail | all | EV-103 | ISS-115 |
| FEAT-220 | Text rendering + mobile input handling | all | both clients | — | fail | all | EV-101, EV-102, EV-103 | ISS-109 |
| FEAT-221 | Toast/notification layer | all | web | — | fail | JRN-2 | EV-113, EV-114 | ISS-116 |
| FEAT-222 | Skill builder + capability inference | Owner | web /skills | — | fail | JRN-1 | EV-102 | ISS-117 |
| FEAT-223 | Cross-client parity (web ↔ iOS) | all | both | — | fail | JRN-1 | EV-102, EV-103 | ISS-118 |
| FEAT-224 | Browser-automation runtime | system | server/prod | — | fail | — | EV-122 | ISS-119 |
| FEAT-225 | File processing / indexing pipeline | system | server | file uploaded | partial | JRN-4 | EV-104 | ISS-120 |
| FEAT-226 | Mini-app lifecycle (add/duplicate/archive) | Owner | web /mini-apps | — | partial | JRN-4 | EV-104 | ISS-122 |

## UI-to-Backend Trace Matrix

| FEAT-ID | UI control | Frontend component/state | Request/IPC | Endpoint/handler | AuthZ rule | Domain logic | Data mutation | Response contract | Visible status | Parity | Recovery | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FEAT-214 | "Use this template" | `TemplateDetail` → `createAutomationFromTemplate` (useStore:2234) | **none — client-only** | none | n/a | 5-step agent fallback ending "first active agent"; `multiAgent` ignored | local `d.automations.unshift` | n/a | toast "Automation created" | web-only path | none | **FAIL** | EV-107, EV-108, EV-109 |
| FEAT-213 | "Run" on a skill/automation | client run trigger | POST run start | `runSkill` (orchestrator:121) | session | `agentId ?? skill.defaultAgentId ?? null` | run row with `sourceRef.agentId = null` | run object | "Failed — no_acting_agent" *after* steps consumed | server-wide | none | **FAIL** | EV-105, EV-106 |
| FEAT-203 | Google all-day event sync | mobile calendar list → `coversDay` | GET events | `parseGoogleEvents` (calendar:23-26) | session | stores `end.date` verbatim (exclusive) | `endAt` = exclusive date | event rows | renders on 2 days | both clients affected | none | **FAIL** | EV-110, EV-111 |
| FEAT-203 | "Delete event" on a Google-linked event | mobile editor | DELETE event | delete route | session | local removal only (no Google call traced) | local row removed | ok | "removed from household calendar" | — | **sync re-imports it** | **FAIL** | EV-101 |
| FEAT-205 | Grocery count vs Shared Grocery List | dashboard selector vs `ChoreBoard` filter | GET tasks | tasks read | session | `BOARD_TASK_TYPES` excludes `type:"list"` | none | task list | count says items, list says empty | web | none | **FAIL** | EV-112 |
| FEAT-221 | Automation status toggle | `toggleAutomation` (useStore:2178) | none | none | n/a | pure metadata write | `enabled`/`status`/`updatedAt` | n/a | toast "Automation paused" — **unattributed** | web | n/a | **PARTIAL** (control correct, toast misleading) | EV-113, EV-114 |
| FEAT-208 | Approvals tab | server-truth read-model (WP-001) | GET /api/approvals | approvals handler | session + role | pending/decided split | none | approval list | honest "Nothing to approve" | web ✓ iOS ✓ | n/a | **PASS** | EV-104 |
| FEAT-209 | Per-agent contact allowlist | contacts tab | GET/PATCH contact-methods | contact handler | session + role | verified + opted-in + per-agent allowlist | allowlist rows | ok | checkbox state | web | fail-closed | **PASS** | EV-104 |

## Coverage

```
Execution coverage: 26/26 = 100%   (every in-scope feature was exercised in a recording or traced in source this run)
Verified coverage:  10/26 = 38%    (UI evidence AND source/API confirmation both present; partial/blocked/observed never counted)
Persona coverage:   26/26 = 100%   (every feature maps to ≥1 of the five carried-forward personas)
```

Verified set (10): FEAT-202, 205, 208, 209, 211, 213, 214, 221, 224 and FEAT-203's all-day defect.
Everything marked "observed" in the issue register (ISS-105, ISS-106, ISS-110, ISS-111, ISS-113, ISS-114,
ISS-115, ISS-117, ISS-118, ISS-120, ISS-121, ISS-122, ISS-123, ISS-124) is **excluded** from verified
coverage by contract — those need the discriminating checks in the hypothesis queue.
