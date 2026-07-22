# PAUSE-STATE — refreshed 2026-07-22 by implementation-lead-2 (mission finale COMPLETE)

## Committed local state (NOT pushed — orchestrator owns push; base origin/main @ 4d89f8d)

Waves 1-6 remain as banked (WP-001..012 shipped, pushed @ 4d89f8d, Render live, TestFlight build 24 submitted).

Finale commits on top (local only, in order):
1. 9a499f8 — fix(engine): connector-park TTL clock = park moment (blocked step startedAt), legacy+flag expires immediately; 2 regression tests. Flagged re-sweep EXECUTED: 9/9 resident legacy parks expired (run_d0f11e1f, run_a4ef73a6, run_6b7e2c33 + 6 June runs), 9 audited events + 9 Inbox notices.
2. 29f6c63 — 22-UC benchmark harness (usecases.config, uc.ts, sandbox-only GET /api/sandbox/effects, npm run topgun:usecases) + pilots UC-1/UC-20.
3. dbc077d — unattended tz-anchored scheduler soak spec (WP-006 s7).
4. 368514d — fix(orchestrator): agt_household self-created for non-resident households (WP-002 gap found by the benchmark: new families had NO chat attribution → notify_contact refused every chat ask).
5. c384a3d — WP-002 chat-delivery E2E (honest in_app fallback → real Inbox row) + pilot screenshots.
6. 1c7401b — 14 wave-A UC specs (UC-2..7, 11, 15..19, 21, 22).
7. 7180c65 — final 6 wave-B UC specs (UC-8/9/10/12/13/14).
8. (close-out commit) — .top-gun run docs + helpers.ts signup 429 backoff.

## Final verification (all verbatim in implementation/verification-matrix.md)

- topgun:usecases: 23 passed ×3 consecutive (2.8m/3.3m/2.3m) — 22 UCs + unattended scheduler; per-UC latency at implementation/evidence/uc-suite-latency.md.
- topgun:web: 29 passed / 6 skipped (by-design skips). npm test: 549/548 pass/1 honest skip. typecheck: exit 0.
- Render: serves the 4d89f8d bundle (6/6 entry asset hashes byte-identical to local build; health shows sqlite-fts5).
- 22-UC verdicts: 9 pass(real) — 3 of them hermetic-bound (net.mjs SSRF guard has no dev/test seam); 11 pass(sandbox + named user-owned blocker); 2 pass(honest-park + blocker, providers unsandboxed by design).

## User-owned gates (unchanged, listed in Connections checklists)

LM Studio API token (WP-007 s1 acceptance + HYP-005 probe); Google/MS/Slack/Dropbox OAuth apps; Twilio credentials + explicit go-ahead for a real SMS (UC-14); real-credential UC smokes after provisioning.

## Product findings for the user's backlog (logged, deliberately not fixed)

1. UC-16 spec mismatch: PRD names files-local `file.import`, which is runtime:"client" — fails closed for EVERY agentic plan in any environment.
2. No drive/onedrive WRITE tool exists in providers.mjs — UC-7 "cloud sync" cannot exceed read-both-stores.
3. net.mjs SSRF guard has no dev/test seam (connectors.mjs:459-462/355-356, web.mjs:290) — live http/browser/web-read round-trips are unreachable hermetically; real-bridge smokes need a user-allowlisted endpoint.

## How to resume

Mission scope is COMPLETE pending orchestrator push. Dev stack: node scripts/dev.mjs (+ HOMEOPS_CONNECTOR_SANDBOX=1 for gated-lane specs; NEVER set HOMEOPS_SWEEP_LEGACY_PARKED again — the one-shot sweep is done). Resident tenant untouched except the DEC-020 sweep; run_10407a1f (new park, resident's own trigger) expires under the normal 7-day TTL.
