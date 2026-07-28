# FamiliOS — walkthrough audit, 2026-07-27 (set #2)

**Status: AUDIT ONLY. No project files were modified.**

## Sources

| File | Length | Subject | Audio |
|---|---|---|---|
| QTLK4224.MP4 | 28:08 | Today header + **Calendar** (ownership, permissions, notes, attendance, notifications) | mean −35.8 dB ✓ |
| BMXC7323.MP4 | 17:31 | **Tasks & Lists** (scope model, list lifecycle, reminders, groceries, back-nav) | mean −33.2 dB ✓ |
| GFIS0801.MP4 | 36:03 | Today "Coming up", Ask, Library, **Settings**, per-role walkthrough (GPop / Beannie / Amelia) | mean −36.2 dB ✓ |

**81 minutes 42 seconds** of narration. Transcribed with faster-whisper `small.en` after EBU R128 loudness
normalisation. 1,634 frames extracted at 3s intervals plus targeted 2s and 1s pulls at complex moments.

### Build under test — verified, not assumed

Frame QTLK @00:20 shows "Needs your attention" rendering the **circled chevron**, not the ember "See all"
pill. That control changed in commit `32e2b81` (build 57). So he is testing build 57/58 and **every finding
below is genuinely outstanding** — none of it is work already shipped and not yet installed.

---

# PART 1 — What went wrong in the recording, and why

Five defects were caught on camera with enough signal to root-cause from the trace. All five verified
against source, read-only.

---

## BUG-01 — The colour picker offers six identical oranges

**Evidence:** QTLK @02:19–02:35, frame `Q_0150.jpg`. The "YOUR COLOR" grid renders 13 swatches: one grey,
one green (his, selected), four dimmed with a person icon (correctly marked taken), and then **six visually
identical oranges**.

> "It says these colors are taken. I'm the green… the color options it gives me after that are all similar
> orange colors. It needs to be different colors."

**Root cause — confirmed.** `apps/mobile/src/lib/member-colors.ts:8-22`

```ts
export function memberAccent(colors: HearthColors, name?: string | null): string | null {
  switch (name) {
    case "sage": … case "coral": … case "amber": … case "sky": … case "lavender": … case "ember": … case "ink": …
    default: return null;          // ← teal, indigo, rose, moss, clay, plum ALL land here
  }
}
```

`apps/mobile/src/app/(home)/profile.tsx:86` offers twelve:

```ts
const ACCENTS = ["ink","sage","coral","amber","sky","lavender","teal","indigo","rose","moss","clay","plum"];
```

Six identity hues (`teal, indigo, rose, moss, clay, plum`) were added to the theme and to this picker
during the neumorphic design work, but the **resolver was never taught their names**. Each returns `null`
and the swatch falls back to ember. Six names → one orange. The count in the frame matches the six unmapped
names exactly.

**Why it escaped:** the resolver returns `null` rather than throwing, and `null` renders as a plausible
colour. Nothing in the type system or the tests connects the ACCENTS list to the resolver's switch.

**Repro:** Today → tap own avatar → My Profile → YOUR COLOR. Count distinct colours among the non-dimmed
swatches. Expected 8 distinct, actual 3 (grey, green, orange×6).

---

## BUG-02 — Two colour pickers, and the Settings one has no collision protection

**Evidence:** GFIS @09:04–09:31, and again @23:56 (GPop) and @30:16 (Beannie).

> "In the settings page, you do have the ability to select a color that someone else is already on. And what
> it does is it just gives them a slightly different color than they had, boots them off… It does not match
> the color profile picker that is available from the main page."

**Root cause — confirmed.** There are **three** independent ACCENTS lists:

| File | Line | Entries | Collision check |
|---|---|---|---|
| `app/(home)/profile.tsx` | 86 | 12 | ✅ `takenColors` (line 163) |
| `app/(settings)/index.tsx` | 452 | **6, a different set** | ❌ none |
| `components/Onboarding.tsx` | 29 | 6 | ❌ none |

The Settings member editor lets anyone take a colour already held, silently displacing its owner. Colour is
the app's primary identity signal on the calendar, so this corrupts identity family-wide.

**Repro:** Settings → Household → tap another member → pick a colour already used → save. The original
holder is displaced with no warning.

---

## BUG-03 — Saving an event on someone else's calendar does nothing visible

**Evidence:** QTLK @15:50–16:04, frames `F1_946/952/958/964.jpg`.

