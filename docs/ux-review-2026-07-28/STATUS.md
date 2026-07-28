# Implementation status — 7-27 walkthrough set #2

Statuses written per item as each landed, **never in bulk** — the last inventory's ✅ column
was filled by find-and-replace and lied twice (see docs/ux-review-2026-07-27/INVENTORY.md,
"Correction"). ✅ means committed with tests where the behaviour is testable; ◐ means partially
landed with the remainder named; ⬜ means not started. Builds 59–65 carry this work; the Opus-5 re-audit and the R-phases land in 66.

**Every ⬜ and ◐ from the first ledger is now closed.** Two judgement calls are recorded rather than hidden: Manage Household was renamed rather than removed (he said both at different points; the later, more specific observation says minimise), and the calendar-side "Alerts" rename has no surface to land on because iOS events carry no reminder control.

**Scope-order decision (owner-confirmed):** Everyone → My Nest → Just me, default Just me.
This reversed build 57's order; flipped in P4a.

## The six root-caused bugs

| Bug | Status | Where |
|---|---|---|
| BUG-01 six identical oranges | ✅ resolver knows all 12; regression test walks ACCENTS×both themes | P2, `member-colors.ts` |
| BUG-02 unguarded Settings picker | ✅ one ColorPicker + spectrum; server 409 color_taken (names holder); unknown colour 400s instead of silently dropping | P2 |
| BUG-03 save did nothing visibly | ✅ keyboard dismissed on save; notice moved beside the Save bar; appendOnly hint no longer hard-coded empty | P1 |
| BUG-04 Back landed on Settings | ✅ /tasks + /meals moved to the home stack; Settings rows removed | P4a |
| BUG-05 artifacts had no privacy | ✅ read-time filter through the run's conversation; retroactive; orphans fail open | P1 |
| BUG-06 memories never created | ✅ chat-capture writer, room-scoped; personal loses the adult bypass | P1 |

## Clusters

| Cluster | Status |
|---|---|
| A colour system | ✅ P2 (spectrum included) |
| B you at the top | ✅ static reposition (P6a) + the fold: your face starts in the line and settles into the corner, once per launch, gated on real visibility, Reduce Motion honoured (R3) |
| C ownership faces on cards | ✅ owner in face rows (Today fixed in P3 after P1's script silently missed it — see that commit) |
| D event permissions | ✅ owner-only core, per-viewer notes, request-attend / offer-drive / suggest-bring + owner panel; 13 tests. **Client-side household-feed stewardship was missing** (server allowed it, form locked it) — fixed in the re-audit. |
| E info badge | ✅ glowing ⓘ, expandable |
| F save feedback | ✅ (BUG-03) |
| G shared identity | ✅ owner colour leads; two-colour blend; owner faces |
| H calendar lens | ✅ Family/Nest/Me beside Sync, persisted |
| I notifications & inbox | ✅ push+context+tap-through server-side; inbox icon with badge on Today |
| J lock scroll regression | ✅ scrollToEnd — old scroll used parent-relative y, a no-op on tall rosters (P6b) |
| K task scope model | ✅ three rooms, follow-the-task, confirmed order, private default; **K5 assignment-by-scope was marked done and wasn't** — built in the Opus-5 re-audit (Just me/Everyone hide the picker; My Nest shows the nest minus me, pre-selected) |
| L list lifecycle | ✅ registry: empty lists persist, hold-to-delete, room-scoped, 409 dupes; 6 tests |
| M archive | ✅ 3-day sweep, completedAt stamps, legacy backlog drains, reopen un-archives; **archived tasks were reappearing as OPEN on three screens** — one shared isOpen predicate now (re-audit, 3 tests) |
| N reminders | ✅ multi-offset server + sheet + creation-card Remind row + time-sensitive push (P4c/P6c). The "Alerts" rename has NO surface yet — iOS events carry no reminder control to relabel; noted rather than invented. |
| O groceries merge | ✅ grocery items open the ONE task editor (TaskSheet) from the Groceries screen Meals links to — dates, reminders, assignee, scope, all in one place (P6h). |
| P back-nav | ✅ (BUG-04) |
| Q task colour | ✅ Coming-up + calendar-screen tasks carry member colour (overdue still coral); stale group route fixed (P6c) |
| R Ask mini-composer | ✅ real input, ?q= fires on arrival (P6b); child personal chats coerced to family server-side (P6g) |
| S Coming up = mine | ✅ — but the first pass applied it to the CALENDAR card and never touched Coming up. Un-inverted in the re-audit: Calendar = family/3 days, Coming up = mine/7 days + my tasks. |
| T "What I did" context | ✅ WHO (agent name / "You asked") + last completed step as the outcome line; publicRun carries agentName (P6e) |
| U library hue rings | ✅ category glow + tinted file icons (P6e); artifact privacy ✅ (P1) |
| V settings IA | ✅ backend URL dev-only, builders warning, tasks/meals rows removed, Appearance card gone, coming-soon greying, AI providers folded under connections, feed/status collapses, .ics file import, "Connect calendar" naming, Household-view rename (R1). Invite gating was already correct — verified, not re-done. |
| W role matrix | ✅ member-edit matrix + child limits + contacts reach + per-nest risk overrides + household-PIN gate on the switches that run things unsupervised (R2, 8 tests) |
| X nests | ✅ one-nest rule both doors; a child's invitation answered by the nest's senior adult via forActorId (child-only door, 2 tests) (P6g) |
| Y calendar connections | ✅ creator-or-Owner only, refusal names the holder |
| Z child home | ✅ two real buttons (Ask for help, read-only Family calendar); child asks UP only, Offer greyed not hidden (P6d) |
| AA agent siloing | ✅ stale copy fixed (P6c); an Adult Member choosing Family is offered nest-or-personal BEFORE the request, so the refusal never arrives as an error (R3) |

## Test deltas this arc
P1 +20 · P2 +10 (6 server, 4 mobile×2 themes) · P4b +6 · P4c +7 · P5a +8.
Suites at close: **987 server / 50 mobile, 0 failures.** Five pre-existing tests updated in
place with reasons (old reach/order semantics); none quietly flipped.
