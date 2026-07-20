# Implementation Lead Delta — run-20260719-232201

- Agent: implementation-lead · Date: 2026-07-20 (UTC)
- Scope delivered: ★ bundle WP-001..004 + T-501 hygiene + T-601 verification — ALL SHIP (13 slices, slice-log.md)
- Deployment status: LOCAL WORKTREE ONLY. No commits, no pushes, no deploys, no Google/API/external calls (DEC-08 honored — all Google fidelity proven at mocked/pure fixture level).

## Files changed (bundle diff; run-1 slate + user harness preserved untouched)

Server (G-SRV): `server/index.mjs` (help respond reassign + create dedupe + events allDay passthrough), `server/calendar.mjs` (composeGoogleDescription/stripFamiliosBlock, googleEventTimes, pull normalization).
Mobile (G-MOB): `apps/mobile/src/lib/api.ts` (respond contract {reassigned,task}; EventRec.allDay), `(home)/index.tsx`, `(home)/grandparent.tsx`, `(home)/sitter.tsx`, `(home)/kid.tsx`, `(home)/help.tsx` (409 surfaced honestly), `(home)/calendar.tsx` (spanKeys multi-day), `(home)/event-form.tsx` (notes, endDay, all-day, one-save consent), `(library)/index.tsx` (banner + honest badges), `(settings)/tasks.tsx` (helping chip), `components/sheets/upload-sheet.tsx`.
New: `server/test/help-reassign.test.mjs` (5), `server/test/allday-events.test.mjs` (7), `server/test/google-description.test.mjs` (5), `apps/mobile/src/lib/spaces.ts` + `spaces.test.mjs` (6), `apps/mobile/src/lib/event-days.ts`.

## Scope notes (documented deviations, all minimal-coherent)

1. `apps/mobile/src/lib/spaces.ts` + `spaces.test.mjs` + `event-days.ts` extend the named-file list: pure-logic extraction was REQUIRED to run the mandated unit cases (RN imports can't execute under node) and to share day-span logic across five renderers without drift.
2. `(home)/help.tsx` (one 4-line guard): the new server 409 carries the existing record alongside `error`; without the guard the client would present "already asked" as a successful send — smallest coherent cross-layer correction for the server contract change.
3. T-501: the guide's `server/data/help-requests.json` path was stale — store is the tenant SQLite doc engine (`server/tenant-db.mjs`); purge used `getDoc/putDoc` on tenant `local` inside a stop→edit→restart window. 9 TG- records purged, 1 real kept.
4. Matching-guide drift confirmed at dispatch: node on PATH resolves v25.8.2 (facts value), not v20.20.2.

## Decisions recorded

- allDay representation: boolean flag + local-midnight ISO stamps (Path B) over date-only strings (Path A rejected: `new Date("YYYY-MM-DD")` UTC-parse shifts the day in every existing renderer on both clients). Google push converts to exclusive `date` form; pull converts back inclusive.
- Description round-trip: delimiter line `— FamiliOS —`; content inside the block is FamiliOS-owned (Google-side edits to the Bring block intentionally not merged back — whatToBring stays structured).
- Accepted-card dismissal is a device-local reading preference (SecureStore) — no new endpoints (WP constraint).

## Native-parity risks (blocked, labeled — never faked)

- All mobile UI changes (cards, banner, editor, consent row) are code-traced + tsc-verified only; no device/simulator drivers (BROWSERSTACK_*/APPETIZE_* absent). Field-tester visual check needed on the next authorized TestFlight build.
- The `needsApproval` live Google push path remains unobserved at runtime (DEC-08 veto); approval-gate preservation is by construction + server approval tests.
- Web client renders allDay events with a midnight time label (web is out of scope; server change is additive) — cosmetic cross-client parity note for a future web touch.
- Pre-existing (NOT bundle-caused): `topgun:web` smoke expects the Lock screen on a fresh browser profile but the app shows Onboarding — 3/3 smoke tests fail on any fresh profile against a claimed backend. Harness or boot-flow fix is a follow-up candidate.

## Verification summary

Server suite 308/308 (291 baseline + 17 new) · root tsc exit 0 · apps/mobile tsc exit 0 · spaces unit 6/6 · live API regressions: WP-001 two-account (t105), WP-002 upload probe (t202), WP-003 round-trip (t305), T-501 integrity — transcripts under audit/evidence/ · validate_audit(implementation) OK 0 warnings · validate_memory OK 0 warnings. Web smoke: fail (pre-existing, evidenced). Blocked/partial rows reported as such, never as pass.

## Runtime stewardship

Backend :8787 restarted 4× (journaled #29/#32/#37 + final), resident data integrity re-verified each time (final: events=41, tasks=28, help-requests=1 real). Vite :5173 died as a casualty of the playwright webServer port conflict mid-verification; full stack restored to pre-session topology via `scripts/dev.mjs` (both ports verified up at return).
