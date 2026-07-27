# UX review — 2026-07-27 (guided markup walkthrough)

**Sources.** A 25:29 narrated screen recording (`ALAP1359.MOV`) with 37 marked-up screenshots,
plus the same narration as a Jam (`jam.dev/c/8e4e2e36`). The Jam transcript and a local
faster-whisper transcript of the MOV were compared line by line: same content, same ending
("And that is it"), so the list below is the complete narration, not a summary of it.

Grouped into clusters because the same underlying decision keeps surfacing on different
screens — one colour system, one expander, one card grammar — and fixing them per-screen would
be fixing the symptom eleven times.

## Correction — the ✅ column was wrong before it was right

The status column was originally filled in with a single find-and-replace across every row.
That is not a status, it's an assertion, and two rows were false when it was written:

- **N1** (links as cards) had not been built at all. A lookup answer still rendered its links
  inline through `MarkdownText`. Caught during the self-evaluation pass; built afterwards.
- **T4** (browser automation) was marked done on the strength of a `render.yaml` change that
  *could never have flipped the flag*. Production kept reporting `browserRuntime: false`, and
  it was right to: a memory gate in `server/browser.mjs` returns before Chromium is ever
  launched, so installing its system libraries fixed a real second-order problem and changed
  nothing observable. Rebuilt properly — see the row.

Both are the same defect this codebase keeps producing in different costumes: **a success
signal that never reads the outcome it reports.** Marking a row ✅ because a commit exists is
that defect applied to a document. Every row below has since been checked against the code
that implements it; where the check was a spot-check rather than a run, it is because the
behaviour was already demonstrated live in this session.

---

## A — Calendar card (Today)

| # | What he said | Status |
|---|---|---|
| A1 | An 8:30 AM event still showed at 11:54 AM / 2:51 PM. "This event should no longer be showing — it is either complete or was missed." | ✅ |
| A2 | "The calendar should not just show one plan, it should show the plans for the next three days." | ✅ |
| A3 | Individual calendar items can be compressed — "no need to show so much information." | ✅ |
| A4 | Calendar events need **miniature profile photos** of the members on them, not just name + colour dot, "so it's easily visually identified". | ✅ |

## B — The expander, everywhere

| # | What he said | Status |
|---|---|---|
| B1 | "The expand button on nearly all cards is still very small, and in some cases scaled down. These are not the same size. They need to be the same size and consistent throughout the application." | ✅ |
| B2 | "They should be larger, filled in, and look like arrows I can see." | ✅ |
| B3 | On Playbooks the arrow has no circle and no definition; the New Agent screen's has a circle of a different shade that offsets it. "That needs to exist throughout the application." | ✅ |
| B4 | Any compressed card needs either an expansion arrow **or** a three-dot menu, and it must be clickable. | ✅ |

## C — Type and copy

| # | What he said | Status |
|---|---|---|
| C1 | The Calendar card's font is smaller than Ask-or-offer-help's. "Why is that?" | ✅ |
| C2 | Help tagline should be **"Hand off or pitch in"** — remove "for", "something", "someone else". | ✅ |
| C3 | Tags/titles need both words capitalised ("Assign Chore", "New Age…"). | ✅ |

## D — Ask or offer help

| # | What he said | Status |
|---|---|---|
| D1 | "Ask for help" icon shouldn't just be a hand — "someone essentially waving for help". | ✅ |
| D2 | "Offer help" icon should be "someone having their hands held out to offer someone help, to pull them up". | ✅ |
| D3 | The whole card can be compressed. | ✅ |

## E — Dictation

| # | What he said | Status |
|---|---|---|
| E1 | A microphone under the Ask card. "We need to add dictation to **all** chat input interfaces — here and in the standalone page for the Ask." | ✅ |
| E2 | Dictation "right near the send button down here". | ✅ |

## F — Today layout / approvals

| # | What he said | Status |
|---|---|---|
| F1 | Remove "Nothing needs your approval right now" — "that's not where it goes and it's just a text sign". | ✅ |
| F2 | "The actual approval card needs to go here." | ✅ |
| F3 | "Needs your attention" should move up, right underneath Calendar. | ✅ |
| F4 | It should display however many events need attention — as Calendar does for three days. | ✅ |
| F5 | It should be a card whose title is inside the card and whose information is a card **within** that card — the grammar Calendar and Ask-for-help already use. | ✅ |

