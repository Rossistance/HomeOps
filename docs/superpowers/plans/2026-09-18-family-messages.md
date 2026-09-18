# Family Messages and the redesigned Inbox — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the spec in `docs/superpowers/specs/2026-09-18-family-messages-design.md`: Inbox reads Messages · Approvals · Updates; Updates merges helper deliverables with their chat threads; a full family messaging module with attachments, sharing, inline suggestions, muting, edits, receipts, typing, reactions, search, voice notes; iOS reply-from-notification; one EAS build at the end.

**Architecture:** A new server module `server/family-messages.mjs` owns two id-keyed collections (`family_threads.json`, `family_messages.json`) and every rule (who may message whom, read cursors, mute, edit/delete, reactions, search). A thin route file `server/family-messages-routes.mjs` maps `/api/threads/*` onto it and is called from `index.mjs` before the 404. Suggestions live in `server/message-suggestions.mjs` (JSON-mode model call, apply/dismiss with an atomic flip). Mobile adds a `messages/` route group, a `ShareToThreadSheet`, and extends `api.ts`; the Inbox screen is rewritten around the three segments.

**Tech Stack:** Node 24 plain-http server, per-tenant SQLite-backed JSON collections (`keyedCollection`), `node:test`; Expo 56 / expo-router / React Native, `expo-notifications`, `expo-image-picker`, `expo-document-picker`, `expo-av` (new); Vercel AI SDK stays untouched (suggestions use `providerChatWithFallback`).

## Global Constraints

- Roles: `Owner, Adult Admin, Adult Member, Limited Member, Child View, Guest/Helper` (`server/auth.mjs`). Adults = `isAdultRole` (Owner, Adult Admin, Adult Member). Parents = Owner, Adult Admin. Children = Child View, Limited Member. Guest/Helper is excluded from Messages entirely.
- Every collection write goes through `keyedCollection` so `GET /api/rev` bumps.
- All AI calls gate on `aiBudgetExhausted(householdId)` and meter with `recordAiUsage(householdId, "suggest")`.
- Text limits: message 4000, thread title 80, push body 1000.
- Ids: `fth_<16 hex>`, `fmsg_<16 hex>`, `sug_<8 hex>`.
- Notifications carry `source: { kind, id?, name? }` and `data: { type, id }`; `data.type` values: `thread | event | task | approval | help_request | file`.
- No simulator or TestFlight testing by the implementer; verification is `npm test`, mobile `node --test apps/mobile/src/lib/*.test.mjs`, and `npx tsc --noEmit -p apps/mobile`.
- One commit per task, message body explains the why, attribution line as configured.

## File structure

Server (new): `server/family-messages.mjs` (rules + collections), `server/family-messages-routes.mjs` (HTTP), `server/message-suggestions.mjs` (extract/apply), `server/share-preview.mjs` (resolve `ref` attachments), `server/test/family-messages.test.mjs`, `server/test/message-suggestions.test.mjs`, `server/test/share-preview.test.mjs`.
Server (modified): `server/store.mjs` (collection accessors, `listNotifications` unchanged), `server/notify.mjs` (`source` on in-app records, `pushToMember` gains `categoryId`, `bodyLimit`), `server/index.mjs` (delegate, `GET /api/files` filter `kind:"message"`, `POST /api/files` accepts `kind`, `participantIds`).
Mobile (new): `apps/mobile/src/app/(home)/messages/index.tsx` is NOT used — thread list lives inside Inbox; `apps/mobile/src/app/(home)/messages/[id].tsx` (thread), `apps/mobile/src/app/(home)/messages/new.tsx` (member picker), `apps/mobile/src/components/sheets/share-to-thread-sheet.tsx`, `apps/mobile/src/components/messages/bubble.tsx`, `apps/mobile/src/components/messages/share-card.tsx`, `apps/mobile/src/components/messages/suggestion-rail.tsx`, `apps/mobile/src/components/messages/voice-note.tsx`, `apps/mobile/src/lib/messages.ts` (pure helpers + tests), `apps/mobile/src/lib/notification-routing.ts`.
Mobile (modified): `apps/mobile/src/app/(home)/inbox.tsx` (rewrite), `apps/mobile/src/app/(home)/index.tsx` (Needs your attention), `apps/mobile/src/app/(home)/_layout.tsx` (routes), `apps/mobile/src/app/_layout.tsx` (categories + response listener), `apps/mobile/src/lib/api.ts` (types + methods), `apps/mobile/src/components/sheets/upload-sheet.tsx` (25 MB cap), event form / task sheet / library / help rows (share icon), `apps/mobile/app.json` (expo-av plugin if needed), `apps/mobile/package.json` (`expo-av`).

