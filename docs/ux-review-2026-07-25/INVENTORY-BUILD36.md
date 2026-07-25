# UX/feature inventory — build 36 review, 2026-07-25 (second pass)

Sources, all recovered in full:

| Source | Length | Content |
|---|---|---|
| `RPReplay_Final1784998317 2.MP4` | **10m53s** | The master narration, build 36 |
| `RPReplay_Final1785004731 2.MP4` | **6m16s** | **UNIQUE** — the GPop adult-member profile, and "nests" |
| `RPReplay_Final1784998317 3.MOV` | 3m46s | duplicate of master `[00:00]–[03:46]` |
| `RPReplay_Final1784998317 4.MOV` | 6m01s | duplicate of master `[04:10]–[10:07]` |
| Jam `f7f2c90d` | — | same as the 4.MOV segment |
| Jam `5d69f1c5` | — | same as the 3.MOV segment |
| Jam `1edd5236` | — | **silent** (no mic); screenshots only |

Method note, again: the jam.dev pages are 3 KB stubs that carry a *paraphrase*, no duration and
no media URL. The Jam MCP server's `getVideoTranscript` returns the real timestamped WebVTT.
Transcripts of the local files came from ffmpeg + faster-whisper. **Check duration before
trusting any summary** — that is now twice.

Timestamps below are from the 10m53s master unless marked `[v2 …]` (the GPop video).

---

## THEME L — Identity: one colour, one name, everywhere

| # | Item | Ref |
|---|---|---|
| L1 | Melissa and Beannie **still truncated** on the profile picker. "Whether that means offsetting them or zigzagging them up top across horizontally. Something inventive." | 00:23 |
| L2 | **"The M is green, the R is like a bluish colour. Those don't match the colours that are on the profile pictures."** — and: "that colour for each person needs to exist throughout the app, and when it's updated one place it needs to automatically carry over to every other place." | 04:37 |

**L2 root cause found:** `app/(settings)/tasks.tsx` carries its own `AVATAR_TONES` palette
indexed by the member's **position in the array**, with no relation to `memberColor()`. Colour
was therefore a function of list order, not of identity — so it disagreed with the avatar
beside it and changed when the roster changed.

## THEME M — The Ask screen

| # | Item | Ref |
|---|---|---|
| M1 | Condense the "Ask Family" header — "that way there is some room to fit some of this information down below, all in one screen" | 00:57 |
| M2 | Helper/suggestion cards on Ask **still truncated** | 05:09 |
| M3 | Chat title chips still truncated | 05:22 |
| M4 | "It doesn't really rename like it should intelligently" | 05:32 |
| M5 | Composer sits "way too close to the top of the keyboard — needs a little more spacing" | 05:52 |
| M6 | The composer must **grow, and be draggable** up and down | 06:03 |
| M7 | Personal/Family toggle condenses to "just an orange dot so it's obvious what section you're in", **draggable back down, and snaps back** | 06:18 |

## THEME N — Card affordances

| # | Item | Ref |
|---|---|---|
| N1 | "All of these little arrows need to be bigger and more prominent and pronounced." — "I'm scared to click Draft… the user will try to click that tiny little arrow only, which is hard to hit." | 06:43 |
| N2 | **Swap them:** the primary action ("Open helper") belongs on the RIGHT; "More" belongs small, on the left. Also: More is only Duplicate / Delete / Cancel, so it isn't "options" | 07:15 |

## THEME O — Files and the briefing

| # | Item | Ref |
|---|---|---|
| O1 | Profile images still surfaced as home files — "they're not home documents… it needs to live somewhere else, hidden, and one place to edit it." Plus: **you must be able to remove your profile picture** | 07:44 |
| O2 | Daily Household Briefing shows **odd characters** and says it **cannot be previewed** | 08:24 |
| O3 | The briefing is attributed to "M owner" — must be the member's **real name as it is in the app** | 08:31 |

## THEME P — Meals and groceries

| # | Item | Ref |
|---|---|---|
| P1 | Meals still can't take an **exact time** ("is it today at six, is it tomorrow") | 08:54 |
| P2 | Meal ingredients must **automatically populate the grocery list** | 09:20 |
| P3 | Ingredients shouldn't be comma-separated — "type a list out and it populates to bullet points" | 09:26 |

## THEME Q — Calendar

| # | Item | Ref |
|---|---|---|
| Q1 | Still showing the sync/reconnect state. "Everything's connected. I'm not sure why it's still showing this." | 09:51 |
| Q2 | For events from outside calendars it says *edit at the source or copy it on the web app*. **Let me append to it here** in FamiliOS without syncing it back out | 10:10 |
| Q3 | An event shows `wrhixin@gmail.com` — "it needs to say my name, Ross" | 10:42 |

## THEME R — Tasks

| # | Item | Ref |
|---|---|---|
| R1 | "Instead of saying **Mine**, I think it should say **Me**" | 04:12 |

## THEME S — The adult-member profile is half-built (GPop)

All from the 6m16s video. This is the one that hadn't been reported before.

| # | Item | Ref |
|---|---|---|
| S1 | "There is no calendar setup… no settings for them. They don't have the ability to get to Connectors to add their email and their calendar." | v2 00:23 |
| S2 | "They can't see a proper calendar. All they see is this. They can't click into these items to see details. They should be able to." | v2 00:37 |
| S3 | "They should be able to do everything short of editing other people's items — add their own schedules, add items of their own." | v2 00:47 |
| S4 | "I do not see the Tasks & Lists centre here, which by default should include **groceries**, tied to **their own** grocery list, so it's separate." | v2 01:11 |
| S5 | ✅ "It does look like you were able to get the chat isolated, which is good." | v2 01:28 |
| S6 | Ask/Offer help on their home is "very inconspicuous, too small — you can't tell what's going on there. This is not an acceptable way for it to be displayed." | v2 01:37 |
| S7 | "When he does eventually create an agent, he'll need an agents screen. He'll need an agent himself. And so will Beannie." | v2 02:13 |

## THEME T — **Nests** (new feature)

GPop and Beannie are married. They are grandparents and caregivers inside the household — they
need to see everything and help — but they also need a space of their own that the wider family
isn't in.

| # | Item | Ref |
|---|---|---|
| T1 | Two members keep **shared agents, grocery list and task lists** between them, isolated from the broader family | v2 02:26 |
| T2 | "There should be some way to associate two profiles" | v2 03:00 |
| T3 | It appears in the chat space switcher as its own group — "Personal / **GPop + Beannie** / Family" | v2 04:29 |
| T4 | "Send an invite to create a **nest**" | v2 05:06 |
| T5 | A nest is "two, three, four, however many people in a group that are isolated off in their own silo from the overall household, but yet still have that access" | v2 05:29 |
| T6 | The invitee **approves** — join or decline — and can **leave at any point** | v2 05:45 |

---

## Cross-cutting

- **L2 is the highest-leverage item in this pass.** One member → one colour, resolved in one
  place, is what makes the avatar, the task row, the calendar stripe and the chat dot agree. It
  also makes "update it once and it carries everywhere" true by construction rather than by
  everyone remembering to use the same helper.
- **T (nests) is a real data-model addition**, not a UI change: a sub-group inside a household
  with its own visibility scope, its own invites, and membership a person can leave. It sits
  alongside `personal` and `household` as a third visibility, which is exactly how he described
  it in the chat switcher.
- **Q1 and P1** were already fixed after build 36 was cut (the account health sweep, and the
  meal time picker). They should be verified on the next build rather than re-implemented.
- **O1** was partly fixed after build 36 (avatars no longer listed as documents); the remaining
  half is being able to REMOVE your profile picture.
