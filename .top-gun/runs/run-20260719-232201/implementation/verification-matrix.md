# Verification Matrix — run-20260719-232201

| Check | Level | Command or method | Result | Evidence ID | Notes |
|---|---|---|---|---|---|
| Server suite baseline (pre-work) | unit/integration | `npm test` (node v25.8.2) | pass (291/291) | journal #29 | revalidation baseline |
| Mobile typecheck baseline (pre-work) | build/type | `npx tsc --noEmit` in apps/mobile | pass (exit 0) | journal #29 | revalidation baseline |
| T-101/102 red→green isolated tests | integration | `node --test server/test/help-reassign.test.mjs` | pass (5/5; 3 were red pre-impl) | help-reassign.test.mjs | ask+offer reassign, honest-false paths, dedupe |
| Full server suite post-G-SRV WP-001 | unit/integration | `npm test` | pass (296/296) | journal #31 | baseline 291 + 5 new |
| Mobile typecheck post-T-103 | build/type | `npx tsc --noEmit` (apps/mobile) | pass (exit 0) | — | after api.ts/index/grandparent/sitter/tasks/help edits |
| WP-001 two-account live regression | e2e (API) | node t105-wp001-repro.mjs vs LOCAL :8787 | pass | audit/evidence/t105-wp001-regression-transcript.txt | reassigned=true both directions; dedupe 409; cleanup done |
| Resident data integrity post-restart | data | GET events/tasks/files as owner | pass (events=41 tasks=28) | same transcript | no data loss after backend restart |
| Web help-surface render (live) | e2e (visual) | playwright smoke + pane | partial | test-failed-1.png | app boots+styled against new server; lock-path blocked: PRE-EXISTING fresh-profile→Onboarding vs spec's Lock expectation; pane origin approval unavailable non-interactive |
| Native render of new card states | visual (native) | — | blocked | — | appium/appetize creds absent — parity risk, code-traced only. ADDENDUM 2026-07-20: lane closed as a requirement by user decision (DEC-10) — native visual confirmation postponed; field-tester feedback on TestFlight builds is the native visual lane |
| WP-002 categorization unit cases | unit | `node --test apps/mobile/src/lib/spaces.test.mjs` | pass (6/6) | spaces.test.mjs | video.mp4/Friday.pdf fixed; explicit tags win |
| WP-002 tagged-upload instant listing | integration (API) | live probe vs :8787 | pass | t202-upload-probe-transcript.txt | medical-ids upload listed instantly; cleaned up |
| WP-003 allDay/date-form fixtures + passthrough | unit/integration | `node --test server/test/allday-events.test.mjs` | pass (7/7) | allday-events.test.mjs | date vs dateTime asserted; exclusive/inclusive end conversion; NO live Google (DEC-08) |
| WP-003 notes/multi-day/allDay live round-trip | e2e (API) | node t305-wp003-probes.mjs vs :8787 | pass | t305-wp003-probe-transcript.txt | notes preserved on PATCH; endAt spans days; allDay round-trips; cleanup verified |
| WP-004 description composer + lossless pull | unit (contract) | `node --test server/test/google-description.test.mjs` | pass (5/5) | google-description.test.mjs | notes+Bring composed; strip(compose)=notes; idempotent re-push; mocked fixtures only |
| WP-004 one-save consent flow | manual (code-trace) | code inspection event-form.tsx | partial | slice 11 | approval gate preserved by construction; needsApproval RUNTIME path unobserved (DEC-08) — labeled, not faked |
| T-501 residue purge + integrity | data | stop→engine filter→restart→API verify | pass | t501-hygiene-transcript.txt | 9 TG- purged, 1 real kept; events=41 tasks=28 |
| T-601 full server suite | unit/integration | `npm test` | pass (308/308) | journal #38 | baseline 291 + 17 new |
| T-601 root typecheck (web regression) | build/type | `npx tsc -p tsconfig.json` | pass (exit 0) | — | run-1 slate keeps typechecking |
| T-601 mobile typecheck | build/type | `npx tsc --noEmit` in apps/mobile | pass (exit 0) | — | whole app |
| T-601 web smoke (topgun:web scoped) | e2e (web) | `npx playwright test web/smoke.spec.ts` | fail (pre-existing) | playwright artifacts | 3/3 fail: fresh browser profile lands on Onboarding, spec expects Lock; proxy 200, app renders; bundle diff touches no web boot path (git status: src/ = run-1 slate only) — NOT reported as pass |
| T-601 stack restoration | integration | scripts/dev.mjs restart; health + Vite 200 | pass | dev-stack.log | :8787+:5173 restored to pre-session topology |
| Validators | process | validate_audit --stage implementation; validate_memory | pass (both, verbatim in report) | — | 0 warnings each |

<!-- rows appended as verification lands; blocked/partial never reported as pass -->