---

## Phase 1 — Inbox restructure and merged Updates

### Task 1: Notifications carry their source

**Files:** Modify `server/notify.mjs:272` (in_app write), `server/notify.mjs:72-100` (`pushToMember`); Test `server/test/notify-contact-delivery.test.mjs` (extend).

**Interfaces:**
- Produces: in-app notification records gain `source: { kind: "helper"|"assistant"|"system"|"member"|"thread", id?: string, name?: string }` and, for helpers, `conversationId` (the helper's thread) so the client can open the chat without a second lookup.
- Produces: `pushToMember({ householdId, actorId, title, body, data, timeSensitive, categoryId, bodyLimit })` — `categoryId` becomes `categoryId` on the Expo payload; `bodyLimit` defaults to 160.

- [ ] Test: `deliverNotification` with `agentId` writes `source.kind === "helper"`, `source.id === agentId`, `source.name === agent.name`, `conversationId === agent.conversationId`; without `agentId` writes `source.kind === "member"` with the session actor.
- [ ] Implement in `deliverViaChannel`: `const agent = agentId ? getAgent(agentId) : null; const source = agent ? { kind: "helper", id: agent.id, name: agent.name } : { kind: "member", id: session.actorId, name: getMember(session.actorId)?.displayName ?? null };` and spread `source, conversationId: agent?.conversationId ?? null` into `addNotification`.
- [ ] `pushToMember`: add `categoryId` and `bodyLimit` params; payload `...(categoryId ? { categoryId } : {})`, `body: String(body ?? "").slice(0, bodyLimit)`.
- [ ] Run `node --test server/test/notify-contact-delivery.test.mjs`; commit.

### Task 2: `NotificationRec` and the Inbox rewrite (Messages · Approvals · Updates)

**Files:** Modify `apps/mobile/src/lib/api.ts:665` (type + `notifications()`), rewrite `apps/mobile/src/app/(home)/inbox.tsx`; Test `apps/mobile/src/lib/messages.test.mjs` (source grouping helper).

**Interfaces:**
- Produces `export interface NotificationRec { id; channel; title; body; read; createdAt: number; data?: { type?: string; id?: string }; source?: { kind: string; id?: string; name?: string }; conversationId?: string | null; threadId?: string | null }`.
- Produces `apps/mobile/src/lib/messages.ts`: `export function notificationSources(notes: NotificationRec[], helpers: { id: string; name: string; conversationId?: string|null }[]): { key: string; label: string; kind: string; conversationId?: string|null }[]` — "all" first, then each helper (from helpers list, so helpers with no updates still appear), then "Famili", "System", "Family" when rows exist.
- Segment type `"messages" | "approvals" | "updates"`; Messages segment renders `<ThreadList />` from Task 8 (until then, an empty state "Messages arrive in Phase 2" is NOT acceptable — Task 2 ships the segment order with Messages showing the `EmptyState` "No messages yet" and a disabled New message button; Task 8 replaces it).

- [ ] Test `notificationSources`: helpers appear even without rows; "System" only when an untagged row exists; keys stable (`helper:<id>`, `assistant`, `system`, `thread`).
- [ ] Rewrite `inbox.tsx`: segments in order; `updates` state: `sourceKey` (default `all`), `expandedId`; rows filtered by source; row tap toggles expansion and marks read on first expansion; expanded row shows full body via `Markdown`-free `T` with `selectable`, footer buttons: **Open chat** (`router.push({ pathname: "/(ask)", params: { c: n.conversationId } })`) when `conversationId`, **Open** for `data.type` in `event|task|thread`.
- [ ] Top bar: `ChipRow` of sources (horizontal scroll) — the "dropdown" is a chip row on mobile, same information; beside the header an **Open chat** button enabled when the selected source is a helper (`conversationId` present).
- [ ] Remove the chats segment code; keep Delivery check card in Updates.
- [ ] `npx tsc --noEmit -p apps/mobile`; commit.

---

## Phase 2 — Messages core

### Task 3: `family-messages.mjs` — permissions and threads

**Files:** Create `server/family-messages.mjs`; Modify `server/store.mjs` (append two collections after `_notifications`); Test `server/test/family-messages.test.mjs`.

**Interfaces (all exported):**
```js
canMessage(fromMember, toMember, { nestOf }) -> { ok: boolean, reason?: "guest"|"child_cannot_start"|"not_parent"|"different_nest"|"archived"|"self" }
listThreadsFor(actorId, householdId, { includeChildOf?: actorId }) -> Thread[] (with unreadCount, members, lastPreview)
createThread({ householdId, actorId, participantIds, title }) -> { ok, thread } | { ok:false, error, who }
getThreadFor(id, actorId) -> Thread | null      // null when not a participant (or a parent viewing a child)
listMessages(threadId, { before, limit=50, forActorId }) -> Message[]   // respects leftAt for removed members
postMessage({ threadId, fromActorId, text, attachments, kind="text" }) -> Message
markRead(threadId, actorId) -> Thread
setMute(threadId, actorId, until) -> Thread      // until: ISO string | null (forever) | 0 (unmute)
addMember(threadId, byActorId, actorId) -> { ok, thread } | { ok:false, error }
removeMember(threadId, byActorId, actorId) -> same
leaveThread(threadId, actorId) -> same
renameThread(threadId, byActorId, title)
editMessage(threadId, messageId, byActorId, text) / deleteMessage(...)
toggleReaction(threadId, messageId, actorId, emoji) -> Message
searchMessages(actorId, householdId, q, { limit=50 }) -> { threadId, message }[]
setTyping(threadId, actorId) / whoIsTyping(threadId, exceptActorId) -> actorId[]   // in-memory, 6 s TTL
recipientsFor(thread, fromActorId) -> { actorId, muted: boolean }[]
```
Thread record: `{ id, householdId, kind:"direct"|"group", title, participantIds, createdBy, createdAt, updatedAt, lastMessageAt, lastPreview:{ from, text }|null, members: { [actorId]: { joinedAt, leftAt: null|ISO, lastReadAt: null|ISO, mutedUntil: null|ISO|"forever" } }, archived:false }`.
Message record: `{ id, threadId, householdId, fromActorId, at, kind:"text"|"system"|"share", text, attachments:[], reactions:{}, suggestions:[], editedAt:null, deletedAt:null }`.
Store: `export const listFamilyThreads/getFamilyThread/putFamilyThread/patchFamilyThread` and `listFamilyMessages/getFamilyMessage/putFamilyMessage/patchFamilyMessage` via `keyedCollection("family_threads.json")`, `keyedCollection("family_messages.json")`.

- [ ] Tests (harness `startServer`, `makeSession`; create an Adult Member and a Limited Member via `POST /api/members` as Owner; nests via `POST /api/nests`): permission matrix — adult→adult ok; Owner→child ok; Adult Member→child in same nest ok, different nest `different_nest`; child→anyone `child_cannot_start`; guest `guest`; self `self`.
- [ ] Tests: direct thread unique per pair (second create returns same id); group needs ≥3 participants; `unreadCount` counts messages after `lastReadAt` from others; `markRead` zeroes it; `leftAt` hides later messages; `addMember` by a child is refused; `removeMember` by Owner ok, by non-creator adult refused; rename only for groups.
- [ ] Implement `family-messages.mjs` (pure functions over the store; no HTTP). `searchMessages` filters `listFamilyMessages` on my threads by `text.toLowerCase().includes(q)` or attachment `name` (SQLite `LIKE` is not exposed by the store; in-memory filter over the household's rows, newest first, 50).
- [ ] Run the test file; commit.

### Task 4: Routes, notifications and pushes

**Files:** Create `server/family-messages-routes.mjs`; Modify `server/index.mjs` (call `if (path.startsWith("/api/threads")) { const r = await handleFamilyMessageRoutes({ req, res, path, method, gate, json, readBody, audit }); if (r) return; }` right before the help-requests block); Test extend `family-messages.test.mjs` (HTTP layer).

**Routes:** as in the spec plus `POST /api/threads/:id/mute { until }`, `PATCH|DELETE /api/threads/:id/messages/:mid`, `POST /api/threads/:id/messages/:mid/reactions { emoji }`, `DELETE /api/threads/:id/members/:actorId`, `GET /api/threads/search?q=`, `POST /api/threads/:id/typing`, `GET /api/threads?actorId=<child>` (parents only). `GET /api/threads/:id` returns `{ thread, messages, readBy: { actorId: lastReadAt }, typing: [actorId], members: [{ actorId, displayName, color, role }] }`.

- [ ] Tests: unauthenticated 401; non-participant 404; post text → other participants get `addNotification` with `source.kind==="thread"`, `threadId`, `data.type==="thread"` and sender gets none; muted participant gets the in-app row but `pushToMember` is not called (spy via `globalThis.__pushSpy` set in test; add a tiny `setPushSender(fn)` hook in notify.mjs for tests); typing TTL expires.
- [ ] Implement routes; notification title: direct → sender name; group → `${sender} · ${title ?? names}`; body: text or `📷 Photo` / `📎 ${name}` / `🎤 Voice note`; push `categoryId: "family_message"`, `bodyLimit: 1000`, `data: { type: "thread", id, messageId }`.
- [ ] Commit.

### Task 5: Mobile API client and pure helpers

**Files:** Modify `apps/mobile/src/lib/api.ts` (types + methods); Create `apps/mobile/src/lib/messages.ts`; Test `apps/mobile/src/lib/messages.test.mjs`.

**Interfaces:**
```ts
export interface ThreadMemberRec { actorId; displayName; color?; role; joinedAt; leftAt: string|null; lastReadAt: string|null; mutedUntil: string|null }
export interface ThreadRec { id; kind: "direct"|"group"; title: string|null; participantIds: string[]; members: ThreadMemberRec[]; lastMessageAt: string|null; lastPreview: { from: string; text: string }|null; unreadCount: number; muted: boolean; createdBy: string }
export interface MessageAttachment { kind: "file"; fileId: string; name?: string; mime?: string; audio?: { durationMs: number } } | { kind: "ref"; type: ShareType; id: string; preview?: SharePreview }
export interface MessageRec { id; threadId; fromActorId; at; kind: "text"|"system"|"share"; text; attachments: MessageAttachment[]; reactions: Record<string,string[]>; suggestions: SuggestionRec[]; editedAt: string|null; deletedAt: string|null }
api.threads(), api.childThreads(actorId), api.createThread(participantIds, title?), api.thread(id, before?), api.sendMessage(id, { text, attachments? }), api.markThreadRead(id), api.muteThread(id, until), api.addThreadMember(id, actorId), api.removeThreadMember(id, actorId), api.leaveThread(id), api.renameThread(id, title), api.editMessage(id, mid, text), api.deleteMessage(id, mid), api.reactToMessage(id, mid, emoji), api.searchMessages(q), api.typing(id)
```
`messages.ts`: `groupByDay(messages, tz?)`, `threadTitle(thread, meActorId)` ("Melissa", "Melissa, GPop", or title), `canStartWith(me: MemberRec, other: MemberRec, nests)` mirroring server `canMessage` for the picker, `formatDuration(ms)`.

- [ ] Tests for the four helpers; implement; `tsc`; commit.

### Task 6: Thread screen

**Files:** Create `apps/mobile/src/app/(home)/messages/[id].tsx`, `apps/mobile/src/components/messages/bubble.tsx`; Modify `(home)/_layout.tsx` (Stack.Screen `messages/[id]` with header hidden, `messages/new`).

- [ ] Inverted `FlatList` of `MessageRec` with day separators, own bubbles right (ember tint), others left with initial avatar + name in groups; `system` lines centred muted; deleted → "Message deleted" italic; `editedAt` → "edited" caption; reactions pills under bubble; long-press → action sheet (React, Edit, Delete for own, Copy).
- [ ] Composer: text input (multiline), attach button (Task 10), send; `api.typing` throttled 3 s; poll `api.thread(id)` every 4 s while focused; on open `markThreadRead`.
- [ ] Header: title, participant avatars, ⋯ menu: Add people (Task 7 picker in add mode), Mute (8h / until tomorrow / forever / unmute), Rename (group), Leave, Remove person (allowed roles), Search in thread (jump-to with highlight).
- [ ] "Seen by …" under the last message each reader passed (direct: single "Seen").
- [ ] `tsc`; commit.

### Task 7: New message / add people picker

**Files:** Create `apps/mobile/src/app/(home)/messages/new.tsx` (params: `threadId?` for add mode).

- [ ] Members grouped Adults / Kids, filtered by `canStartWith`; multi-select; in add mode exclude current participants; Create → `api.createThread` then `router.replace` to the thread; Add → `api.addThreadMember` per pick.
- [ ] `tsc`; commit.

### Task 8: Inbox Messages segment, Needs your attention, push routing

**Files:** Modify `inbox.tsx` (ThreadList rows + New message + search field), `(home)/index.tsx` (unread threads in Needs your attention), `apps/mobile/src/lib/notification-routing.ts` (new), `apps/mobile/src/app/_layout.tsx`.

- [ ] `routeForNotification(data): string | null` — `thread → /messages/<id>`, `event → /event-form?id=`, `task → /tasks?id=`, `approval → /inbox` (segment approvals), `help_request → /help`; unit test.
- [ ] `_layout.tsx`: `Notifications.addNotificationResponseReceivedListener` → `router.push(route)`; also `getLastNotificationResponseAsync` on cold start.
- [ ] Inbox Messages: rows (avatar stack, title, preview, ago, unread badge, muted icon), search field → `api.searchMessages` results list; New message button.
- [ ] Home: unread, unmuted threads appear under Needs your attention as rows; count includes them.
- [ ] `tsc`; commit.

---

## Phase 3 — Attachments and sharing

### Task 9: Server — message files and share previews

**Files:** Modify `server/index.mjs` (`POST /api/files` accepts `kind: "message"` and `participantIds`; `GET /api/files` hides `kind:"message"` unless `include=all`), create `server/share-preview.mjs`; Test `server/test/share-preview.test.mjs`.

**Interfaces:** `resolvePreview({ type, id }, session) -> { title, subtitle, when?, status?, route } | { hidden: true }` for `event | task | file | meal | list_item | help_request | notification`. `listMessages` (Task 3) maps `ref` attachments through it when `forActorId` is given.

- [ ] Tests: event preview shows title + when; a private event of another member returns `hidden`; message file not in `GET /api/files` default listing.
- [ ] Implement; commit.

### Task 10: Mobile — composer attachments and bubble rendering

**Files:** Modify `[id].tsx`, `bubble.tsx`; Create `apps/mobile/src/components/messages/share-card.tsx`; Modify `upload-sheet.tsx:17` (`MAX_BYTES = 25 * 1024 * 1024`).

- [ ] Attach menu: Photo library (multi), Camera, Document → `prepareImage` for images, `api.uploadFile({ ..., kind: "message", participantIds })`, then send with `{ kind: "file", fileId, name, mime }`; upload progress shown as a pending bubble.
- [ ] Bubbles: image thumbnails via `expo-image` from `GET /api/files/:id/content` (data URI), tap → full-screen modal; document tile opens `/library?file=`; `ShareCard` renders preview with an **Open** button by type.
- [ ] Commit.

### Task 11: Share to a thread from everywhere

**Files:** Create `apps/mobile/src/components/sheets/share-to-thread-sheet.tsx`; Modify event form, task sheet, library file rows, meals/groceries item long-press, help rows, Updates rows (a share icon → sheet).

- [ ] Sheet: preview card of the item, thread list (plus "New message"), optional note, Send → `api.sendMessage(threadId, { text: note, attachments: [{ kind: "ref", type, id }] })`.
- [ ] Wire the six entry points; `tsc`; commit.

### Task 12: Voice notes

**Files:** `apps/mobile/package.json` (+`expo-av`), `app.json` (microphone permission string), create `apps/mobile/src/components/messages/voice-note.tsx`; server: `family-messages.mjs` accepts `audio: { durationMs }` on file attachments; `share-preview` untouched.

- [ ] Hold-to-record button in composer → `.m4a` → upload as message file with `audio.durationMs`; playback tile with play/pause and progress; server tries `understandFile` transcript when available and stores `transcript` on the attachment (best effort, non-blocking).
- [ ] Commit.

---

## Phase 4 — Inline suggestions

### Task 13: `message-suggestions.mjs`

**Files:** Create `server/message-suggestions.mjs`; Test `server/test/message-suggestions.test.mjs` (fake provider via `setSuggestionModel(fn)` test hook that replaces the model call).

**Interfaces:**
```js
suggestForMessage({ message, thread, session }) -> Suggestion[]   // stored on the message
applySuggestion({ threadId, messageId, suggestionId, session, action:"apply"|"dismiss" }) -> { ok, suggestion, created?: { type, id }, requested?: { toActorId } } | { ok:false, error: "already_taken"|"duplicate_of"|... }
```
Suggestion: `{ id, kind:"create"|"update", type:"event"|"task"|"help", title, summary, patch, targetId, ownerActorId, status:"open"|"applied"|"dismissed", by, at, result }`.
Prompt input: last 6 messages, member names, household timezone/today, the sender's visible events/tasks/help requests in the next 30 days (title, id, when, owner). Output JSON `{ suggestions: [ { kind, type, title, summary, patch, matchesExistingId } ] }`, max 3.

- [ ] Tests: create-task suggestion applied by a member creates a task and flips status; second apply returns `already_taken`; a create whose normalized title exists that day returns `duplicate_of` and marks the suggestion applied with `result.duplicateOf`; an update to another member's event by a non-parent becomes a help request to the owner; budget exhausted → no suggestions.
- [ ] Implement; apply paths: task → `INTERNAL_FUNCTIONS["homeops.create_task"].run`; event → `putEvent` with the patch (same shape `homeops.create_event_draft` writes); help → the help-request creation logic factored into `createHelpRequest()` exported from index.mjs's block (move the body into `server/help-requests.mjs` so both routes and suggestions call it); update: `patchEvent/patchTask` directly when owner or parent, else help request "Please update <title>: <summary>".
- [ ] Hook: `postMessage` (Task 3) schedules `suggestForMessage` via `setImmediate` for `kind:"text"` from a human; results patched onto the message; a `system` line is written when a suggestion is applied.
- [ ] Route: `POST /api/threads/:id/messages/:mid/suggestions/:sid { action }`; commit.

### Task 14: Suggestion rail on mobile

**Files:** Create `apps/mobile/src/components/messages/suggestion-rail.tsx`; Modify `bubble.tsx`, `api.ts` (`api.actOnSuggestion(id, mid, sid, action)`).

- [ ] Rail: 28-px column to the right of the bubble (left for own messages) with one chip per open suggestion (`calendar`, `checkmark.circle`, `hand.raised`); tap → `HSheet` card: title, summary, patch lines, **Add/Update/Ask owner** and **Dismiss**; result toast; the chip disappears for everyone on the next poll.
- [ ] Commit.

---

## Phase 5 — iOS notification actions

### Task 15: Categories, Reply action, background send

**Files:** Modify `apps/mobile/src/app/_layout.tsx`, `apps/mobile/src/lib/notification-routing.ts`.

- [ ] At startup: `Notifications.setNotificationCategoryAsync("family_message", [{ identifier: "reply", buttonTitle: "Reply", textInput: { submitButtonTitle: "Send", placeholder: "Message" }, options: { opensAppToForeground: false } }, { identifier: "mark_read", buttonTitle: "Mark read", options: { opensAppToForeground: false } }])`.
- [ ] Response listener: `actionIdentifier === "reply"` → `api.sendMessage(data.id, { text: response.userText })` (queue through `offline-queue` on failure); `mark_read` → `api.markThreadRead`; default → route.
- [ ] Commit.

### Task 16: Final verification and build

- [ ] `npm test` all green; `node --test apps/mobile/src/lib/*.test.mjs`; `npx tsc --noEmit -p apps/mobile`.
- [ ] `docs/FAMILY_MESSAGES_2026-09-18.md` write-up (routes, rules, what to try on TestFlight); commit; push.
- [ ] EAS production build (`build_run`, profile `production`, autoSubmit) → report the build number. No simulator/TestFlight testing.
