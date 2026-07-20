# Implementation Queue — Work Packages (run-20260719-232201, native mobile mission)

WP numbering is this run's own (HANDOFF's TF-WP-A..F were candidates; mapping noted per WP). All work is post-selection-gate, local repo only; server changes are shared with web — every server slice includes a web regression check. Baseline health: 291/291 server tests green (run-1), mobile `tsc` clean expected before/after each slice.

## WP-001 — Help-loop integrity: accept really transfers the task (maps TF-WP-A)
- Objective: make offer→accept→reassign true end-to-end and kill duplicate cards.
- Issue/Feature IDs: ISS-001 (P1), ISS-009; FEAT-11/12; TF-008.
- Rationale: core cooperative loop silently lies (EV-NET-01); highest trust leverage.
- User outcome: accepting an ask moves the task to the helper (both lists correct, asker notified); accepting an offer moves the asker's task to the offerer; a task never accumulates duplicate pending asks; accepted cards resolve when the task completes or is dismissed.
- Architecture outcome: respond handler becomes the transactional owner of the reassignment (status + task PATCH + notify + audit in one path).
- Personas/journeys: Beannie (JRN-2), Ross (JRN-4), Priya (JRN-3).
- Affected: server/index.mjs (help respond + create dedupe), server/test/*, apps/mobile (home)/grandparent.tsx, index.tsx, sitter.tsx, (settings)/tasks.tsx (helping indicator), web help surfaces (render check only unless shared component edits are needed).
- Slices: (1) server: accept-with-taskId reassigns + audits; red/green server test. (2) server: create-dedupe (409/merge on same taskId+toActorId pending) + test. (3) clients: accepted-card lifecycle (hide on task done; dismiss affordance); duplicate-render guard. (4) two-account API repro rerun as regression evidence.
- Design/content: keep the calm card language; add "(task moved to you)" microcopy on accept.
- State/API implications: helpRequest gains nothing; task.assignedMemberId changes on accept; audit events help.respond carries reassigned:true.
- A11y/responsive/security/perf: card buttons keep ≥44 pt targets; reassignment respects role gates (recipient-only respond already enforced); no new endpoints.
- Dependencies: none. Sequence: first.
- Acceptance criteria: see ISS-001 row (observable, testable); server tests cover ask+offer directions and dedupe; helper's /tasks contains the task post-accept.
- Validation: server unit/integration tests; two-account local API repro; web + mobile type checks.
- Risk: low-medium (shared server path; behavior change visible on web) — mitigated by tests + web render check. Rollback: revert respond handler commit; records remain valid.

## WP-002 — Upload save-confidence: persistent confirmation + honest categorization (maps TF-WP-B)
- Objective: no upload ever *feels* unsaved.
- Issue/Feature IDs: ISS-002 (P2, refuted-P1); FEAT-16/17; TF-012.
- Rationale: persistence is proven solid — the perception layer loses the user (EV-NET-01, EV-CODE-05).
- User outcome: after upload, a persistent confirmation names the destination category with tap-through; default-space uploads are filed predictably; no misleading "Processing" badge; no regex mis-filing.
- Affected: apps/mobile upload-sheet.tsx, (library)/index.tsx (spaceOf/badgeFor), optionally server default-tagging (prefer client-only).
- Slices: (1) success state: replace 800 ms flash with a persistent in-library confirmation banner "Saved to <category> · View"; (2) categorization: default space resolves to an explicit choice (or "Filed under Home" disclosure) + fix `/id/` word-boundary regex; (3) badge: drop or rename time-based "Processing".
- Acceptance criteria: upload → banner persists until dismissed and names the real rendered category; unit cases prove `video.mp4`/`Friday.pdf` no longer match Medical & IDs; a Medical & IDs-tagged upload appears there instantly.
- Validation: component logic tests where cheap; API repro rerun; manual web-parity glance.
- Risk: low. Rollback: revert client commits. Sequence: second (fast trust win).

## WP-003 — Event editor completeness: end date, all-day, notes (maps TF-WP-C)
- Objective: one coherent editor/model pass (DEC-03).
- Issue/Feature IDs: ISS-004, ISS-005, ISS-006 (all P2); FEAT-07/08; TF-001/006/007.
- Rationale: server already stores multi-day + notes (EV-NET-02); the editor is the bottleneck; all-day needs a real model concept.
- User outcome: multi-day events (end date), all-day toggle (no fake times), and a Notes field on mobile create/edit.
- Architecture outcome: `allDay` becomes an explicit event concept honored by store, both clients' renderers, and the Google payload builder (`date` vs `dateTime`).
- Affected: event-form.tsx (form state: end DAY picker when hasEnd; All-day switch suppressing time pickers; Notes multiline), calendar.tsx + grandparent/kid/sitter/today renderers (multi-day + all-day display), server/index.mjs events (allDay passthrough), server/calendar.mjs (all-day push form), web render check.
- Slices: (1) Notes field (smallest; unblocks WP-004) — form + save body; (2) end-date support — replace stamp(day,end) with endDay; validation end>start cross-day; calendar multi-day render; (3) allDay flag — model + toggle + renderers + push `date` form + server test.
- Design: stays inside existing Well/SectionHeader/PickerField patterns; iOS keeps native compact pickers.
- Acceptance criteria: per ISS-004/005/006 rows; probes from EV-NET-02 rerun as regression; date-only footgun (P4 probe) resolved by allDay semantics.
- Validation: API probes, payload unit test, web + mobile tsc, web visual check.
- Risk: medium (renderers on several screens). Rollback: per-slice revert. Sequence: third.

## WP-004 — Google sync fidelity + save UX (maps TF-WP-D)
- Objective: nothing the family wrote is dropped on the way to Google; one coherent save action.
- Issue/Feature IDs: ISS-003 (P2), ISS-008 (P3); FEAT-08/09; TF-003/004.
- Rationale: EV-CODE-04 — payload builder is the single choke point (DEC-04); approval gate preserved (DEC-06).
- User outcome: Google event description carries Notes + "Bring: …"; editing a pushed event needs one primary action with a single remembered consent.
- Affected: server/calendar.mjs (pushEventToGoogle + editLinkedGoogleEvent description composer + pull-merge delimiter), server tests; event-form.tsx action row.
- Slices: (1) description composer + lossless pull convention + unit tests (mock fetch — no live Google); (2) form action merge per DEC-06.
- Acceptance criteria: payload fixture shows notes+bring in description; pull does not duplicate the Bring block into notes; UI shows one primary Save with inline Google consent; no silent external write (approval/audit unchanged).
- Validation: server unit tests with mocked Google fetch; approval-flow test; NO live Google calls in this mission.
- Risk: low-medium (sync semantics); depends on WP-003 slice 1 (notes) for full value. Sequence: fourth.

## WP-005 — Task tap-to-edit (maps TF-WP-F)
- Objective: saved tasks are editable on mobile.
- Issue/Feature IDs: ISS-011 (P2); FEAT-13/14; TF-002.
- Affected: (settings)/tasks.tsx + a new task-edit sheet (design-system components); server untouched (PATCH exists).
- Slices: (1) tap → edit sheet (title/due/assignee/priority/list) with stale_write 409 handling; (2) long-press menu keeps fast actions.
- Acceptance: tap opens editor; saved patch renders; 409 shows the friendly refresh message; checkbox behavior unchanged.
- Validation: API-backed check + tsc. Risk: low. Sequence: fifth.

## WP-006 — Location intelligence: suggestions + directions (maps TF-WP-E)
- Objective: real places, one-tap directions (DEC-05: OS geocoder, no new keys).
- Issue/Feature IDs: ISS-007 (P2); FEAT-07; TF-005.
- Affected: event-form.tsx, new lib/places.ts (debounced geocodeAsync), event model optional {lat,lng}, event detail/calendar Directions affordance (maps: / https://maps.apple.com URL).
- Acceptance: typing ≥3 chars shows suggestions; pick stores display text (+coords); Directions opens the platform map; free text still allowed; permission denial degrades silently (matches lib/location.ts posture).
- Validation: unit on util; manual check. Risk: low-medium (geocoder quality — reversal condition in DEC-05). Sequence: sixth.

## WP-007 — Help-accept parameters (maps TF-WP-A follow-on)
- Objective: "I can help, but only after 3pm" (ISS-010, P3); server responseNote already exists — accept gains optional note UI shown to the asker.
- Affected: grandparent.tsx/index.tsx accept flow + asker-side display. Depends on WP-001. Sequence: seventh.

## WP-008 — Native automation readiness: testIDs (found during preflight)
- Objective: instrument high-traffic elements per audit/element-map.md (ISS-013, P3) so the blocked native lanes become automatable the day drivers unblock.
- Affected: mechanical testID additions app-wide; zero behavior change. Sequence: any idle slot.

## Recommended sequence
WP-001 → WP-002 → WP-003 → WP-004 → WP-005 → WP-006 → WP-007 → WP-008 (bugs/trust first; editor pass unblocks sync fidelity; features after).
