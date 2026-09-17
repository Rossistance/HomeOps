# Mobile test matrix — every screen, every control — 2026-09-17

Derived from the actual expo-router route tree (`apps/mobile/src/app`), the sheets under
`components/sheets`, and every `accessibilityLabel` in those files. One row per control or
interaction. Executed on a Limrun cloud iOS simulator (iPhone, iOS 26.4) running the Release
build of commit `d228bc4` against the **production** backend, signed in as Ross (Owner).

**Mutation policy.** The backend is the live household. Read and navigation rows are run as
written. Write rows are run only where the write is reversible and clearly labelled
(`TEST — …`) and the record is deleted in the same session. Rows that would reach a real
person or an outside service are verified up to the final control and **not** fired:
help-request send, contact verification codes, invites, approvals that send, Google push,
account deletion, PIN change, household rename, profile photo/colour change.

Result codes: ✅ pass · ⚠ pass with defect noted · ❌ fail · ⏭ verified up to send, not fired · 🚫 not reachable on this build/role.

## 0. Launch, auth, session (TC-IOS-001/010/012/002/021)

| ID | Screen | Check | Result |
|---|---|---|---|
| L1 | Cold start | App reaches the profile lock screen without crash; footer names the API host | ✅ |
| L2 | Lock | Every household member listed with role; Owner row shows PIN badge | ✅ |
| L3 | Lock | Tap Ross → PIN field focused, numeric keypad, Sign in disabled until digits typed | ✅ |
| L4 | Lock | Wrong PIN refused with a message; nothing else changes | ✅ |
| L5 | Lock | Correct PIN signs in; first run lands on onboarding | ✅ |
| L6 | Onboarding | All pages advance; profile values round-trip unchanged; helpers page says none exist yet; Enter lands on Today | ⚠→fixed: the closing summary hard-coded “No helpers yet” and “Connect Gmail and Google Calendar” — false for this household (10 helpers, Google syncing). `Onboarding.tsx` now reads the real count and connection |
| L7 | Session | Background then foreground keeps the session and screen | |
| L8 | Deep link | `familios://` opens/foregrounds the app signed in | |
| L9 | Sign out | Settings → sign out returns to the lock screen; back cannot re-enter | |

## 1. Today (`(home)/index.tsx`)

| ID | Check | Result |
|---|---|---|
| T1 | Header shows today's date and "Good <part of day>, Ross" | ✅ |
| T2 | Inbox icon opens Inbox; badge reflects unread | ✅ |
| T3 | My profile avatar opens My Profile | ✅ |
| T4 | Member row: tapping a child opens that child's view in preview; adults are not tappable | ✅ |
| T5 | "See all N members" opens Household | |
| T6 | Ask Famili card: suggestion text, mini composer, voice button, send | ⚠ card and send work; the mini composer exposes no accessibility label (tree-only finding, tapping the card opens Ask) |
| T7 | Mini composer send opens Ask with the question fired | ⚠ same as T6 |
| T8 | Calendar card lists today's events with member colour and opens Calendar | ✅ |
| T9 | Tapping an event in the card opens the event form | |
| T10 | Needs your attention: empty state / approval rows; "See all" opens Inbox | |
| T11 | Ask for help / Offer help open the help screen in the right mode | |
| T12 | Quick actions: Meals, Tasks & Lists, Assign Chore, New Helper, Upload, Connect each open the right surface | |
| T13 | Coming up lists my next 7 days; event rows open the form; task rows open Tasks | |
| T14 | What I did: recent runs with who/outcome; opens Activity | |
| T15 | What I learned: recent memories; All opens Activity | |
| T16 | Last card fully visible above the floating tab bar (the fixed overlap bug) | ✅ |
| T17 | Can you help? cards never duplicate (the fixed dedupe bug) | |

## 2. Ask Famili (`(ask)/index.tsx`)

| ID | Check | Result |
|---|---|---|
| A1 | Composer, Send, Attach, New chat, Back to Today all present and labelled | ✅ |
| A2 | Space chip shows current room and opens the space picker | ✅ |
| A3 | Send a read question → thinking phase, streamed text, tool receipts, done | ✅ |
| A4 | Answer uses real household data (calendar/tasks) | ✅ after fix: stale “draft a plan you can approve” copy replaced (98ab700) |
| A5 | New chat clears the thread; prior thread remains in Inbox → Chats | |
| A6 | Attach opens the picker; remove attachment works | |
| A7 | Drag handle resizes the composer | |
| A8 | Approval-gated ask shows "waiting for approval · Open Inbox" and does not execute | |
| A9 | Composer clears the tab bar (no overlap) | |

## 3. Helpers (`(agents)/index.tsx`, `[id].tsx`, `new-helper-sheet.tsx`)