> "Upon saving the card did actually not retract. The pop-up did not retract. We're going to do that again.
> It did not retract. I'll go ahead and pull it down."

Frames 958 and 964 are **pixel-identical** apart from his pointer: no spinner, no notice, no dismissal. He
gives up and drags the sheet down by hand.

**Root cause — confirmed, and it is not a missing `router.back()`.**

The button reads "**Save to FamiliOS**", which per `event-form.tsx:860` only renders when `appendOnly === true`
— a mirrored event where he may append his half only. Two paths can leave the sheet open:

1. `event-form.tsx:337-341` — with a Google push pending approval, the code **deliberately** returns without
   closing, trusting an approval panel to explain itself.
2. `event-form.tsx:342-346` — a falsy `r.event` calls `setNotice(...)`.

Both share one fatal detail: **`event-form.tsx:482` renders the notice at the TOP of the form content**,
while the Save button is pinned to the BOTTOM (line 860) above an open keyboard. He was scrolled to the
attendee/driver section. Any explanation rendered ~1,500pt above his viewport — entirely off-screen.

Compounding it, line 871 sets the disabled-hint to the **empty string** when `appendOnly`:

```ts
{appendOnly ? "" : !title.trim() ? "Give it a title to save." : endInvalid ? "Fix the end time to save." : ""}
```

So on exactly this screen, the form can decline or fail and say nothing at all.

**This is the recurring defect class in this codebase:** the outcome is reported somewhere the person is not
looking. Same family as the Ask-Famili false-send, the auto-file toast, and the "Writing…" progress label.

