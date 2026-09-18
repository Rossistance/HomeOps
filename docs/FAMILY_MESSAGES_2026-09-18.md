# Family Messages and the redesigned Inbox — what shipped on 2026-09-18

Spec: `docs/superpowers/specs/2026-09-18-family-messages-design.md`. Plan:
`docs/superpowers/plans/2026-09-18-family-messages.md`. Nothing here was exercised on a
simulator or TestFlight by the implementer; the review is yours.

## The Inbox now reads Messages · Approvals · Updates

- **Messages** — the family talking to each other (below).
- **Approvals** — unchanged.
- **Updates** — every delivery, grouped by who sent it. A chip row across the top lists every
  helper (before its first run, too), Famili, Family and System; **Open chat** beside it opens
  the selected helper's own thread. Each row expands in place to the whole deliverable and
  offers Open chat, Open (the event/task/thread it names) and Share. The old Chats segment
  is gone; Ask's own thread list is unchanged.
- In-app notifications now record `source` (helper / member / thread / system), the
  helper's `conversationId`, and a `threadId` for chat messages.

## Messages

Threads between members, direct or group, in their own collections
(`family_threads.json`, `family_messages.json`; rules in `server/family-messages.mjs`,
HTTP in `server/family-messages-routes.mjs`).

**Who may message whom.** Adults (Owner, Adult Admin, Adult Member) → any adult. Owner and
Adult Admin → any child (Child View, Limited Member). Adult Member → a child only inside their
own nest. Children reply but never start. Guest/Helper has no Messages. A group may be
started or grown only with people the actor could message directly; any adult in the chat
can add someone; Owner/Adult Admin or the chat's creator can remove someone; anyone can
leave. Parents can read a child's threads (`GET /api/threads?actorId=<child>`) without
posting in them.

**What a thread does.** Direct threads are unique per pair and become a group in place when
someone is added (history kept, "Ross added GPop" recorded). Per-person read cursor →
unread counts and "Seen / Seen by …" receipts. Mute (8 h, until tomorrow, forever): the
in-app row and unread count still arrive, the push does not. Edit and delete your own
messages (a parent may delete anyone's) with honest tombstones. Reactions (six emoji,
toggle). Typing indicator (6-second TTL, in memory). Search across my threads and inside a
thread with jump-to-message. Rename a group.

**Attachments.** Photos (library or camera, resized like every other image), files, and
hold-to-record voice notes (`expo-audio`, `.m4a`) upload through `/api/files` with
`kind: "message"` and the thread's participants as readers; the Library hides them like it
hides avatars. Voice notes play inline with a scrubber. A transcript field exists on the
attachment but nothing fills it yet — the file-understanding path has no audio provider.

**Sharing.** Share to a chat from the event form, the task sheet, a Library file, a grocery
item's menu, a meal card and an expanded Update. The message carries a reference; the card
is resolved at read time for each reader (`server/share-preview.mjs`), so a private item
stays hidden from someone who could not open it.

**Notifications.** Every message writes an in-app row for the other participants and a push
(`categoryId: "family_message"`, the whole message up to 1,000 characters, `data: { type:
"thread", id, messageId }`). Unread, unmuted chats appear under Needs your attention on
Today. Tapping any push now routes to what it names (thread, event, task, approval, help
request), including from a cold start.

**Reply from the banner.** The app registers the `family_message` category with a Reply
text action and Mark read; a reply is posted without opening the app and queued if the
network is down. This appears only on a build made after this change (native categories).

## Suggestions

After a text message is stored, Famili reads it (`server/message-suggestions.mjs`) with the
sender's visible events, tasks and pending help requests for the next 30 days in hand and
attaches up to three suggestions to the message: create an event/task/help request, or
update an existing one. They render as small chips in a rail beside the bubble, never inside
it. Tap → a card with the proposed change, Add / Update / Ask owner, Dismiss.

- Applying is serialized per thread; the first tap wins, the second gets `already_taken`,
  and the chip disappears for everyone on the next poll.
- A create whose normalized title already exists that day closes as `duplicateOf` instead of
  a second copy.
- An update to an item you own, or when you are Owner/Adult Admin, is applied directly. Any
  other member's tap becomes a "Can you help?" to the owner carrying the concrete change
  (`Please update “Soccer practice”: location: Field 7`).
- A system line in the thread records who did what.
- Gated by the household AI budget (`recordAiUsage(…, "suggest")`); no tools, no autonomy.
- `HOMEOPS_SUGGEST_FAKE=1` (non-production) swaps the model for bracketed directives so the
  whole path is testable.

## Routes

`GET/POST /api/threads`, `GET /api/threads/search?q=`, `GET|PATCH /api/threads/:id`,
`POST /api/threads/:id/{messages,read,typing,mute,members,leave}`,
`DELETE /api/threads/:id/members/:actorId`, `PATCH|DELETE /api/threads/:id/messages/:mid`,
`POST /api/threads/:id/messages/:mid/reactions`,
`POST /api/threads/:id/messages/:mid/suggestions/:sid { action }`.

## Tests

`server/test/family-messages.test.mjs` (10), `server/test/message-suggestions.test.mjs` (5),
`server/test/notification-source.test.mjs` (2); `apps/mobile/src/lib/messages.test.mjs` (7).
Full server suite 1140 passing; mobile `tsc` clean.

## What to try on TestFlight

1. Inbox → Messages → New → pick Melissa → send text, a photo, a voice note.
2. From the thread's ⋯ menu add GPop; confirm the system line and that GPop sees history.
3. Mute the thread on one phone, send from another: in-app row yes, banner no.
4. Say "Dentist for Amelia Thursday at 3" and watch for the calendar chip beside the bubble;
   tap it, Add; try the same on the other phone — it should say someone already did it.
5. Long-press a bubble: react, edit, delete.
6. Share an event from its form; open the card from the chat.
7. Reply to a message from the lock-screen banner.
