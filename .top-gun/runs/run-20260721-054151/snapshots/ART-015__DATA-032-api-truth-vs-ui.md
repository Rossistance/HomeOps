# DATA-032 — Server-API truth vs UI render (verbatim captures, 2026-07-21, disposable tenant hh_849af84da549)

All captures below were made in the SAME browser session, seconds apart, via `fetch(..., { credentials:'include' })` from the page context (identical auth to the UI).

## 1. While run run_c51a1a1b0e6a628a7bb1 was parked (chat said "Review it in your Inbox")

`GET /api/approvals` returned:

```json
{ "status": 200, "approvals": [ { "id": "apr_51712e48a8beb7f987becb4b", "status": "pending",
  "toolId": "homeops.create_approval", "preview": "Request household sign-off for fence day",
  "expiresAt": 1784615369857 } ] }
```

UI at the same moment (SS-004, SS-005): Messages → Inbox tab = empty ("Select a conversation"); Approvals tab = "PENDING (0) — Nothing to approve. Your helpers have everything they need."

Playwright network log for the whole session contained ZERO requests matching `approvals|notifications` (filter returned no rows), while `/api/events|tasks|members|conversations|memory|agents|contact-methods|household|files|knowledge` were each fetched roughly once per second (~340 requests in ~90s), plus `GET /api/rev` and `GET /api/runs/run_c51a...` polling.

## 2. Deciding the approval through the server contract (the same call the UI's decide path would make)

`POST /api/approvals/apr_51712e48a8beb7f987becb4b/decide {"decision":"approve"}` → 200:

```json
{ "approval": { "id": "apr_51712e48a8beb7f987becb4b", "connectorId": "homeops",
  "toolId": "homeops.create_approval", "status": "approved", "risk": "High", "category": "Send",
  "preview": "Request household sign-off for fence day", "decidedBy": "m-owner",
  "requestedBy": "m-owner", "allowedApproverRoles": ["Owner", "Adult Admin"], "consumedBy": null } }
```

## 3. After approval — run completed, chat claimed delivery, notifications EMPTY

`GET /api/runs/run_c51a1a1b0e6a628a7bb1`:

```json
{ "status": "completed", "steps": [
  { "i": 0, "toolId": "homeops.create_approval", "status": "succeeded",
    "detail": "{\"id\":\"art_02330b4f6ee0ec1b\",\"subject\":\"Fence day Saturday\",\"recorded\":true}" },
  { "i": 1, "toolId": "homeops.send_notification_draft", "status": "succeeded",
    "detail": "{\"id\":\"art_89e1682d8a688309\",\"draft\":true,\"to\":\"\"}" } ] }
```

`GET /api/notifications` → `{ "notifications": [] }` (EMPTY).

Durable conversation messages (`GET /api/conversations/<id>`):

```json
[
 { "role": "assistant", "kind": "status",     "text": "Waiting for your approval before \"Request household sign-off for fence day\" can run — nothing has been sent yet. It expires in about 30 minu…" },
 { "role": "user",                             "text": "Create a household task called \"Fix backyard fence\" and add a list item \"Buy wood screws\" to it" },
 { "role": "assistant", "kind": "plan",       "text": "On it — asking the household to sign off, then posting the notice." },
 { "role": "assistant", "kind": "run_result", "text": "Done — \"Fence sign-off\" ran and delivered 2 steps." },
 { "role": "assistant", "kind": "build",      "text": "That worked. Want me to save \"Fence sign-off\" as a reusable helper, so next time it's one tap?" }
]
```

Note (a) the parked status message is FIRST, before the user's own message; (b) "delivered 2 steps" while `/api/notifications` is empty and step 2 produced only a draft artifact.

## 4. Clean-path control run (no approval gate) — run_2e17f2582f9ae2dea3f9

```json
{ "status": "completed", "steps": [
  { "toolId": "homeops.create_task",      "status": "succeeded", "detail": "{\"id\":\"tk_bea1f803671120f1\",\"title\":\"Fix backyard fence\",\"type\":\"task\"}" },
  { "toolId": "homeops.create_list_item", "status": "succeeded", "detail": "{\"id\":\"li_575f01ef31dac657\",\"title\":\"Buy wood screws\",\"listName\":\"Weekend\"}" } ] }
```

`GET /api/tasks` → both records present. Dashboard full-page text search for "Fix backyard fence" → NOT FOUND anywhere (Dashboard.tsx:79 renders only overdue tasks; no task-list surface exists).

## 5. Artifacts exist server-side; no web surface reads them

`GET /api/artifacts`:

```json
{ "artifacts": [
  { "id": "art_89e1682d8a688309", "runId": "run_c51a1a1b0e6a628a7bb1", "kind": "notification-draft",
    "title": "Fence day", "body": "Fence day is Saturday - wear old clothes.", "meta": { "to": "", "channel": "In-App" } },
  { "id": "art_02330b4f6ee0ec1b", "runId": "run_c51a1a1b0e6a628a7bb1", "kind": "approved-decision",
    "title": "Fence day Saturday", "body": "Approve the Saturday fence-repair plan" } ] }
```

Files & Knowledge screen at the same moment (SS-019): "Files 0 · Knowledge Library 0" (it reads `/api/knowledge`, which returned `{ "items": [] }`).

## 6. Agent-console run — status label mismatch

`GET /api/runs` newest entry: `{ "id": "run_274db430a00e248d7278", "status": "waiting_for_connector", "title": "Family Briefing Agent", "source": "agent", "steps": [ { "toolId": "gmail.search", "status": "blocked", "detail": "Connect your Google account to use this tool." }, ... ] }`

UI (SS-009 / SS-011): chip reads "Waiting for Approval" with sub-text "Paused — connect the required service to continue."

## 7. Member roster after child-member creation

`GET /api/members` → `[ { "actorId": "m-owner", "name": "Audit Runner", "role": "Owner" }, { "actorId": "m-2181edf4", "name": "Kid Tester", "role": "Child View" } ]`

After sign-out, the profile picker (SS-027) showed only "Ross — Owner" (the resident `local` tenant's profile); neither member of the signed-in household was offered.