| ID | Check | Result |
|---|---|---|
| H1 | List: one card per helper with name, purpose, schedule text, autonomy text, last-run line; paused dimmed | ✅ |
| H2 | New helper opens the sheet: templates by section + Start from scratch | ✅ |
| H3 | Picking a template opens the editor pre-filled, nothing saved yet | ✅ |
| H4 | Editor: name, instructions (multi-line), schedule picker (manual/hourly/daily/weekly + weekday + time), autonomy sentences, Save | ✅ |
| H5 | Save creates the helper (`TEST — delete me`); list shows it | ✅ |
| H6 | Run now: pending state, then answer + receipts; last-run line updates | ✅ |
| H7 | History thread shows the run | ✅ |
| H8 | Pause dims it and disarms; Resume re-arms | ✅ |
| H9 | Autonomy "full" prompts for PIN; cancel leaves it unchanged | ⏭ verified up to the household-PIN warning |
| H10 | Delete asks to confirm, then removes it from the list | ✅ |
| H11 | Save bar sits above the tab bar (fixed overlap) | ❌→fixed: disabled floating Save bar swallowed the Delete tap (`(agents)/[id].tsx`) |

## 4. Library (`(library)/index.tsx`, `upload-sheet.tsx`)

| ID | Check | Result |
|---|---|---|
| B1 | Files / Knowledge tabs with counts | ⚠ “Knowledge (10)” counts memory+artifacts while the list is empty (not fixed) |
| B2 | Space chips filter files; counts per space | ✅ |
| B3 | Search filters by name/type | ✅ |
| B4 | Upload opens the sheet (camera / library / document), cancel closes | ✅ |
| B5 | File row expands to a preview; preview opens | ✅ |
| B6 | Knowledge: New knowledge → title/details/tags → save (`TEST — delete me`) → edit → delete | |
| B7 | Memory rows list with delete affordance (not fired) | ✅ |
| B8 | Artifacts appear in Knowledge with their kind | ✅ |

## 5. Calendar (`(home)/calendar.tsx`, `event-form.tsx`)

| ID | Check | Result |
|---|---|---|
| C1 | Agenda view groups by day with week separators; past days absent | ✅ day headers from today forward, past days absent (week separators are visual only — no a11y label) |
| C2 | Month view: seven columns, today highlighted, day tap selects and lists | ✅ seven columns, today ringed, dots per event, tap lists the day |
| C3 | Previous/Next month | ✅ Aug 2026 ← Sep → Oct 2026 |
| C4 | Lens (Family / Nest / Me) filters | ❌→fixed: month grid, day counts and the tapped day ignored Family/Nest/Just me (`byDayAll` read `events`, now `lensedEvents`). Agenda was correct. Verified on the rebuilt app |
| C5 | Subscriptions row shows synced calendars; Sync runs | ✅ 4 subscriptions, Last synced updates; Melissa’s and danielhixonotr’s Google accounts return needs_reconnect → the “52 events can’t refresh” notice is accurate |
| C6 | New event opens the form | ✅ + button opens New event pre-dated to the selected day |
| C7 | Form: title, date/time, all-day, add/remove end time, notes, what to bring, remind row, Google toggle, Discard | ✅ title required (“Give it a title to save.”), end time add/remove, place autocomplete on location, remind chips, notes, driver, bring. ❌→fixed: “Peek at details” chevron on our own events revealed nothing (notes now render — verified on the rebuilt app) |
| C8 | Save `TEST — delete me` event → appears in agenda and month | ✅ appears under Oct 3 with time span, location, day count 3→4 |
| C9 | Reopen event → edit → delete → gone; Google outcome shown honestly | ✅ reopen → title edited → “Save & update Google” → delete → confirmation names the Google copy → gone from app, production and Google |
| C10 | Task rows on calendar open Tasks | |

## 5b. Google Calendar two-way sync (Chrome signed in as wrhixon@gmail.com — the account Ross connected)

Household setting `calendarAutoSync` is on, so pushes skip the approval gate. FamiliOS → Google
happens only when the event form's “Also add to my Google Calendar” switch is on at save;
Google → FamiliOS happens on Sync (`POST /api/calendar/sync-all`, the same call as the Sync chip).

