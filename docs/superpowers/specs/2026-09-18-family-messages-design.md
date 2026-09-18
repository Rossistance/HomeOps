# Family Messages and the redesigned Inbox — design

Date: 2026-09-18. Status: proposed, awaiting approval. Mobile-first; the server API is
shared with web, but the web Messages screen is a follow-up.

## What is being built

1. **Inbox reads Messages · Approvals · Updates**, left to right. Messages is new.
   Approvals is the existing segment. Updates absorbs today's "Chats" segment.
2. **Updates**: every helper deliverable is a row that expands in place to the full
   text. A dropdown at the top filters by source (All, each helper, Famili, System); next
   to it, **Open chat** jumps to the selected helper's own thread. Rows from helpers
   carry that link individually too.
3. **Messages**: direct and group threads between family members, with membership that
   can grow; a thread's notifications land in Updates, in "Needs your attention" on
   Home, and as iOS pushes with the message text and an inline Reply action.
4. **Attachments and sharing**: photos and files in messages; any event, task, file,
   meal, list item, help request or helper update can be shared into a thread as a
   preview card from wherever it lives in the app.
5. **Inline intelligence**: after a message, Famili may suggest a new calendar, task or
   help item, or an update to an existing one, off to the side of the bubble. One tap
   applies it; once anyone applies or dismisses it, it is gone for everyone; ownership
   decides whether applying edits directly or asks the owner.

Built in that order, one commit per phase, each usable on its own.

## Decisions I made (say so if you want a different one)

- **New storage, not the conversation model.** Conversations are single-owner records
  with an embedded message array built for the assistant. Family threads get their own
  collections (`family_threads.json`, `family_messages.json`) with participants, a
  per-person read cursor and paginated messages. They never appear in Ask's thread list.
- **Who may message whom.** Adults (Owner, Adult Admin, Adult Member) may message any
  adult. Owner and Adult Admin (the parents) may message any child (Child View, Limited
  Member). Adult Members may message children only inside their own nest. Children
  cannot start threads; they can reply in threads they are in. Guest/Helper roles are
  out. A group may be created, or grown, only with people the actor could message
  directly. Any adult participant can add a member; a child cannot.
- **"Help items" means help requests** ("Can you help?"): a suggestion can propose a new
  ask to a specific member, or link a message to a pending one.
- **Growing a chat keeps history.** Adding a person to a two-person thread turns it into
  a group in place; the newcomer sees the whole history. A system line records who added
  whom. Nobody is removed in v1; people can leave.
- **Suggestions are computed on the server**, once per human message, with a cheap
  JSON-mode model call (the `file-extract.mjs` pattern), gated by the household AI
  budget, never with tools. Applying one runs the same internal functions the assistant
  uses, as the person who tapped.
- **Ownership rule for updates.** If the applier owns the item (or is Owner/Adult Admin),
  the update is applied directly. Otherwise it becomes a request to the owner: for events
  the existing `requests` mechanism (attend, drive, bring) where it fits, else a help
  request "Please update … : …" with the proposed change in the note.
- **Dedupe in two layers.** (a) At suggestion time the extractor is given the member's
  visible events, tasks and help requests for the referenced dates, and must return
  `matchesExistingId` when the thing already exists, which turns "create" into "update"
  or drops it. (b) At apply time the server re-checks: create is refused with
  `duplicate_of` if an item with the same normalized title on the same day exists; two
  members tapping the same suggestion race on a single atomic status flip, so exactly one
  wins.
- **Reply from the iOS banner** uses an `expo-notifications` category with a text-input
  action; the app posts the reply through the API. This needs a new native build
  (build 71) and works only for pushes that carry the category, which is fine because
  every message push does. Full message text goes in the push body (up to 1,000 chars).
- **Realtime stays polling**: the 12-second revision poll for lists, a 4-second poll on
  an open thread, plus push. SSE later if needed.
- **Files reuse `/api/files`** with `kind: "message"` and `visibility: "private"` plus the
  thread's participants as `participantIds`, so `canSeeEntity` does the gating and the
  Library does not fill with chat photos (filtered out like avatars are).

## Phase 1 — Inbox restructure and merged Updates

Segments: `messages | approvals | updates`, default `messages` (falls back to
`approvals` when the household has no threads yet, so day one is not an empty screen).

