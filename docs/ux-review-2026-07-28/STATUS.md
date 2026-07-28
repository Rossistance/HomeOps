# Implementation status — 7-27 walkthrough set #2

Statuses written per item as each landed, **never in bulk** — the last inventory's ✅ column
was filled by find-and-replace and lied twice (see docs/ux-review-2026-07-27/INVENTORY.md,
"Correction"). ✅ means committed with tests where the behaviour is testable; ◐ means partially
landed with the remainder named; ⬜ means not started. Builds: 59–61 carry this work.

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
| B you at the top | ◐ static reposition on Today + Settings shipped; the **fold-up animation** he described is not built |
| C ownership faces on cards | ✅ owner in face rows (Today fixed in P3 after P1's script silently missed it — see that commit) |
| D event permissions | ✅ owner-only core, per-viewer notes, request-attend / offer-drive / suggest-bring + owner panel; household-feed mirrors stay adult-appendable (Q2 preserved); 13 tests |
| E info badge | ✅ glowing ⓘ, expandable |
| F save feedback | ✅ (BUG-03) |
| G shared identity | ✅ owner colour leads; two-colour blend; owner faces |
| H calendar lens | ✅ Family/Nest/Me beside Sync, persisted |
| I notifications & inbox | ✅ push+context+tap-through server-side; inbox icon with badge on Today |
| J lock scroll regression | ✅ scrollToEnd (old scroll used parent-relative y — a no-op on tall rosters) |
| K task scope model | ✅ three rooms, follow-the-task, confirmed order, private default |
| L list lifecycle | ✅ registry: empty lists persist, hold-to-delete, room-scoped, 409 dupes; 6 tests |
| M archive | ✅ 3-day sweep, completedAt stamps, legacy backlog drains, reopen un-archives |
| N reminders | ◐ multi-offset server + sheet multi-select + time-sensitive push shipped; **Remind row at creation** and the calendar-side "Alerts" rename remain |
| O groceries merge | ⬜ |
| P back-nav | ✅ (BUG-04) |
| Q task colour | ◐ Coming-up tasks carry member colour + route home; the **calendar screen's** task rows not yet re-tinted |
| R Ask mini-composer | ✅ real input; ?q= fires on arrival (one send, not two); child space-clamping not yet server-enforced |
| S Coming up = mine | ✅ owned-or-on, 7 days, + my dated tasks |
| T "What I did" context | ⬜ |
| U library hue rings | ⬜ (artifact privacy itself ✅) |
| V settings IA | ◐ backend URL dev-only, builders warning, tasks/meals rows removed; **connections consolidation, coming-soon greying, AI-providers move, icons, collapses, ICS file import, connect-calendar naming, Appearance card removal, dark-mode top toggle, Manage-Household minimisation, invite gating** remain |
| W role matrix | ◐ member-edit matrix + child colour/emoji-only shipped (8 tests); **per-nest approval tools, advanced-mode PIN, contacts scoping** remain |
| X nests | ◐ one-nest rule both doors shipped; **child-invite routing to the nest's senior adult** remains |
| Y calendar connections | ✅ creator-or-Owner only, refusal names the holder |
| Z child home | ⬜ |
| AA agent siloing | ◐ silo enforcement pre-existed; **stale "only an Owner/Adult Admin" copy and the family-space transfer prompt** remain |

## Test deltas this arc
P1 +20 · P2 +10 (6 server, 4 mobile×2 themes) · P4b +6 · P4c +7 · P5a +8.
Suites at close: **977 server / 47 mobile, 0 failures.** Five pre-existing tests updated in
place with reasons (old reach/order semantics); none quietly flipped.
