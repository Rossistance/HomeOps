# ADR-005: Calendar connections by role, Work calendars and hidden events

**Status:** Accepted · 2026-09-24. The household owner set the rules on 2026-09-24 and confirmed the gap decisions below by approving the implementation plan.
**Scope:**
- Who may see, add, sync, edit, assign and remove which connected calendar.
- How calendars refresh.
- What each person, and the assistant, is shown of an event its owner has hidden.

**Related:** ADR-003 (declared actions), ADR-004 (native tools and the channel gate) · `server/calendar-permissions.mjs` · `server/calendar-refresh.mjs` · `server/event-privacy.mjs`

## Context

The family's calendars came in through Connections with one rule: any adult could manage any calendar, and only whoever connected a calendar could sync or remove it. The owner asked for three changes.

1. **Refresh without a button.** Calendars refresh on launch, on opening the calendar, on opening an event, and on any event or task change by anyone. Manual sync lives only in Connections.
2. **A per-role Connections matrix.** It covers seeing, adding, syncing, editing, assigning and removing calendars. The Owner can also narrow what each Limited Member sees in their calendar.
3. **Work calendars and hidden events.**
   - A Work calendar's events read as "<Name> working" to the rest of the family, as blurred blocks with the owner's photo, and back-to-back events merge into one block.
   - The owner reveals one event with an eye toggle, and then everyone sees it.
   - Any adult can hide any event they own.
   - The purpose of a Work calendar is **calm, not secrecy**: the family wants the big picture, not twelve meeting titles.
   - Some hidden events **are** secrets: a birthday, an anniversary, a gift, a vacation, a surprise. The person they are hidden from may be the one asking.

Three existing behaviours would have undone this, so they were fixed as part of it:
- Linked events took `createdBy` from whoever pressed sync, and `canSeeEntity` counts `createdBy` as ownership. With automatic refresh, every child who opened the app would have become an "owner" of every calendar.
- `pullGoogleEdits` fetched other members' events with the caller's Google account, got a 404 and unlinked them. With automatic refresh that would have happened every minute.
- Several surfaces printed event titles without asking who was reading: help cards, suggestion notes, four older assistant tools, runs readable by any member, and Google's `calendar.list` in group chats.

## Decision

### 1. Every calendar has one owner, and one matrix decides who may do what

`calendarCan(viewer, sub, owner)` in `server/calendar-permissions.mjs` is the only place the matrix lives. Routes enforce it, and GET returns it per row as `can`, so the app draws buttons from the server's answer instead of repeating role logic.

| Viewer | See | Sync | Edit (name, colour, Work) | Assign | Remove | Add |
|---|---|---|---|---|---|---|
| Owner | all | all | all | yes | all | unlimited; also for any member |
| Adult Admin | all | all but the Owner's | all but the Owner's | no | own, Limited Members', children's | unlimited for self |
| Adult Member | own | own | own | no | own | unlimited for self |
| Limited Member | own | own | no | no | no | one, for self |
| Child View / Guest | nothing (legend rows only) | no | no | no | no | no |

Additional rules:
- `isWork` can be set only by someone with edit permission, and only on a calendar whose owner is an adult. Reassigning a calendar to a non-adult clears it.
- Feed URLs and pasted `.ics` text leave the server only on rows the viewer may manage.
- A boot migration names an owner for every legacy calendar and re-stamps its events' `createdBy`.

### 2. Refresh is a household operation anyone may trigger and the server makes safe

`refreshHouseholdCalendars` in `server/calendar-refresh.mjs`:
- Runs one refresh per household at a time, and at most once a minute.
- Syncs each calendar as its owner.
- Runs in the household's own tenant.

When it runs:
- Event and task writes start it without waiting.
- The app calls `POST /api/calendar/refresh` on launch, on returning to the foreground, on calendar focus, every 60 s while the calendar is open, and when an event is opened.
- `POST /api/calendar/sync-all` is kept for older app builds. It respects the one-minute floor and answers in its old response shape.

### 3. One module decides what a viewer sees of a hidden event

