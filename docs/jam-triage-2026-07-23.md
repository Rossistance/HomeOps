# Jam Triage — 2026-07-23

Two recordings by William Ross Hixon, both iPhone 13 Pro Max / iOS 27, recorded ~3 hours apart.

| Jam | Surface | Length | Focus |
|---|---|---|---|
| [7b44f45c](https://jam.dev/c/7b44f45c-982c-4b50-8172-619c6b951934) | **iOS app** (TestFlight) | 16m 06s | Calendar: viewing, creating, editing, deleting events |
| [9184c01b](https://jam.dev/c/9184c01b-9461-486c-a944-e84c1ad371e8) | **Web app** (homeops-ai.onrender.com) | 38m 20s | Whole-app sweep after the 2026-07-21/22 mission shipped |

Evidence: Jam 1 has full intent analysis + narration. Jam 2's transcript is complete; its automated
intent extraction failed (over the 30-minute processing limit) and console/network artifacts return
404 from the CDN, so Jam 2 findings are transcript- and code-anchored rather than trace-anchored.

---

## 1. Customer experience and impact

The reporter is the product owner testing his own family's data. Across 54 minutes he finds the app
**pretty** but **not trustworthy**: the calendar shows his anniversary on the wrong number of days,
events he creates don't appear, events he deletes come back, agents report "completed" while doing
nothing, and — most damaging — the cleanup he approved two days earlier appears not to have happened
at all. His closing words set the stakes:

> "there's just so much to look at on here that you need to really take a massive dive into here and
> see what went wrong the last coding session or the last two with the top gun skill… **I want some
> answers or I'm just going to revert back into a safe place.**"

Impact: **trust, not features.** He can enumerate what each screen *should* do; what he cannot do is
believe what any screen tells him. Every issue below is a variant of "the app said X, reality was Y."

---

## 2. Issue clusters

| # | Cluster | Jams | Items | Severity |
|---|---|---|---|---|
| **A** | **Approved data cleanup never reached production** | J2 | 3 | **P0 — trust** |
| **B** | Agent execution: attribution + wrong-skill selection | J2 | 4 | **P0 — core function** |
| **C** | Calendar correctness (dates, create, delete) | J1 | 5 | **P0 — data integrity** |
| **D** | Approval-gate sprawl (per-helper × per-agent × per-skill) | J2 | 4 | P1 |
| **E** | Mobile input/keyboard UX | J1 | 4 | P1 |
| **F** | Text overflow / readability | J1, J2 | 4 | P1 |
| **G** | Navigation and findability | J2 | 6 | P1 |
| **H** | Web ↔ iOS divergence | J1, J2 | 5 | P1 (see `platform-parity-matrix.md`) |
| **I** | Memory quality (duplicates, wrong types) | J2 | 1 | P2 |
| **J** | Production environment gaps (browser runtime) | J2 | 1 | P2 |
| **K** | Layout/placement polish | J1, J2 | 6 | P3 |

---

## 3. THE root cause behind the loudest complaint

### FIN-001 — The migration, wipe, and sweep ran against the **local dev database**, never production

**Confirmed.** This single fact explains the reporter's angriest observations:

> "under helper agents… **There's still a morning helper, a morning briefing agent, another morning
> briefing agent, another morning briefing agent, and a morning briefing helper, a morning briefing
> helper, a morning briefing agent.**"
> "Now let's go to improvements. **I thought you were cleaning this up.**"

**Evidence chain:**

| Fact | Source |
|---|---|
| Production stores data on a Render persistent disk at `/data` | `render.yaml` → `HOMEOPS_DATA_DIR=/data`, `disk: homeops-data` |
| Every data operation targeted tenant `local` on the Windows dev box | `implementation/migration-dry-run-report.md` → "**Resident tenant:** `local`"; `server/.data/tenants/local/household.db` |
| The migration tool refuses to run without an explicit `--tenant` | same report → "`--apply` refuses without an explicit `--tenant <householdId>`" |
| Production **code** is current (mission code shipped fine) | `GET /api/health` → `memoryProvider.backend: "sqlite-fts5"` (the WP-007 brain) |

So: **code deployed, data untouched.** The 57→14 helper consolidation, the Gmail-agent instruction
revert, the archiving of 21 improvement records, and the sweep of 9 stuck runs all happened to a
*copy* of the household living on the developer machine. The household the reporter actually uses —
on Render — still has every duplicate, every improvement row, and every stuck run.

**This was a reporting failure as much as a technical one:** the mission told the user "your Gmail
agent is restored, 21 improvements archived, 14 packages active" without qualifying that this applied
to the local tenant only.

**Fix:** run the same three guarded operations against the production tenant, in this order:
1. Export a fresh backup **through the deployed app's own export endpoint** (never touch the disk directly — hot-WAL rule).
2. Identify the production `householdId` (it is *not* `local`; likely `hh_…`).
3. Re-run `wp008b-execute.mjs` and the migration tool with `--tenant <prod-id>` + `HOMEOPS_MIGRATION_CONFIRM=yes`, against the production API (or via a one-shot Render job), then re-run the four invariant checks.
4. Restart with `HOMEOPS_SWEEP_LEGACY_PARKED=1` once to expire production's legacy parked runs.

**Do not skip the dry-run.** Production data ≠ local data; the disposition table must be regenerated.

---

## 4. Engineering-ready tickets

### BUG-001 — All-day Google events render one day too long
**Cluster C · P0 · iOS + web · CONFIRMED root cause**

**Reporter (Jam 1, 00:15):**
> "It's showing two days for my anniversary. All day tomorrow and all day Friday… I'm not sure where
> it got that information from."

**Steps to reproduce**
1. In Google Calendar, create a single-day all-day event (e.g. "Mr. & Mrs. Anniversary" on Jul 23).
2. Sync it into FamiliOS (Calendar → Sync).
3. Open the FamiliOS calendar list.

**Expected:** the event appears on Jul 23 only.
**Actual:** it appears on Jul 23 **and** Jul 24.

**Root cause** — a two-layer boundary error:
- Google's all-day API contract uses an **exclusive** `end.date`: a Jul-23 all-day event arrives as `start.date=2026-07-23`, `end.date=2026-07-24`.
- The server stores that verbatim: [`server/calendar.mjs:24`](../server/calendar.mjs) — `endAt: e.end?.dateTime ?? e.end?.date ?? null`.
- The client then treats the end day as **inclusive**: [`apps/mobile/src/lib/event-days.ts:16`](../apps/mobile/src/lib/event-days.ts) — `return d0 >= s0 && d0 <= Math.max(s0, e0);`

Exclusive-in, inclusive-out ⇒ exactly one extra day, on every all-day event.

**Fix at the source (ingest boundary), not the renderer:** in `parseGoogleEvents`, when
`allDay === true` and `end.date` is present, subtract one day so `endAt` is the **inclusive** last
day. Document the invariant ("`endAt` is always inclusive") next to `coversDay`. Fixing only the
client would leave every other consumer (web, digests, exports) wrong.

**Regression risk:** multi-day all-day events (a 3-day camping trip) must still cover 3 days —
include one in the test.

---

### BUG-002 — A newly created event does not appear in the calendar
**Cluster C · P0 · iOS · root cause NOT yet confirmed**

**Reporter (Jam 1, ~10:14):**
> "I added the event. But you know what? I don't see it immediately on here… **I do not see the
> additional calendar event that I just added. That's a major error.**"

**Steps to reproduce**
1. Calendar → new event → title, all-day, tomorrow's date → **Add event**.
2. Observe the spinner, then the calendar list.
3. Navigate away and back; press Sync.

**Expected:** the event appears immediately in the list.
**Actual:** absent immediately, absent after back-navigation, absent after an explicit sync.

**Investigation needed before fixing** (do not guess — three plausible causes):
1. **Write succeeded, list didn't refetch** — check whether the create mutation invalidates the events query on mobile.
2. **Write succeeded into a layer/space the list filters out** — `calendar.mjs` distinguishes `canonical` vs `linked` layers; a locally-created event may land outside the current filter.
3. **Write silently failed** — the spinner completed but the POST 4xx'd.

**Discriminating check:** create an event in the app, then `GET /api/events` directly. Present in the
API but not the UI ⇒ cause 1 or 2. Absent from the API ⇒ cause 3. **This one check splits all three.**

---

### BUG-003 — Deleted events resurrect from Google on the next sync
**Cluster C · P0 · iOS · root cause NOT yet confirmed**

**Reporter (Jam 1, ~14:00):**
> "Let's delete this event… 'Will be removed from the household calendar.' Yeah, but what about the
> Google calendar? We'll find out. We'll sync again… **Oh, there it is, from the Google calendar. So
> it didn't delete from the Google calendar.**"

**Steps to reproduce**
1. Open a Google-sourced event in FamiliOS → Delete event → confirm.
2. Verify it disappears from the FamiliOS list.
3. Press Sync.

**Expected:** deletion propagates to Google (or the UI states plainly that it won't).
**Actual:** the event returns on the next sync — the local delete is silently undone.

**Two defects in one:**
- **(a) Behavioural:** delete does not call Google's delete for `linked`/Google-sourced events, so re-sync re-imports it. Either propagate the delete (the event carries `provenance.googleEventId` per [`server/calendar.mjs:150-151`](../server/calendar.mjs), so write-back is possible), or persist a local tombstone that sync respects.
- **(b) Copy:** the confirmation says "will be removed from the household calendar" — technically true, deeply misleading. It must say what happens to the Google copy.

---

### BUG-004 — Agent runs fail with "no acting agent"
**Cluster B · P0 · web + iOS · source CONFIRMED, trigger path needs confirming**

**Reporter (Jam 2, 02:49 and 15:35):**
> "No acting agent… **the run also ended in no acting agent**"

**Root cause (source confirmed):** [`server/internal-functions.mjs:487`](../server/internal-functions.mjs)
refuses the send when `ctx.agentId` is null, because recipient allowlists are granted per-helper:
> `"This send needs to run as a specific helper, because the recipient's allowlist is granted per helper."`

The 2026-07-21 mission fixed this for **chat** runs (they now carry `agt_household`) and for the
agent **"Run now"** button. It did **not** fix the path the reporter is using: runs started from a
**skill/automation/template whose `defaultAgentId` is unset**, where `sourceRef.agentId` stays null.

**Next discriminating check:** for one failing run, read `sourceRef` from `GET /api/runs/:id`. Null
`agentId` ⇒ confirmed; non-null ⇒ the allowlist itself is the blocker, not attribution.

**Fix direction:** give every run-start path a server-verified acting agent — default to the
household agent when a skill has no `defaultAgentId`, the same self-heal already added for chat in
commit `368514d` — rather than adding another per-surface toggle.

---

### BUG-005 — The planner picks obviously wrong skills (a recipe agent fetches weather)
**Cluster B · P0 · web · root cause NOT investigated**

**Reporter (Jam 2, 02:00 and 16:33):**
> "It looks for a recipe. It uses a recipe agent. That doesn't seem right."
> "**This is where a recipe agent tried to call the weather.**"
> "No recipe found on the morning briefing helper." (×3)

A *morning briefing* run selects a *recipe-extraction* skill, then fails "no recipe found." Related:
> "it tells me these are the agents that it's gonna use — **those just don't exist**… almost all don't exist"

Templates reference agent IDs absent from the household, so multi-agent plans are unrunnable from
birth. **Investigate:** how the planner scores skills against intent, and whether template
`agentId`s are validated at install time. This is the difference between "the app tried and failed"
and "the app never had a chance."

---

### BUG-006 — Approval gates must be set separately on every helper, agent, and skill
**Cluster D · P1 · web**

**Reporter (Jam 2, 02:32 and 22:42):**
> "there's too many control surfaces to either approve or not approve. There's one inside of each
> helper, one inside of each agent. And if the engine creates multiple different agents, then they
> all have to be manually set."
> "there's a *requires human approval before executing* button on this one as well. So that means
> **every single one of these skills also needs to be changed.**"

Worse, the global control lies:
> "so it's saying that this covers all of it but that's not true. I've got email selected as skip
> approval… and you can also see the UI is off, covering the word *skip*."

**Two tickets:** (a) make the household-level risk policy authoritative, with per-entity settings as
explicit overrides that display their inherited state; (b) fix the truncated label in the risk matrix.

---

### BUG-007 — Unified Helper Agents and Advanced Mode conflict
**Cluster D · P1 · web · regression from WP-005**

**Reporter (Jam 2, 17:42):**
> "if I have unified helper on, it shows the helper… but if I turn on advanced skill mode at the same
> time, it shows all of them. **Why shouldn't one turn the other off?** That's just kind of silly."

This is a design flaw I introduced: WP-005 reused the existing Advanced Mode as the reveal for
Automations/Skills/Functions, so both toggles on = the fragmented nav returns. Make the two mutually
exclusive, or fold Advanced Mode into the unified toggle as a single three-state control.

---

### BUG-008 — Text does not wrap or scroll anywhere; the keyboard hides what you type
**Cluster E+F · P1 · both platforms**

**Reporter (Jam 1, ~04:00; Jam 2, 36:23):**
> "If I go to type, **I can't see what I'm typing** and I cannot see it at all until… can't see what I'm typing."
> "It does not wrap… I have to select a word to get over there, because otherwise **I cannot scroll on it. I can't swipe left or right.**"
> "look at all this text, **none of it wraps, I can't read any of it**… can't even read the people's names up at the top. And that's the same for every single page."

Three distinct defects: (a) inputs not scrolled above the iOS keyboard (`KeyboardAvoidingView` / `keyboardShouldPersistTaps` missing); (b) single-line inputs that neither wrap nor scroll horizontally; (c) web list/card text truncated without wrap. (c) is the broadest — it affects "every single page."

---

### Remaining issues (compact)

| ID | Cluster | Issue | Platform | Sev |
|---|---|---|---|---|
| BUG-009 | C | Google account not shown on synced events (repeat ask) | iOS | P2 |
| BUG-010 | E | Unsaved new-event draft is lost on navigate-away | iOS | P2 |
| BUG-011 | G | Automations list can't be clicked into; empty on web | web | P1 |
| BUG-012 | G | Groceries shown on dashboard but unreachable anywhere | web | P1 |
| BUG-013 | G | Navigation "throws you around"; no subpages, no swipe-back; back exits the whole page | web | P1 |
| BUG-014 | G | Chore-board card moved → vanishes with no indication where | web | P2 |
| BUG-015 | G | Closing an image returns to the image page, not the previous screen | web | P2 |
| BUG-016 | G | Sensitive-info vault cannot be located | web | P2 |
| BUG-017 | I | Memory duplicates (anniversary ×3) and wrong type classification (location stored as "fact"/"preference") | web | P2 |
| BUG-018 | K | Files & Knowledge lists profile pictures as documents | web | P2 |
| BUG-019 | J | Production has no browser runtime (`browserRuntime:false`) → browser tools always fail | prod | P2 |
| BUG-020 | H | Web event detail omits the end date that iOS shows | web | P2 |
| BUG-021 | D | Capabilities counts contradict ("6 executed, 6 permitted" then "5 permitted") | web | P2 |
| BUG-022 | B | Skills/capabilities should be inferred automatically, not hand-authored ("the app should be doing this by itself") | web | P1 |
| BUG-023 | K | Subscriptions card buried at the bottom of a long scroll; should be compact and near Sync | iOS | P3 |
| BUG-024 | K | Event address is not a tappable maps link; location input should offer search | iOS | P3 |
| BUG-025 | K | What-to-bring / driver icons too small to read | iOS | P3 |
| BUG-026 | K | Calendar color-coding present in Calendar but absent on the main page | web | P3 |
| BUG-027 | K | Event cards don't show enough at a glance, forcing an open per event | iOS | P2 |
| BUG-028 | K | No week-separator rule between weeks in the agenda list | iOS | P3 |
| BUG-029 | H | Knowledge library, spaces, and agent lists differ between web and iOS | both | P1 |

---

## 5. Test cases from the exact recorded steps

Written to run in `tests/topgun/` against a disposable household.

**TC-001 — all-day events span exactly their real days** (BUG-001)
```
GIVEN a Google all-day event on day D (Google sends end.date = D+1)
WHEN it syncs into FamiliOS
THEN it renders on day D and NOT on D+1
AND a 3-day all-day event renders on exactly its 3 days
```

**TC-002 — a created event is immediately visible** (BUG-002)
```
GIVEN the calendar list is open
WHEN I create an all-day event titled "<long title>" for tomorrow and tap Add event
THEN it appears in the list without a manual refresh
AND GET /api/events contains it
AND it survives navigate-away → back
```

**TC-003 — delete means deleted** (BUG-003)
```
GIVEN a Google-sourced event visible in FamiliOS
WHEN I delete it and confirm, then press Sync
THEN it does not reappear
AND the confirmation text stated explicitly what happens to the Google copy
```

**TC-004 — every run path has an acting agent** (BUG-004)
```
FOR EACH start path (chat, agent Run now, skill, automation, template, scheduled trigger):
WHEN a run executes a notify/send step
THEN sourceRef.agentId is non-null
AND the run never fails with "no_acting_agent"
```

**TC-005 — long text is readable everywhere** (BUG-008)
```
GIVEN any list/card/detail rendering user text
WHEN the text exceeds one line
THEN it wraps or is horizontally scrollable — never silently truncated
AND on iOS, a focused input is never covered by the keyboard
```

**TC-006 — one approval policy governs** (BUG-006)
```
GIVEN the household risk policy sets email to "skip approval"
WHEN any helper/agent/skill runs an email step
THEN it does not pause for approval
AND per-entity screens show the inherited policy rather than an unset toggle
```

---

## 6. Change plan (ordered by trust recovered per unit of work)

| Order | Work | Why first |
|---|---|---|
| 1 | **FIN-001** — run the approved cleanup against production data | The reporter's loudest complaint; already approved; no new code |
| 2 | **BUG-004 + BUG-005** — acting agent on every path; planner/template validity | Nothing else matters if runs can't execute |
| 3 | **BUG-001** — all-day off-by-one at the ingest boundary | Confirmed, small, visibly wrong every single day |
| 4 | **BUG-002 + BUG-003** — run the discriminating checks, then fix create/delete | Data-integrity; checks are cheap |
| 5 | **BUG-008** — text wrap + keyboard avoidance | Affects "every single page" |
| 6 | **BUG-006 + BUG-007** — approval policy inheritance; toggle conflict | Removes per-entity toil |
| 7 | Cluster G — navigation and findability | Large but mostly independent |
| 8 | Cluster H — apply `platform-parity-matrix.md` decisions | Needs the reporter's platform picks first |

**Method note:** items 3 and 4 have confirmed or near-confirmed root causes. Everything in clusters
B, G and I needs its discriminating check run *before* code is written — the checks are named inline
above. No fix should be attempted from the symptom alone.
