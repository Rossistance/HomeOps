# Ask Famili engine replacement + scheduling consistency pass — 2026-09-12

> **Superseded in part by `HELPERS_2026-09-14.md`.** The engine described here is still the
> engine. What changed two days later is everything around it: the seven concepts that wrapped
> it (agent, skill, function, playbook, automation, trigger, evolution) became one Helper, and
> the `HOMEOPS_ASSISTANT_ENGINE=legacy` rollback flag was removed along with the legacy planner
> it restored. Read that document for the current shape.

**Baseline before this work:** HEAD `545ebdd`, 1,169 server tests passing, web + mobile typechecks clean.
**After:** 1,207+ server tests + 37 web unit tests + 56 mobile unit tests passing; `npm run build` clean; mobile `tsc --noEmit` clean.

## 1. The chat engine is now the Vercel AI SDK `ToolLoopAgent`

The previous "Ask Famili" brain (`server/planner.mjs` `assistantRespond` / `assistantStream`) made **one** model call that emitted a JSON envelope — `answer | lookup | plan | build`. A `plan` was a static list of steps that `engine.mjs` executed later with extra per-step model calls ("reasoning" and "input fill"), and a failed run got a separate "repair" pass that invented a new plan. The model never observed a tool result and decided what to do next. That is why the chat could not reliably do real work or recover from its own mistakes.

The replacement is the standard agent loop, on a battle-tested library:

| | |
|---|---|
| Engine | `server/assistant-agent.mjs` — `ToolLoopAgent` from `ai@7` (Vercel AI SDK) |
| Models | `server/ai-model.mjs` — every provider the app already supports (OpenAI, Anthropic, Gemini, OpenAI-compatible, LM Studio, Ollama via its `/v1` surface), keys still only in the vault, every request through a guarded `fetch` that enforces `net.mjs`'s egress policy |
| Tools | the live tool catalog (connected providers + connectors + `homeops.*` internal functions + **registered household functions**, which were never in the catalog before), plus native tools the catalog lacked: list/update/delete events, list/update/delete tasks, list meals, roster, memory search, pending approvals, and `famili.propose_build` for durable helpers/automations |
| Safety | unchanged. Every tool call goes through `engine.executeToolForChat` → the same `resolveTool` → agent allow/deny → `resolveEffectivePolicy` (kill switch, always-approve, overrides) chain a run step uses. Anything that needs approval is **not executed in the turn**: it becomes a one-step durable run via `orchestrate()`, which creates the approval, parks, notifies, and later consumes it exactly as scheduled runs do. The model is told the step is *waiting* and says so. |
| Routes | `POST /api/assistant` and `POST /api/assistant/stream` unchanged in shape; results are `kind: "answer" \| "build"` with `toolCalls[]`, `runId`/`run` when a step was queued, `runIds[]`. The stream additionally emits `phase: "thinking"` before the first model call, `delta` (reply text), and `tool` frames. |
| Rollback | `HOMEOPS_ASSISTANT_ENGINE=legacy` restores the previous planner byte-for-byte. The legacy suites run under that flag. |
| Tests | `server/test/assistant-agent.test.mjs` drives the loop through the real server against a scripted OpenAI-compatible tool-calling model server. |

Both clients render the turn's tool activity (✓ done / ⏳ waiting for approval / ⚠ failed) under the answer, stream the reply text live, and attach to a queued run regardless of `kind`.

## 2. Household time

New `server/time-math.mjs` (pure) + `server/household-time.mjs` (store-reading). The household's declared `settings.timezone` now governs: the assistant's "today" boundary, all-day event midnights from Google/ICS, Google push payloads (real instants; no more zoneless start beside a UTC end), meal/task → calendar instants, reminder wording, notification stamps, trigger schedule copy, and re-anchoring of scheduled triggers when the timezone changes. ICS `TZID` and `DURATION` are honoured.

## 3. Data-consistency fixes (server)

- Meal PATCH keeps the linked calendar event and grocery list in step; `plan_meal` no longer erases a meal's date when re-planned without one; `replace:true` retires the old meal's event and unlinks its groceries; the week-full case says it double-booked; `GET /api/meals` hides archived meals.
- Task PATCH mirrors title/time to its calendar event; task DELETE removes the mirror (and Google copy).
- Google subscription sync pulls 30 days back, follows `nextPageToken`, and only removes events inside the pulled window (it used to delete every synced event the moment it ended). A canonical event whose Google copy could not be deleted is tombstoned so it is never re-imported.
- Calendar **event reminders** (`remindOffsets`) — swept every 30 s beside task reminders, pushed to the people on the event, worded on the household clock.
- `DELETE /api/memory/:id` uses the same visibility rule as GET (no adult bypass, nest-scoped); `write_memory` defaults to `household` and maps the legacy `family` scope.
- `setSettings` bumps the right tenant's sync rev; repeat "request to attend" taps no longer re-notify; contact-method PATCH/DELETE are adult-or-self; events can be nest-scoped through `resolveVisibility`; archiving a member closes their contact methods and push tokens; `findRunByApprovalId` searches by status; per-run emitters are released; the repair path goes through `orchestrate()`; `create_event_draft`/`create_task` refuse unparseable stamps and understand date-only starts as all-day.

## 4. Web client

Local-day bucketing (`lib/dates.ts`: `dayKey`, `isLive`, `isTodayEvent`, `spanDayKeys`, `eventTimeLabel`) used by Dashboard, Calendar, Meals, scoped views and the briefing — one definition of "today". All-day events render as "All day", span every day, never vanish at noon. Calendar honours `{event}`/`{new}` params, has End and All-day fields in the composer and drawer, and surfaces the Google-delete outcome. Agent edits/status/delete persist to the server; "Request to share" creates a real approval; briefing/suggestions read server approvals; run-status vocabulary unified; Grocery List mini app renders the real list; task writes roll back and toast on failure; search covers events/tasks/chats; several dead controls and links removed or repaired; CSRF derived from the HTTP method.

## 5. Mobile

Effective-end handling for all-day/multi-day events, week separators, subscriptions folded near Sync, event reminders in the form, Google-delete outcome surfaced, tool-call receipts and live text in Ask, `WEB_URL` derived from `API_URL`.

## Still open (not done in this pass)

- Sensitive Info Vault surface (only a banner exists).
- Automations are still client-local (no `/api/automations`); chat-built ones live under Triggers.
- Memory dedupe is exact-text only.
- `oauth.mjs rawFetch` and the Expo push calls still bypass `net.mjs`; no egress ledger.
- The `truncate` sweep at 428 px on web.
- Playwright `tests/topgun` still outside CI.