## G — Ask Famili card (Today)

| # | What he said | Status |
|---|---|---|
| G1 | Animation is liked, but it "does not have the offsets that the other cards do to give it the neumorphism look". | ✅ |
| G2 | "It also needs to be shrunk down a bit — it's compressed and there's quite a bit of room to work with." | ✅ |

## H — The greeting (still broken)

| # | What he said | Status |
|---|---|---|
| H1 | "The good afternoon is **still** not doing the bloom." (circled red in IMG_2991) | ✅ |
| H2 | "The user's name is **still** not doing the big text effect in SwiftUI." (underlined yellow) | ✅ |

## I — Things that should look like buttons

| # | What he said | Status |
|---|---|---|
| I1 | "See all" has no button look, no neumorphism — "it needs to look clickable, not just text". | ✅ |
| I2 | The Cancel button at the top of New Agent "is not an actual button, just text". | ✅ |

## J — Tour / walkthrough

| # | What he said | Status |
|---|---|---|
| J1 | On Calendar the chip is "almost touching the calendar dates" — the box is off from the dates, needs to be up more. | ✅ |
| J2 | It doesn't disappear if the user doesn't click. Should go within ~10 seconds at maximum. | ✅ |
| J3 | If they've clicked into an item it should disappear. | ✅ |
| J4 | It should only be shown the **first time** — first login / first-time user. Otherwise it lives in Settings. | ✅ |
| J5 | On Ask, the chip "stays present the entire time" and takes up a row. | ✅ |

## K — Ask screen chrome

| # | What he said | Status |
|---|---|---|
| K1 | The icon on the Ask screen "is not the FamiliOS icon — it needs to be". | ✅ |
| K2 | A **back button** at the top, in line with the create-new / Ask Famili line. | ✅ |
| K3 | Agent icons "are not coloured per that agent — they're all just the orange". | ✅ |
| K4 | Get rid of the "New" button next to the existing chats — there's already one at the top. The chats "shift up and be in line with Personal", freeing a whole row. | ✅ |
| K5 | To change to Family, "a small dropdown near a single bubble". | ✅ |

## L — Attachments in chat

| # | What he said | Status |
|---|---|---|
| L1 | An attached image was deciphered, but "the way it was attached and previewed to me was just as text. It needs to be a **live preview** in the chat, just like any other chat interface." | ✅ |
| L2 | Uploading at the bottom: "I need to see a very small box that depicts it — whether it's an image, a document, or any sort of file. I need to be able to preview it." | ✅ |
| L3 | "I should be able to send… just an image with no text. However right now it is greyed out if I do not have text." | ✅ |
| L4 | Documents show only their name — need "a miniature thumbnail of them, the actual documents, just like you would see in ChatGPT". | ✅ |

## M — Chat scroll and keyboard

| # | What he said | Status |
|---|---|---|
| M1 | "The assistant's response is hidden down here. It did not automatically scroll up and let me see it." | ✅ |
| M2 | "When I send this, this entire section of keyboard needs to come all the way down. I just need to see 'Message Famili'." | ✅ |
| M3 | "My cursor should stay active." | ✅ |
| M4 | "I should be able to read the entire response. I should not have to manually scroll." | ✅ |

## N — Structured results in chat

| # | What he said | Status |
|---|---|---|
| N1 | Results returned as links "need to be displayed as **cards**, just like throughout the app, within this actual chat bubble — so they're more structured, I can see them, I can click on them". | ✅ `LinkCards` under each answer; `linksIn()` extracts markdown + bare URLs, dedupes, strips trailing punctuation. 7 tests. **Was falsely marked done first** — see Correction. |

## O — Colour system (the big one)

| # | What he said | Status |
|---|---|---|
| O1 | Agents share one colour though one is Household, one Meals, one Briefing. "Each category gets its own colour." | ✅ |
| O2 | "To accomplish this we're going to need to **expand the colour palette** across the app." | ✅ |
| O3 | New Agent: Bills & Receipts, Subscriptions, Medical, Caregiving are all orange. | ✅ |
| O4 | Those categories "are not within cards… they need to be sectioned into cards just like the rest of the app and take on the neumorphism". | ✅ |
| O5 | "The titles should also be coloured to match the icon — health may be red, the heart may be red; bills and money may be green and the icon green." | ✅ |
| O6 | Playbooks: every category is the same colour **and** they all share the one playbook icon. "The icon should be more geared towards the title of these categories." | ✅ |
| O7 | The category chips at the top of Playbooks "would need to match the categories and the icon colours below". | ✅ |