| ID | Check | Result |
|---|---|---|
| G1 | Event created in Google (`TEST — from Google`, Sat Oct 3 10–11 AM) appears in FamiliOS after Sync, on the right day/time, under Ross's Google subscription | ✅ linked event `2026-10-03T10:00-04:00`–`11:00`, owner Ross, sub wrhixon |
| G2 | `TEST — delete me` saved in the app with the Google switch on → appears in Google Calendar at the same time | ✅ pushed on save with the switch on: Google shows it Sat Oct 3, 5–6 PM Eastern with location; `googleEventId` stamped |
| G3 | Edit the title in the app → Google copy updates | ✅ title change reached Google in the same save (“TEST — delete me (edited)”) |
| G4 | Delete in the app → Google copy removed; app says so honestly | ✅ removed from Google and production; deleting the Google-originated `TEST — from Google` from the app also removed it in Google |
| G5 | All-day events land on the household's date on a phone in another zone | ❌→fixed: keyed by device-local date, so on the Pacific simulator every Sunday “Repatha Injection” sat under Saturday (`event-days.ts` `allDayDateKey`, calendar `spanKeys`, `coversDay`). Verified on the rebuilt app (Central-time simulator): Repatha sits on Sunday |
| G6 | Other members' Google accounts | ⚠ Melissa's and danielhixonotr's tokens need reconnecting (by them) — the app's notice is accurate |

## 6. Tasks & Lists (`(home)/tasks.tsx`, `task-sheet.tsx`, `chore-sheet.tsx`)

| ID | Check | Result |
|---|---|---|
| K1 | Scope chips: Everyone / My Nest / Just me | |
| K2 | Lists row; Create a new list `TEST list` → appears → hold-to-delete | |
| K3 | New task `TEST — delete me` → appears with owner colour | |
| K4 | Task sheet: title, notes, date/time, add/remove end, reminder, assignee, priority, On the calendar, Delete | |
| K5 | Mark done → Completed section; reopen → back | |
| K6 | Archived section lists archived count | |
| K7 | Assign Chore (from Today) opens the chore sheet | |

## 7. Meals & Groceries (`(home)/meals.tsx`, `groceries.tsx`)

| ID | Check | Result |
|---|---|---|
| M1 | Week strip; day select | |
| M2 | Add meal `TEST — delete me`: title, servings, ingredients, recipe URL, notes, clear time | |
| M3 | Saved meal shows; ingredients reach Groceries; Open grocery list works | |
| M4 | Edit / Remove meal → gone; grocery items unlinked | |
| M5 | Groceries: add item, rename, save name, cancel; open item → task editor; Share list (not fired) | |

## 8. Inbox (`(home)/inbox.tsx`, `approval-sheet.tsx`)

| ID | Check | Result |
|---|---|---|
| I1 | Segments: Approvals / Updates / Chats | |
| I2 | Updates: notifications list, mark read on tap | |
| I3 | Approvals: pending rows open the sheet with real step input; Deny/Approve present (not fired on sends) | |
| I4 | Chats: conversations open in Ask | |

## 9. Activity (`(home)/activity.tsx`)

| ID | Check | Result |
|---|---|---|
| V1 | Runs list with status words; expand; Clear finished run | |
| V2 | Memory list with delete (not fired) | |
| V3 | Backend-unreachable empty state not shown when online | |

## 10. Help (`(home)/help.tsx`)

| ID | Check | Result |
|---|---|---|
| P1 | Ask mode / Offer mode from Today buttons | |
| P2 | Member picker, message field, Link task / Link event pickers | |
| P3 | Send disabled until valid; send **not fired** | |

## 11. Profile (`(home)/profile.tsx`)

| ID | Check | Result |
|---|---|---|
| R1 | Display name, avatar emoji grid, photo, remove avatar, colour picker with taken colours dimmed | |
| R2 | No two swatches identical (BUG-01 regression) | |
| R3 | Nothing saved during the check | |

## 12. Settings (`(settings)/*`)

| ID | Screen | Check | Result |
|---|---|---|---|
| S1 | Index | Rows: profile, Household, Helpers, Contacts, Connections, AI Providers, Nests, Operator; sign out; delete account (not fired) | |
| S2 | Household | Members with roles; edit matrix by role; PIN change fields (not fired); invite sheet opens (not sent) | |
| S3 | Contacts | Methods per member; add form; verification fields (not sent) | |
| S4 | Connections | Providers with state; OAuth start (not fired); Calendar feed URL field; .ics import | |
| S5 | AI Providers | Providers, active one marked; key/base URL/model fields; health check on active; Advanced Mode; auto-approve toggle | |
| S6 | Nests | List / create (not fired) | |
| S7 | Operator | Invite code generation (not fired); share (not fired) | |

## 13. Scoped views (`kid.tsx`, `grandparent.tsx`, `sitter.tsx`)

| ID | Check | Result |
|---|---|---|
| Z1 | Child preview from Today: read-only calendar, Ask for help, Back to parent view | |
| Z2 | Grandparent / sitter views reachable only for those roles (🚫 as Owner unless preview) | |

## 14. Cross-cutting

| ID | Check | Result |
|---|---|---|
| X1 | Every root tab reachable; state preserved on return (TC-IOS-020) | |
| X2 | Every interactive control on each root screen has a non-empty accessible name (TC-IOS-070) | |
| X3 | No content under the notch or home indicator on any root screen (TC-IOS-060) | |
| X4 | App logs show no JavaScript errors across the session | |