**Repro:** Sign in as Ross → Calendar → open "Amelia's dance" (Melissa's mirrored event) → scroll to WHAT TO
BRING → type a note (keyboard open) → tap "Save to FamiliOS". Sheet stays; nothing is shown.

---

## BUG-04 — Task detail "back" lands on Settings

**Evidence:** BMXC @14:41–15:38, and again GFIS @20:32–21:03 for meals.

> "If I'm able to click back from here, I should actually be landing back on the today screen because that's
> how I got here… However, when I click back, I get to the settings page."

**Root cause — confirmed.** `app/(settings)/index.tsx:308-309`

```tsx
<Row title="Tasks & Lists" onPress={() => router.push("/tasks")} />
<Row title="Meals"         onPress={() => router.push("/meals")} />
```

`/tasks` and `/meals` are pushed onto the **Settings** stack. Whichever entry point you arrive from, the
route's parent is Settings, so Back unwinds there. He explicitly connects the cause himself at GFIS @20:46:
*"the reason that is is because of that additional task and list actual button here and meals button here
under more."*

**Repro:** Today → scroll to a task → tap it → tap Back. Lands on Settings, not Today.

---

## BUG-05 — Artifacts have no privacy at all

**Evidence:** GFIS @05:27–06:13 (owner), confirmed again @22:44–23:19 on GPop's account.

> "There is no privacy with these artifacts… you can see artifacts that were performed in private chats."

**Root cause — confirmed.** `server/index.mjs:3068-3072`

```js
if (path === "/api/artifacts" && method === "GET") {
  const all = listArtifacts({ householdId: g.session.householdId, … });
  return json(res, 200, { artifacts: all }, req);   // no canSeeEntity, no scope filter
}
```

Every other collection (events, tasks, meals, knowledge, files) is filtered through `canSeeEntity`.
Artifacts are not filtered at all. An artifact produced inside a personal or nest-scoped chat is readable by
every member of the household. **This is a privacy defect, not a UI defect**, and it is the second one of
this exact shape found in two sessions (the first being knowledge items' `personal` scope).

**Repro:** Owner → Ask → personal chat → run something that produces an artifact → sign out → sign in as
GPop → Library → Artifacts. The owner's private artifact is listed.

---

## BUG-06 — Memories are never created

**Evidence:** GFIS @29:54, @23:19.

> "There's no memories being generated. I'm not sure what's going on with memories, but it seems to be
> entirely broken or non-existent throughout the application and every profile."

**Root cause — confirmed by inspection.** Memory has exactly **one** automatic trigger:
`server/engine.mjs:130-142`, which fires only when a multi-step **run** completes, and only if a **second
LLM call** (`MEMORY_JUDGE_SYS`) returns `remember: true` with text between 8 and 500 characters. Any provider
hiccup returns early and silently.

There is **no path from ordinary conversation to memory**. The read path (`/api/memory`) and the storage
layer (`memory-provider.mjs`, sqlite FTS5) are both healthy — nothing is being written for them to return.

---

# PART 2 — Issue clusters

110 distinct requests. Grouped by the underlying decision rather than by screen, because most of these
recur on four or five screens and fixing them per-screen means fixing them five times.

### Cluster A — Identity & colour (BUG-01, BUG-02 + 4 requests)
One resolver, one palette, one collision rule. Add a spectrum/palette picker so colours aren't limited to a
fixed list. Enforce uniqueness family-wide. Distinguish GPop/Beannie (currently amber vs coral — too close).

### Cluster B — "You" belong at the top, not in the row (4 requests)
QTLK @00:18–01:30, GFIS @07:01, @23:31, @30:16. Own avatar leaves the family strip and folds up to the
top-right, animated. Same treatment on Settings. The row becomes *your family*, not *everyone including you*.

### Cluster C — Event ownership is invisible (4 requests)
QTLK @01:47–04:31, @09:05. Cards don't say whose event they are. Ownership should be automatic from the
creating profile. Attendee dots need small profile photos, placed on the title side.

### Cluster D — Event permissions: the big one (9 requests)
QTLK @04:31–08:00, @09:35–15:50, @18:36–21:16. On someone else's event a non-owner can currently edit title,
time, location, notes, attendees and driver. Required model:
- **Read-only** for everything the owner controls
- A **private per-viewer note** ("Just for me", not "Just for us") that never touches the shared record
- What-to-bring becomes private + an explicit **"Suggest to the owner"** action
- Self-attendance becomes **"Request to attend"** → owner approves
- Driver selection becomes **"Offer transportation"** → owner approves
- Creator's view shows **pending requests** with accept/decline; participant-only blocks don't render for them
- "No driver" disappears; the field is simply optional

### Cluster E — The external-calendar banner is shouting (3 requests)
QTLK @09:35–10:23, @16:34, @18:19. The "From another calendar…" notice renders in full on every event.
Collapse to a glowing ⓘ badge, expandable on tap.

### Cluster F — Event save feedback (BUG-03)

### Cluster G — Shared events lose their shared identity (3 requests)
QTLK @16:04–16:34, @17:39–18:12, @21:48. Adding himself to Melissa's event repainted it as *his* (single
green) on both profiles instead of showing as shared/two-colour. Her photo never appears on her own event.

### Cluster H — Calendar scope filter (3 requests)
QTLK @22:23–24:07. Filter beside Sync: **Family / My Nest / Just me**. Must persist across launches. "Coming
up" follows the same filter.

### Cluster I — Notifications & inbox (5 requests)
QTLK @24:41–28:00. Attendance changes fire no notification. Updates land in "Needs your attention" with no
badge. Items carry no context (who/what/when) and vanish on tap. He wants a persistent **inbox icon** at top
with badges for approvals + updates.

### Cluster J — Lock screen scroll (1 request, REGRESSION)
QTLK @27:10. *"I have to, on the login, select my profile, I have to scroll up just to get to the sign in
button."* This was addressed once before; it is back.

### Cluster K — Task scope model (5 requests) ⚠️ **ORDER CONFLICT — see Part 5**
BMXC @00:23–03:40, @07:34–09:27. Replace Everyone/Me/Others with **Family / My Nest / Just me**. Default
always "Just me". Assignment controls hidden for "just me" and "everyone"; auto-populated for "my nest".
Choosing a scope should **move** the item into that group's list.

### Cluster L — List lifecycle (3 requests + 1 bug)
BMXC @03:40–04:11, @10:33–11:59. Lists can't be deleted. Deleting the last task deletes the whole list.
Creating a task with nest scope under Family *"did not want to create it at all — that's a bug."*

### Cluster M — Archive (1 request)
BMXC @01:48–02:31. Completed tasks auto-archive after 3 days into an "Archived" section.

### Cluster N — Reminders vs alerts (4 requests)
BMXC @04:11–04:42, @06:06–07:05. Calendar's become "Alerts", tasks keep "Reminders". Settable **at creation**.
**Multi-select** (day before AND an hour before). High-priority delivery that can break through silent.

### Cluster O — Groceries exist twice (3 requests)
BMXC @11:59–14:41. Tasks&Lists and Meals both own groceries with different capabilities; Meals can't edit
item details. Merge; a family-wide grocery list is conceptually wrong — it belongs to a nest.

### Cluster P — Back navigation (BUG-04 + remove duplicate entry points)

### Cluster Q — Task colour on Today (2 requests)
BMXC @15:42–16:09. His tasks render blue; they should carry his member colour. Tapping should route to the
Tasks page and Back should return to where he came from.

### Cluster R — Ask Famili card is a facade (2 requests)
BMXC @16:56, GFIS @03:29–04:10. The Today card redirects instead of accepting input. Make it a real mini
composer (type, dictate, send) that hands off to Ask. Spaces per role: Personal / My Nest / Family; a child
gets nest + family only, never personal.

### Cluster S — "Coming up" should be *mine* (2 requests)
GFIS @00:05–02:21. It currently mirrors the family calendar. It should be only events and tasks **I'm on**,
next 5–7 days, styled like the Ask-for-help list.

### Cluster T — "What I did" lacks context (2 requests)
GFIS @02:21–03:19. Can't tell whether it was him or an agent, or what actually happened. "What I learned" is
good and stays.

### Cluster U — Library (BUG-05, BUG-06 + 2 requests)
GFIS @04:57–06:56. Files need category-colour hue rings. Artifacts inherit their chat's scope — while their
*content* stays available to the assistant cross-account.

### Cluster V — Settings IA (13 requests)
GFIS @06:56–15:30, @24:35–26:39, @30:39. Consolidate all connectors under "All connections and calendars";
grey out unconfigured ones with "coming soon"; move AI providers in; add missing icons; collapse feed/status
blocks; ICS paste → file import; "Connect Google Calendar" → "Connect calendar", triggered at account-connect
time; remove the Appearance card; **remove the backend URL and API link (production hygiene)**; dark mode
becomes a small top toggle; remove Tasks&Lists + Meals from More; Manage Household becomes informational for
non-admins; invite button only for owner/admin.

### Cluster W — Role & permission matrix (8 requests)
GFIS @07:21–09:04, @13:46–14:52, @26:39–27:27, @28:38–29:54, @31:33. Adult admins edit only
themselves/their child/their nest. Children edit only their own colour. Approval-gated tools scope **per
nest**, not family-wide. Advanced mode and advanced builders need a warning + PIN. Contacts: owner sees all,
others only their own/nest. **Limited members need more access than they have** — their own siloed agents,
and the "only an owner/adult admin can run or change agents" note is now wrong for personal agents.
Automations/playbooks need a "proceed with caution" gate plus an approval request to the nest's highest-access
adult.

### Cluster X — Nests (3 requests)
GFIS @15:59–17:19. A child cannot answer a nest invitation — no approval surface exists on the child profile.
Nest approvals should route through the highest-access adult in the nest. **One nest at a time**: you cannot
join another until you leave your current one.

### Cluster Y — Calendar connection permissions (2 requests)
GFIS @24:35–25:37. Adult and limited members must not sync or remove calendars they didn't add. They may see
them with a last-sync time, read-only.

### Cluster Z — Child account (4 requests)
GFIS @33:27–35:38. Full **read-only** calendar behind its own button. Ask/offer help as a prominent button.
Can ask help from adults only; offering is greyed out. Colours and emoji only — no photo.

### Cluster AA — Agent siloing (3 requests)
GFIS @04:16, @21:03–22:44, @28:38. Agents belong to a person or a nest and are invisible and unmodifiable
outside it. An adult member gets a family-access option, but creating/editing there prompts to transfer the
agent to personal or nest scope.

---

# PART 3 — Customer experience & impact

**Who he is in this recording:** the household owner, testing the product he intends to ship to families,
across five real profiles (owner, adult member, adult in another nest, limited member, child).

**What the session felt like.** The tone is methodical, not frustrated — he is doing careful QA. But three
moments break that composure, and they're the ones that matter:

1. **@15:50, the save that did nothing.** He taps, waits, taps again, says *"it did not retract"* twice, then
   drags the sheet down by hand. This is the single worst moment in 82 minutes: the app gave him no signal at
   all. Trust cost is disproportionate to the fix.

2. **@16:04, discovering the event became his.** Adding himself to his wife's event silently rewrote its
   ownership and colour on *both* profiles. He then had to log into her account to verify the damage. For a
   family product, an app that quietly reassigns your spouse's calendar entry is a credibility problem, not a
   bug.

3. **@05:27 and @29:54, privacy.** Artifacts from private chats visible to everyone, and memories that
   don't exist. He states the product principle plainly at GFIS @22:44: *"Remember, this is privacy first,
   siloed first operations."* Two of the five verified defects violate exactly that.

**Impact if shipped as-is:** the calendar cannot be trusted by more than one adult (Clusters C, D, G), the
privacy promise is materially false (BUG-05, knowledge, artifacts), and identity is visually ambiguous
(BUG-01/02 — six people, three distinguishable colours). Those three block a family beta.

---

# PART 4 — Test cases from his exact steps

**T-01 (BUG-01)** Today → own avatar → My Profile → YOUR COLOR.
*Assert:* every non-dimmed swatch is a distinct colour; no two resolve to the same hex.
*Regression guard:* a unit test asserting `ACCENTS.every(a => memberAccent(colors, a) !== null)` and that the
resolved set has no duplicates. This test would have caught BUG-01 the day it was introduced.

**T-02 (BUG-02)** Settings → Household → member → choose a colour already held → save.
*Assert:* refused with a toast naming the holder; the original holder's colour is unchanged.
*Assert:* the swatch set is identical to the one on My Profile.

**T-03 (BUG-03)** Ross → Calendar → "Amelia's dance" (mirrored, Melissa's) → scroll to WHAT TO BRING → type
with keyboard open → tap "Save to FamiliOS".
*Assert:* either the sheet dismisses, or a notice is visible **within the current viewport** explaining why
it didn't. Never neither.

**T-04 (BUG-04)** Today → task → tap → Back.
*Assert:* lands on Today. Repeat entering from Calendar → lands on Calendar.

**T-05 (BUG-05)** Owner → personal chat producing an artifact → sign in as GPop → Library → Artifacts.
*Assert:* the owner's personal artifact is absent. *Assert:* asking GPop's assistant a question whose answer
depends on that artifact's content still works.

**T-06 (BUG-06)** Complete a run, then hold an ordinary conversation containing a durable preference.
*Assert:* at least one memory exists afterwards; `/api/memory` returns it for its author.

**T-07 (Cluster D)** As Ross open GPop's event.
*Assert:* title/time/location/notes are non-editable; attendee and driver controls are not settable; a
"Request to attend" and an "Offer transportation" action exist; a note typed in "Just for me" is invisible in
GPop's session.

**T-08 (Cluster G)** As Ross add self to Melissa's event → save → inspect both profiles.
*Assert:* the event still belongs to Melissa; renders as shared with two colours; her photo shows on her own
event.

**T-09 (Cluster I)** As Ross change attendance on Melissa's event.
*Assert:* Melissa receives a notification; her inbox badge increments; the entry names who/what/when; tapping
opens detail rather than dismissing.

**T-10 (Cluster L)** Create list → add one task → delete that task.
*Assert:* the list still exists. Then press-and-hold the list → delete → it's gone.

**T-11 (Cluster K)** Create a task under Family with "My Nest" scope.
*Assert:* it is created, and it appears under the nest group, not under Family.

---

# PART 5 — ⚠️ ONE CONFLICT NEEDING HIS DECISION

**The scope-picker order contradicts what I shipped last session.**

Last session, from the marked-up screenshot IMG_3061 (arrows moving "Everyone" to the right), I implemented
**Just me → My Nest → Everyone** and shipped it in build 57.

In this recording he states the opposite twice, explicitly, as a standard:

> BMXC @02:50 — "Everyone needs to go up here. So it's everybody, the entire family, my nest, and then just me."
> BMXC @08:08 — "we're gonna try to follow a norm of everyone, my nest, just me."

He also says the **default** must always be "Just me" (BMXC @08:57), which is compatible with either order.

**My reading:** the new spoken instruction is later, stated twice, and framed as the app-wide norm — so
**Everyone → My Nest → Just me** with a "Just me" default. But because this reverses shipped work and touches
every scope control in the app, I am not guessing. **This is the one item I need you to confirm.**

---

# PART 6 — Sequencing rationale

Ordered by dependency and by damage-if-shipped, not by effort:

1. **Privacy & correctness first** — BUG-05, BUG-06, Cluster D, Cluster G. These are false promises; everything
   else is polish by comparison.
2. **Identity second** — BUG-01/02 + Cluster A. Cheap, and every calendar cluster depends on colour meaning
   something.
3. **Trust in feedback** — BUG-03, Cluster I. The app must never act without saying so.
4. **Structure** — Clusters K/L/M/N/O/P/Q (tasks), H/S (scope filters).
5. **IA and roles** — Clusters V/W/X/Y/Z/AA. Largest surface, lowest risk.
6. **Polish** — B, C, E, R, T.
