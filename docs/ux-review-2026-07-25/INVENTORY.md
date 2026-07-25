# UX/feature inventory — owner narration, 2026-07-25

Source: 25m26s narrated iOS walkthrough (Jam `49382f9f`, full transcript in
`narration-transcript.txt`, timestamps below are from it). Recorded on iPhone 13 Pro Max,
iOS 27, build 26. This is the authoritative list — **63 items**. Jam's own summary surfaced
only the first 47 seconds (11 items); the rest was recovered by transcribing the audio.

Status: `todo` unless marked. Do not close an item without the owner's stated outcome, not a
near-miss.

---

## THEME A — The card pattern (the most-repeated ask, ~13 mentions)

The owner named the model explicitly at [24:36]: **Playbooks**. "This one looks better, the
title is text wrapped and the full card is available. **This is almost how every single card
should look** — where they expand, and a button down at the bottom underneath like *Use
playbook*, that would collapse as well. **That needs to be on like every single card
throughout the application.**"

| # | Item | Where | Ref |
|---|---|---|---|
| A1 | Member names truncated — "people need to be able to read their entire name… this happens throughout the application" | everywhere | 05:42 |
| A2 | Calendar address cut off — "I can't tell where that's at" | calendar rows | 06:31 |
| A3 | Long address/notes need a **down-arrow under the time** for an at-a-glance peek, *in addition to* the right-arrow that fully opens | calendar rows | 14:16 |
| A4 | Suggestion/prompt cards truncated — "why would I click on something if I don't know exactly what it says" | Ask | 15:41 |
| A5 | Chat titles truncated | Ask | 16:08 |
| A6 | Agent title unreadable | Agents | 17:15 |
| A7 | Agent card must show **which tools + which connections** it uses ("doesn't have to be big, but a visual reference") | Agents | 17:22 |
| A8 | All agent cards unwrapped/unreadable | Agents | 19:05 |
| A9 | Template descriptions must be fully visible | New agent | 19:43 |
| A10 | Run summary card must show **what was involved** — connectors, and what went wrong and why | Library | 20:06 |
| A11 | Notes + Approved decisions cards need more context / all available info when expanded | Library | 20:35 |
| A12 | Automations text truncated; can't tap to see what happened or what it uses | Automations | 24:19 |
| A13 | **Canonical pattern**: full wrap + expand/collapse + action button at card bottom, applied app-wide | all | 24:36 |

## THEME B — Identity: photos and colors everywhere

| # | Item | Where | Ref |
|---|---|---|---|
| B1 | Lock screen profile cards don't reuse members' **profile pictures** | Welcome home | 00:27 |
| B2 | Icon above "Welcome home" is **not the FamiliOS icon** | Welcome home | 00:48 |
| B3 | Profile cards must **match each member's selected color** | Welcome home | 03:45, 04:31 |
| B4 | Calendar account shows `wr…@gmail.com` — should show **the member's name (Ross)**; family identify each other by name, not email | Calendar/Connections | 09:48 |
| B5 | Members list shows a **generic person icon** — needs real profile pictures | Settings→Household | 25:15 |
| B6 | Each member **designated by color** for identifiability | Settings→Household | 25:26 |

## THEME C — Keyboard: the submit control must never hide

| # | Item | Where | Ref |
|---|---|---|---|
| C1 | PIN entry doesn't refocus — **Sign in** must stay visible above the keyboard, auto-scrolled, no manual scroll | Lock | 04:49 |
| C2 | Event detail sheet **raises only halfway** — should raise **all the way to the top** and use the full screen | Event sheet | 10:25 |
| C3 | "What to bring" field at screen bottom must scroll up when focused | Event sheet | 13:37 |
| C4 | **Save changes** should sit closer to the text entry; allow check-to-dismiss or Save | Event sheet | 13:48 |
| C5 | Add-to-calendar: **Save is not visible at all** when a field is focused — "that's crucial" | New event | 15:03 |
| C6 | Add-task input doesn't recenter | Tasks | 21:45 |

## THEME D — Auth, signup, onboarding

| # | Item | Where | Ref |
|---|---|---|---|
| D1 | **Forgot password** — send an email with a recovery code | Sign in with email | 01:32 |
| D2 | **Forgot email / forgot username** | Sign in with email | 01:46 |
| D3 | **Household name must be REQUIRED** (currently optional) | Create household | 02:12 |
| D4 | Invite code stays **optional** | Create household | 02:21 |
| D5 | **Owner-side invite-code generation** — an interface to mint codes for any household ("I am the inventor and owner"); new households do not get this | new surface | 02:25 |
| D6 | Collapse invite code into a tappable **"Invite code"** row that expands; default form reads name → household → email → password → Create | Create household | 03:04 |
| D7 | **New-household walkthrough**: set profile, add picture, pick icon, pick color, basic info, plus starting **agents** and some **preferences / facts / knowledge** | onboarding | 03:59 |

## THEME E — Calendar depth