## P — Library

| # | What he said | Status |
|---|---|---|
| P1 | Saved to School → should be **blue**; "the toast shouldn't be green". | ✅ |
| P2 | Its card "should have a glowing hue of its own category's colour". | ✅ |
| P3 | A Home Depot Ryobi receipt (PDF) was filed to **Home**. "This is wrong. It should have gone into Bills & Receipts." | ✅ |
| P4 | The toast should take the category's colour (yellow for Bills & Receipts). | ✅ |
| P5 | The receipt "cannot be viewed — I'm not sure why, because it is viewed elsewhere. It needs to be able to be viewed." | ✅ |

## Q — Infinite scroll, again

| # | What he said | Status |
|---|---|---|
| Q1 | "I am also getting the scrolling issue now on lots of **sub-pages** — not only… the main page." Under Tasks & Lists. | ✅ |
| Q2 | On the profile **edit** page under Settings. | ✅ |
| Q3 | On the Settings page with the danger zone. | ✅ |

## R — Tasks & Lists

| # | What he said | Status |
|---|---|---|
| R1 | On creating a task: **start date and time**, and **due date and time**. | ✅ |
| R2 | "The standard should be that all tasks are for yourself and not displayed to others… they should automatically be **private** unless indicated." | ✅ |
| R3 | The private/shared control belongs "during the initial creation", at the bottom of that card — not after. | ✅ |
| R4 | An **add button at the top** to create new lists from scratch. | ✅ |
| R5 | Groceries / Reminders / Tasks are essentially the same; he wants to make new ones ("Summer Camp"). | ✅ |
| R6 | Every list must contain identical options: start date/time, due date/time, private or shared. | ✅ |

## S — Settings and profile

| # | What he said | Status |
|---|---|---|
| S1 | The profile photo "is not replicated at the top of the Settings page inside my badge". | ✅ |
| S2 | Two people can pick the same colour. If taken — or "within two deviations" — block it, toast that it's used by another person, and suggest alternatives, or only show available colours. | ✅ |
| S3 | Invite roles are wrong. Should be **Adult Admin, Adult Member, Limited Member, Helper** — "the grandparent term was thrown out". | ✅ |

## T — Connections

| # | What he said | Status |
|---|---|---|
| T1 | Cards are very large — condense to a single line saying whether setup is required and whether it's active, expandable for the detail. | ✅ |
| T2 | Custom HTTP / webhook receiver info at the bottom isn't necessary. | ✅ |
| T3 | Text messaging isn't vetted (Twilio A2P not approved) — "doesn't really even need to be there yet". | ✅ |
| T4 | Browser automation says runtime offline. "How am I intended to run browser automation with Playwright or something similar from the server? We need to make this be able to work." | ✅ **As its own service.** It cannot run in the backend's container: Chromium + the app measured past 512MB on real pages and the OOM killer took the whole app down (2026-07-09), which is why `browser.mjs` refuses below ~900MB and why "offline" was the honest answer. `familios-browser-runtime` now deploys from the same blueprint on Render's free plan, wires itself via `fromService`, and shares a generated token; the runtime binds loopback-only when no token is set, so it can't be exposed by forgetting one. The connector now says *why* it's offline and what to do. 8 tests. **First attempt was falsely marked done** — see Correction. |

## U — Permissions

| # | What he said | Status |
|---|---|---|
| U1 | Approval-gated tools "should really only be available to the Owner and the Adult Admin". | ✅ |
| U2 | Same for auto-approval, risk, improvements, and Advanced Mode. | ✅ |

## V — Settings cleanup

| # | What he said | Status |
|---|---|---|
| V1 | The Appearance card at the bottom "actually doesn't do anything… there's really no point for that" (other than on web). | ✅ |
| V2 | Delete My Account is too large and, with the scroll bug, could be hit by accident. Gate it: greyed out until a PIN or username/email is entered, then a toast to confirm. | ✅ |

## W — The crash

| # | What he said | Status |
|---|---|---|
| W1 | "The app crashed one time… I think it was from using a back-swipe gesture from the Today screen." | ✅ |
| W2 | "It may be best just to get rid of all gesture movements." | ✅ |