Updates rows: `NotificationRec` gains `source` (`{ kind: "helper" | "assistant" |
"system" | "member" | "thread", id?, name? }`) and `threadId?`. `deliverViaChannel`
stamps `source` from `agentId` (the helper's id and name) when the in-app record is
written. Old records without `source` render under "System".

Row behaviour: collapsed shows title, first two lines, source chip and age; tap
expands to the full body (marks read); an expanded helper row shows **Open chat**
(`/(ask)?c=<helper.conversationId>`) and, when `data.type` is `event`/`task`/`thread`,
an **Open** button to that item.

Top bar: a `Dropdown` of sources built from the loaded rows plus the helpers list; next
to it **Open chat**, enabled when a helper is selected. "Delivery check" card stays.

Removed: the "Chats" segment and its rows. Ask's own thread list is unchanged.

## Phase 2 — Messages core

### Server

`server/family-messages.mjs` (new) owns the rules and the two collections.

Thread record:
```
{ id: "fth_<hex>", householdId, kind: "direct" | "group", title: string | null,
  participantIds: [actorId], createdBy, createdAt, updatedAt,
  lastMessageAt, lastPreview: { from, text },
  reads: { [actorId]: lastReadMessageAt },   // per-person cursor
  archived: false }
```
A `direct` thread has exactly two participants and is unique per pair (creating again
returns the existing one). Growing it flips `kind` to `group`.

Message record:
```
{ id: "fmsg_<hex>", threadId, householdId, fromActorId, at,
  kind: "text" | "system" | "share",
  text, attachments: [ { kind: "file", fileId } | { kind: "ref", type, id } ],
  suggestions: [ ...Phase 4 ], editedAt?, deletedAt? }
```

Routes (all under the session's household; `canMessage(from, to)` and
`isParticipant` are the two gates):
- `GET /api/threads` — mine, sorted by `lastMessageAt`, with `unreadCount` computed
  from `reads`.
- `POST /api/threads { participantIds, title? }` — direct if one other person,
  else group. 403 `cannot_message` names the person who cannot be included.
- `GET /api/threads/:id?before=<at>&limit=50` — thread + a page of messages.
- `POST /api/threads/:id/messages { text, attachments? }` — text ≤ 4000; bumps
  `lastMessageAt`, writes the sender's own read cursor, notifies the others.
- `POST /api/threads/:id/read` — moves my cursor to now.
- `POST /api/threads/:id/members { actorId }` — adult participants only, subject to
  `canMessage`; appends a `system` message "Ross added GPop".
- `POST /api/threads/:id/leave`.
- `PATCH /api/threads/:id { title }` — groups only.

Notifications per message, to every other participant: `addNotification` with
`channel: "in_app"`, `source: { kind: "thread", id, name }`, `threadId`, `data: { type:
"thread", id }`; `pushToMember` with `title` = sender (direct) or "Sender · Group name",
`body` = text (attachment-only messages say "📷 Photo" / "📎 name"), `data: { type:
"thread", id, messageId }`, and `categoryIdentifier: "family_message"` (Phase 5 turns
that into the Reply action; harmless before). A member's own messages produce no
notification. Muting is out of v1.

`GET /api/rev` already bumps on every collection write, so the mobile poll sees new
messages within 12 s; the thread screen polls its own endpoint every 4 s while open.

Child-safety: children's threads are readable by Owner/Adult Admin through a
`GET /api/threads?actorId=<child>` view (parents see what their children are sent); the
UI exposes it from Manage household in a later pass, the API rule ships now.

### Mobile

- `apps/mobile/src/app/(home)/messages/[id].tsx` — thread screen: inverted list of
  bubbles (own right, others left with avatar initial and colour), day separators,
  composer with attach button, header showing participants, `Add people` and `Leave`.
- Inbox Messages segment: thread rows (avatar stack, title or names, preview, age,
  unread dot), a **New message** button opening a member picker (only people I can
  message, grouped Adults / Kids), multi-select for groups.
- `api.ts`: `threads()`, `createThread()`, `thread(id, before?)`, `sendMessage()`,
  `markThreadRead()`, `addThreadMember()`, `leaveThread()`, `NotificationRec` type.
- Home "Needs your attention" adds unread family messages (a row per thread with an
  unread count, tap opens the thread); the count includes them.
- Push tap handling: `addNotificationResponseReceivedListener` in `_layout.tsx` routes
  `data.type === "thread"` to the thread, `event`/`task`/`approval`/`help_request` to
  their screens (this fixes the existing "push opens nothing" gap for everything).

## Phase 3 — Attachments and sharing

- Composer attach: photo library, camera, document (reuse the upload-sheet pickers and
  `prepareImage`; fix its 5 MB local cap to the server's 25 MB). Upload first via
  `/api/files` with `kind: "message"`, then send the message with `{ kind: "file",
  fileId }`. Bubbles render images inline (thumbnail, tap to full-screen) and documents as
  a file tile that opens the existing file preview.
- Share cards: `{ kind: "ref", type, id }` for `event | task | file | meal | list_item |
  help_request | notification`. The server resolves refs into a compact `preview`
  (title, when, who, status) at read time so the card is never stale; a ref the reader
  cannot see renders as "Shared something you don't have access to".
- Share entry point: a `ShareToThreadSheet` (thread picker with the preview card and an
  optional note) reachable from event form, task sheet, file row, meal/list item long
  press, help request row and Updates rows via a share icon. Sharing a private item does
  not change its visibility; recipients get the preview only.

## Phase 4 — Inline suggestions

- After a `text` message is stored, `suggestForMessage(message)` runs asynchronously:
  gathers the sender's visible events/tasks/help requests for the next 30 days and any
  date mentioned, calls the model in JSON mode with the last 6 messages of context, and
  stores up to 3 suggestions on the message:
```
{ id, kind: "create" | "update", type: "event" | "task" | "help",
  title, summary, patch: {...fields}, targetId?: string, ownerActorId?: string,
  status: "open" | "applied" | "dismissed", by?: actorId, at?: ISO }
```
- Rendered as a narrow rail to the right of the bubble: one small icon chip per
  suggestion (calendar / check / hand). Tap opens a card with the proposed change,
  **Add** / **Update** / **Ask owner** and **Dismiss**. The message column never
  shifts.
- `POST /api/threads/:id/messages/:mid/suggestions/:sid { action: "apply" | "dismiss" }`
  does the atomic status flip, then applies via the internal functions
  (`homeops.create_task`, `homeops.create_event_draft` → event, help request route) or
  the update path decided by ownership. The result (link to the created item, or "asked
  Melissa") is written back on the suggestion and a `system` line is added to the thread
  so everyone sees who acted.
- Budget: skipped silently when `aiBudgetExhausted`; metered as `"suggest"`.

## Phase 5 — iOS notification actions

- `Notifications.setNotificationCategoryAsync("family_message", [ { identifier:
  "reply", buttonTitle: "Reply", textInput: { submitButtonTitle: "Send", placeholder:
  "Message" } }, { identifier: "mark_read", buttonTitle: "Mark read" } ])` at app start.
- The response listener handles `actionIdentifier === "reply"` by posting
  `userText` to `/api/threads/:id/messages` without opening the UI (background task via
  the listener; on cold start it queues through the existing offline queue).
- `pushToMember` gains `categoryId` and stops truncating the body for thread pushes.
- Requires EAS build 71; verified on TestFlight, not the simulator.

## Also in scope (added 2026-09-18 on review)

- **Muting** — `reads[actorId]` becomes `members: { [actorId]: { lastReadAt, mutedUntil,
  joinedAt, leftAt } }`. A muted participant still gets the in-app row and the unread
  count, but no push and no "Needs your attention" entry. `POST /api/threads/:id/mute
  { until: ISO | null }` (null = forever, 0 = unmute).
- **Editing and deleting** — sender only, `PATCH /api/threads/:id/messages/:mid { text }`
  sets `editedAt`; `DELETE` sets `deletedAt` and blanks text/attachments (tombstone line
  "Message deleted"). Suggestions and reactions on a deleted message are dropped.
- **Read receipts** — every read moves the cursor; the thread payload returns
  `readBy: { [actorId]: lastReadAt }` and the client shows "Seen by …" under the last
  message each reader has passed. Direct threads show a single "Seen" tick.
- **Typing indicators** — `POST /api/threads/:id/typing` stamps
  `typing[actorId] = now` in memory (not persisted, per-tenant map with a 6-second TTL);
  the thread poll returns who is typing. The composer sends it at most every 3 s while
  text changes.
- **Reactions** — `POST /api/threads/:id/messages/:mid/reactions { emoji }` toggles
  the caller's reaction; stored as `reactions: { [emoji]: [actorId] }`; shown as small
  pills under the bubble; long-press opens a six-emoji picker.
- **Removing a member** — `DELETE /api/threads/:id/members/:actorId`: Owner/Adult Admin,
  or the thread creator; a parent may remove a child from any thread they can see. The
  removed person keeps read access to messages up to `leftAt` and nothing after.
- **Message search** — `GET /api/threads/search?q=` across my threads (SQLite `LIKE` on
  text and attachment names, 50 hits, newest first); a search field above the thread
  list and inside a thread (jump-to-message).
- **Voice notes** — record with `expo-av` (added dependency), stored as an `.m4a` file
  via `/api/files` (`kind: "message"`), attachment `{ kind: "file", fileId, audio:
  { durationMs } }`, played inline with a scrubber; a server-side transcript via the
  existing file understanding path when the provider supports audio, else none.

## Delivery

- One commit per phase; no simulator or TestFlight testing by me. When all five phases
  are in, one EAS production build (72 or later) is submitted to TestFlight and the
  review is yours.
- Server tests run on every phase (`npm test`); mobile unit tests (`node --test
  apps/mobile/src/lib/*.test.mjs`) and `tsc` on the app.

## Testing

Server: `family-messages.test.mjs` (permissions matrix by role and nest, direct-thread
uniqueness, growing and shrinking a group, read cursors, receipts and unread counts,
mute suppressing push, edit/delete tombstones, reactions toggle, search scope,
notifications to others only, share previews and access, suggestion apply race and
dedupe, ownership → request path, typing TTL). Mobile: `node --test` units for thread
grouping/day separators, the member-picker filter and audio duration formatting.

## Out of scope for now

Web Messages screen, message forwarding between threads, pinned messages, scheduled
sends.