| # | Item | Where | Ref |
|---|---|---|---|
| E1 | Location is raw text — needs **address autocomplete** ("smart sorting like most web apps") | Event | 10:55 |
| E2 | Selected address must be **tappable/linked out to Google or Apple Maps** (or a button beside it) | Event | 11:25 |
| E3 | An **edit button** for location | Event | 12:05 |
| E4 | Notes must be **appended to the Google calendar event body** on push | Event | 12:08 |
| E5 | Replace/augment "note for driver" with **who's attending** — pick GPop/Beannie/Melissa | Event | 12:26 |
| E6 | Selecting attendees **notifies/informs them** they're on the event | Event | 12:56 |
| E7 | Attendees get **Accept / Decline**, like a meeting invite | Event | 13:07 |
| E8 | Meals need an **actual time** — "what time is dinner?" | Meals | 23:42 |

## THEME F — Connections truth

| # | Item | Where | Ref |
|---|---|---|---|
| F1 | **BUG:** `needs_reconnect` never clears. Synced 2 calendars / 40 updated, still shows reconnect; survives refresh, sign-out, app restart | Calendar/Connections | 06:44, 09:27 |
| F2 | Tapping Reconnect must **scroll to and focus the specific provider card**, with an **animated colored ring** | Connections | 07:02 |
| F3 | A **Reconnect button on the card itself** in the list view | Connections | 07:32 |
| F4 | **Back must return to where you came from** — Calendar → Connections → Back should go to Calendar, not Settings | mobile nav | 08:42 |

## THEME G — Agent transparency and control

| # | Item | Where | Ref |
|---|---|---|---|
| G1 | Agent detail must allow **rename** and **edit what it does** (currently only Run / Pause / space) | Agent detail | 17:48 |
| G2 | Name the **actual skill(s)** it runs — "runs the assigned use case skill: what IS that skill?" | Agent detail | 18:06 |
| G3 | Show **connections, skills, and current permissions**; will it run unattended? | Agent detail | 18:30 |
| G4 | **Override to run all the time no matter what** | Agent detail | 18:47 |
| G5 | For chat-created agents: **"don't ask for permission, you have approval"** to bypass the gate | Agent detail / chat | 18:52 |
| G6 | Mobile shows only **4 templates**; the web has many. Bring them all, **grouped into sections**, quickly navigable | New agent | 19:18 |

## THEME H — Tasks as first-class scheduled items

| # | Item | Where | Ref |
|---|---|---|---|
| H1 | Group tasks by person — **"Mine" vs "Others"** | Tasks | 21:31 |
| H2 | **Start date+time and end date+time**, like a calendar item (not just today/tomorrow/next week) | Tasks | 21:49 |
| H3 | **Assign to** a member | Tasks | 22:04 |
| H4 | A **notes/description** field — "you can't type that all into the task title" | Tasks | 22:09 |
| H5 | **Reminders**: 15/30 min before, producing a real **notification** | Tasks | 22:19 |
| H6 | Tasks live separate from the schedule but appear in a **consolidated view** when dated | Tasks | 23:06 |
| H7 | Dated tasks **append to the calendar** and **push to that person's Google account** | Tasks | 23:18 |

## THEME I — Chat organization

| # | Item | Where | Ref |
|---|---|---|---|
| I1 | **Intelligently name the chat**, like ChatGPT/Claude | Ask | 16:14 |
| I2 | Personal tab shows **only** personal chats; Family only family — dot colour is the section cue | Ask | 16:21 |
| I3 | From **inside** a chat you cannot switch Personal↔Family without starting a new chat — "that's not the correct path" | Ask | 16:45 |

## THEME J — Smaller / clarifications

| # | Item | Where | Ref |
|---|---|---|---|
| J1 | **Tags**: intent unclear. Should they auto-identify contents of images/files and categorise? Comma-separated values confusing | Library→New | 20:55 |
| J2 | Contact methods must be **editable**, not only removable | Contacts | 24:07 |
| J3 | AI providers screen — **"all this looks great"** (no change; recorded so it isn't touched) | AI providers | 24:58 |

---

## Cross-cutting notes

- **F1 is a genuine defect**, not a UI preference — the stale `needs_reconnect` is the same
  data the WP-103/ISS-121 banner reads, so the banner is faithfully reporting a status the
  server never clears after a successful sync. Fix the status transition, not the banner.
- **F4 duplicates ISS-115 (local back + scroll restore) but on MOBILE** — that work landed on
  web only. The mobile back stack needs the same origin-awareness.
- **C1–C6 extend WP-104.** `HScreen` got `automaticallyAdjustKeyboardInsets`, but `Lock.tsx`
  and the event/task sheets use their own `KeyboardAvoidingView`/`ScrollView`, so the fix
  never reached them.
- **A13 is the single highest-leverage item**: one shared card primitive modelled on
  Playbooks retires A1–A12 together and is what the owner asked for in the clearest terms.