`server/event-privacy.mjs` gives four answers:
- **full**: the event as stored.
- **block**: "<Name> working" or "<Name> busy", the owner's time and nothing else, merged back-to-back. Blocks have their own `blk_` ids, are never editable, and fit `EVENT_RECORD`, so an older app renders them as ordinary read-only events.
- **withheld**: the owner's own surprise, when the assistant is asked where others may be listening.
- **absent**: the viewer cannot see the event at all.

Every surface that shows an event goes through it: GET /api/events, the assistant's tools and briefing, previews and help cards, reminders, suggestions, coordination and the household export. Acting on someone else's hidden event is refused with `event_hidden`, a message that names whose calendar it is and nothing more.

The event record gains:
- `shareState` (`hidden` | `shared`): the owner's per-event choice, which wins over the calendar default. A Work calendar defaults to hidden; any other calendar defaults to shown.
- `secret`: the owner's "Keep it a surprise" switch. When it is absent, the event's words decide.

The owner changes both through the sharing action. The generic PATCH strips them.

### 4. The assistant serves the owner and protects surprises

Every assistant turn is stamped by the server with an **audience**:
- `self`: the asker's own Personal Ask chat, or a 1:1 iMessage from a number that belongs to exactly one member.
- `shared`: everything else, including Family and nest Ask chats, group threads and helpers.

How that plays out:
- The owner hears their own hidden events in full in any audience. Asking counts as consent, and it never unblurs the calendar for anyone.
- Everyone else hears only the blocks.
- A **surprise** is the exception. It is released only to its owner in a `self` audience, and never pre-loaded into the prompt's briefing.
- A turn that releases a surprise records nothing: no memory in any scope, no exchange capture, no run memory. Its runs are visible only to the asker.
- Google `calendar.list` and Microsoft `mscal.list` are not offered to a `shared` audience.

### Decisions taken where the owner's rules left a gap

1. An Adult Admin treats another Admin's calendar like an Adult Member's: they may sync and edit it, but not remove it.
2. An Adult Admin may edit a Limited Member's calendar. Assigning a calendar and setting a Limited Member's view are Owner-only.
3. The one-calendar cap limits what a Limited Member adds themselves; the Owner may add more for them.
4. Only adults can hide or own a Work calendar. A demotion reveals hidden events rather than stranding them.
5. Blocks merge when the next piece starts within 15 minutes of the last one's end. All-day pieces merge across consecutive days. Timed and all-day never mix, and neither do "working" and "busy".
6. The owner can open their own hidden event to read or edit it without sharing it. Only the eye toggle shares.
7. A hidden event's reminders go to its owner only.
8. Surprises are detected by word-boundary keywords (birthday/bday, anniversary, gift, vacation, surprise, 🎂 🎁), Google's birthday type, and the owner's explicit switch, which always wins.
9. The household export writes other people's hidden events as blocks. Even the Owner cannot see through a hide.
10. Google still reads each account's primary calendar. A separate work calendar connects as its own account or feed.
11. The web client renders blocks and hidden badges. The eye toggle, the Work switch and the scope editor are iOS only.
12. A Limited Member's scope never hides their own events, or events they take part in as participant, attendee or driver. A member the scope does not mention is shown.

## Consequences

**Good.**
- One matrix and one presentation function replace role checks and title-printing scattered across routes.
- The API's contract did not change shape: blocks are events.
- Older app builds keep working, and show "<Name> working" as ordinary read-only events.

**Bad.**
- A refresh on every write means more Google and feed traffic. The one-minute floor bounds it.
- The owner's calendar card is blurred even to them until they share it. That is intended calm, but it is one more tap.

**Accepted risk.**
- Surprise detection is lexical. A surprise called "Dad's thing" is protected only once the owner turns on "Keep it a surprise". The app pre-sets that switch whenever the words match, so the owner sees what the server assumed.

## Follow-ups

- Choosing among several calendars inside one Google account.
- Revoking a Google account leaves its calendar subscription behind.
- Household helpers run as the Owner and so see adults-only events.
- The memory index fallback and the Memory tab search are not filtered per viewer.
- Family Ask chats flow into every member's assistant context.
- The web eye toggle, Work switch and scope editor.
- Hiding or sharing an event by voice.
