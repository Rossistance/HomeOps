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
| L8 | Deep link | `familios://` opens/foregrounds the app signed in | ✅ `familios://activity` and `familios://help` open the signed-in app on those screens |
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
| K1 | Scope chips: Everyone / My Nest / Just me | ✅ Everyone / Me / Others, plus Family / Melissa + Ross / Just me and All / Groceries / Reminders / Tasks list chips |
| K2 | Lists row; Create a new list `TEST list` → appears → hold-to-delete | ✅ New list prompt → “TEST List” chip appears selected with its own empty state; hold → “Delete "TEST List"? The empty list is removed.” → gone. (Sim note: the prompt's field must be tapped before typing or keystrokes land in the quick-add behind it.) |
| K3 | New task `TEST — delete me` → appears with owner colour | ✅ quick-add expands to Due + Who-can-see chips; task listed under TASKS · 1 with owner dot. ⚠ the row's done-circle is not a separately labelled control (a11y). ⚠ during a Render redeploy the add surfaced “Something went wrong (bad_json)” — the raw client code, not the “Couldn't reach FamiliOS” state |
| K4 | Task sheet: title, notes, date/time, add/remove end, reminder, assignee, priority, On the calendar, Delete | ✅ title, notes, assign-to chips, date/time switch → Starts date + time, Add end time, Remind chips, priority, who-can-see, “Add to the calendar” (enabled once dated), Delete task; Save changes persisted date + assignee |
| K5 | Mark done → Completed section; reopen → back | ✅ done-circle → Completed (1), expandable, struck-through row; reopened → back on the list |
| K6 | Archived section lists archived count | ✅ Archived, 51 tasks |
| K7 | Assign Chore (from Today) opens the chore sheet | |

## 7. Meals & Groceries (`(home)/meals.tsx`, `groceries.tsx`)

| ID | Check | Result |
|---|---|---|
| M1 | Week strip; day select | ✅ 7-day strip from today, meal-type chips, Grocery list card with count |
| M2 | Add meal `TEST — delete me`: title, servings, ingredients, recipe URL, notes, clear time | ✅ inline composer: title, date chips (No date/Today/…), meal-type chips, ingredients textarea with live “2 ingredients — added to Groceries when you save.”; Add meal → “Meal added.” |
| M3 | Saved meal shows; ingredients reach Groceries; Open grocery list works | ✅ card under TODAY with 6:00 PM usually · dinner, “2 ingredients · 2 needed”, Groceries / Calendar / Edit / Remove; Grocery list 27 → 29 items |
| M4 | Edit / Remove meal → gone; grocery items unlinked | ✅ Edit sheet: title, day, slot, time (“Not set — uses the usual dinner time”), servings, ingredients, recipe link, notes, Save changes; Remove → “Keep ingredients / Remove ingredients too / Cancel” → meal gone, Grocery list back to 27 |
| M5 | Groceries: add item, rename, save name, cancel; open item → task editor; Share list (not fired) | ✅ add item → To-get row with checkbox; long-press → Details… (task editor) / Rename (inline, Save name) / Remove (confirm); Share list sheet shows household access per member and an outside-number field with Review & send disabled until valid (not fired). ❌→fixed: header counted archived items (“This week · 28 items · 0 of 28 in the cart” over one live item); Meals card count had the same flaw |

## 8. Inbox (`(home)/inbox.tsx`, `approval-sheet.tsx`)

| ID | Check | Result |
|---|---|---|
| I1 | Segments: Approvals / Updates / Chats | ✅ Approvals / Updates / Chats (28). ⚠ “Recently decided” rows show raw tool ids (`sms.send`, `homeops.create_approval`) rather than plain language |
| I2 | Updates: notifications list, mark read on tap | ✅ notifications list with relative times (none unread on this account, so mark-read not exercised); Delivery check “Send test” present (not fired) |
| I3 | Approvals: pending rows open the sheet with real step input; Deny/Approve present (not fired on sends) | |
| I4 | Chats: conversations open in Ask | ✅ chat row opens the thread in Ask with its space chip |

## 9. Activity (`(home)/activity.tsx`)

| ID | Check | Result |
|---|---|---|
| V1 | Runs list with status words; expand; Clear finished run | ⚠ no Runs section rendered for this account today (only Memory) — could not exercise expand / Clear finished run |
| V2 | Memory list with delete (not fired) | ✅ memory list with per-item delete (not fired) |
| V3 | Backend-unreachable empty state not shown when online | ✅ no offline state while online |

## 10. Help (`(home)/help.tsx`)

| ID | Check | Result |
|---|---|---|
| P1 | Ask mode / Offer mode from Today buttons | ✅ Ask for help / Offer help modes (also reachable from Today's buttons) |
| P2 | Member picker, message field, Link task / Link event pickers | ✅ member picker, plan picker (Show all 9), task picker, message field. ❌→fixed: all-day events in the plan picker read as the evening before in device time (“Repatha Injection — Sat, Sep 19 · 11:00 PM”); now the household date + “All day” |
| P3 | Send disabled until valid; send **not fired** | ⏭ button reads “Pick someone to ask” until a member is chosen, then “Ask Melissa” with the message — not fired |

## 11. Profile (`(home)/profile.tsx`)

| ID | Check | Result |
|---|---|---|
| R1 | Display name, avatar emoji grid, photo, remove avatar, colour picker with taken colours dimmed | ✅ display name, colour grid (taken colours dimmed, disabled and labelled “taken by …”), avatar emoji grid, Change photo, Remove avatar, Save |
| R2 | No two swatches identical (BUG-01 regression) | ✅ every swatch label distinct in the tree |
| R3 | Nothing saved during the check | ✅ nothing saved |

## 12. Settings (`(settings)/*`)

| ID | Screen | Check | Result |
|---|---|---|---|
| S1 | Index | Rows: profile, Household, Helpers, Contacts, Connections, AI Providers, Nests, Operator; sign out; delete account (not fired) | ⚠ profile card (edit, light/dark), household members + Invite + Manage household, Connections (Google Connected, five “Setup required”, All connections), Show me around, Contacts, Nests, Helpers, Sign out, Delete my account (not fired). No AI Providers or Operator row on the index: AI providers lives under Connections; Operator is not on this build |
| S2 | Household | Members with roles; edit matrix by role; PIN change fields (not fired); invite sheet opens (not sent) | ✅ autonomy dial (Balanced current), members with roles (Owner / Adult Member / Child View / Limited Member), sign-in PIN fields with “Change the PIN” disabled until filled (not fired), recovery-PIN warning shown, visibility rules, Spaces (Family · 223 items). Invite sheet ⏭ |
| S3 | Contacts | Methods per member; add form; verification fields (not sent) | ✅ methods grouped per member with Verified / Pending badges, opt-in and “N helpers allowed”, Send test / Edit / Remove per method, Verify on the pending phone (not fired), Add contact method |
| S4 | Connections | Providers with state; OAuth start (not fired); Calendar feed URL field; .ics import | ⚠ Check now; OAuth accounts (Google connected, others “Server-side setup required first”); subscribed calendars with Sync now / Remove and honest `needs_reconnect` for Melissa’s and Daniel’s Google; Connect calendar; Other calendar options; AI providers row; Connector status (Weather / Webhook / Web search Connected, Local files Local-only). iMessage shows “Coming soon” on this build (d228bc4); the Connections filter in build 70 exposes it |
| S5 | AI Providers | Providers, active one marked; key/base URL/model fields; health check on active; Advanced Mode; auto-approve toggle | ✅ OpenAI Active · Reachable (gpt-5.6-sol); Anthropic / Gemini / OpenAI-compatible Not configured; Ollama / LM Studio Unreachable; Risk & approvals; Auto-approve low-risk improvements (on); Advanced Mode (off); Approvals PIN and Advanced builders point to the web; Sign out |
| S6 | Nests | List / create (not fired) | ⏸ not reached: the simulator hit its inactivity timeout before this row, and Limrun rejected the credential on recreate. A simulator build of build 70 is ready for the next pass: `https://expo.dev/artifacts/eas/eJU6qOrWdprLFHwXC00FBalHHyskqBoOkPloRGVTaS8.tar.gz` (EAS build b6c1152d, profile `simulator`) |
| S7 | Operator | Invite code generation (not fired); share (not fired) | 🚫 no Operator screen on this build |

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
