# Implementation Lead — Phase Delta (run-20260719-073933)

- Agent: implementation-lead (fable, S6–S7)
- Selection: DEC-007 option 6 — full slate WP-001..WP-005
- Date: 2026-07-19 (UTC)

## Outcomes per WP

- **WP-001 (ISS-001/008) — DELIVERED.** store.mjs NODE_TEST_CONTEXT guard; harness test-process HOMEOPS_DATA_DIR pin; engine-hardening stall test bound to ctx.dataDir; web-tools.test.mjs (newly-found 2nd offender) isolated; ci.yml `data-isolation` job (T-12) added and locally simulated. `npm test` is now safe beside a live backend: 291/291, `.data` byte-identical, health 200.
- **WP-002 (ISS-002/003/003b) — DELIVERED.** Global amber role=status degraded banner (mobile + desktop); explicit unreachable states; local (client-only) sessions for sample/local households; Lock merges + labels local households; claimed-server Create-household routes to email signup; PIN/subtitle copy fixed. Three integration fixes were needed beyond G2's code (reseed session race, member_archived fallback, loadBackend undefined clobber) — all runtime-verified.
- **WP-003 (ISS-004/005) — DELIVERED.** No-provider chat routes to the local rules engine (approvable plan card, provenance labels, scoped nudge); chat error handling now preserves machine codes (fix). detectTrigger() applied in the creation path; "Every morning at 7am…" previews and stores trigger=Schedule.
- **WP-004 (ISS-006) — DELIVERED.** weather.current mirrors sibling provider_error pattern with upstream code/detail audit logging; 4-case deterministic test; real Open-Meteo valid + forced-bad runs; coral error visible in the Connections drawer.
- **WP-005 (ISS-007/009/010) — DELIVERED** (one declared gap). render.yaml NODE_VERSION=24 pin inside engines, README fixed (boot smoke on Node 24 blocked locally — no in-range Node; deferred to CI). /api/profiles pre-auth payload trimmed (no relationship/child-age PII; client type mirror updated). react-router-dom removed; build green; bundle router-free.

## Hypothesis resolutions (via delta — canonical queue stays with orchestrator)

- **HYP-003 → resolved (observed, partial):** the code gap is closed and upstream status/body now land in the audit log; forced-bad runs prove the path (HTTP 400 + reason). The exact upstream response during the audit run remains retroactively unknowable — future occurrences will be logged.
- **HYP-004 → resolved (observed):** pre-auth exposure PERSISTED post-claim (live curl: Ross roster with relationship before fix). Fixed by the payload trim.
- **HYP-005 → resolved (observed):** wiring gap confirmed; stored automation now carries trigger=Schedule (record inspected in IndexedDB).
- **HYP-001 → still open.** The unclaimed-server (fresh HOMEOPS_DATA_DIR) run was not executed: WP acceptance criteria were verifiable without it, and T-10/T-11 were authorized only as verification enablers. The claimed-server dead-ends are now fixed regardless; HYP-001's remaining value is role-gating persona journeys (JRN-2..5), which stay deferred.
- **HYP-006 → untouched** (production parity; no probe authorized).

## New findings for the registers (orchestrator to integrate)

1. web-tools.test.mjs transitively imported store.mjs bare (via web.mjs getSecret) — second ISS-001-class offender; fixed in-slice.
2. reseed-while-authenticated race: server-authoritative hydrate clobbers a freshly-seeded local roster; fixed by severing the session first (useStore.reseed).
3. Claimed servers answer `member_archived` (not `unknown_actor`) for demo-roster actors — any local-session fallback keyed only on unknown_actor dead-ends; fixed.
4. Assistant chat stored prose in m.error, so error-code-keyed UI branches could never fire; fixed (codes preserved).
5. loadBackend clobbered connectors/providers/accounts with undefined on unauth responses → white-screen crash in Workflow Builder under local sessions; fixed defensively.
6. User's tests/topgun web lane: 7/12 failing on a fresh browser context because it expects boot→Lock while fresh no-data boot shows Onboarding (pre-slate behavior per audit SS-000; init branch untouched). Pre-existing; needs the user's decision (adjust specs or add a storage-state setup step).
7. Residual polish candidates: one-shot 401 console burst in local sessions (honest banner shown; not a loop); Settings profile line says "local-only — backend offline" even when the backend is up but foreign (copy nit); local sessions do not survive reload (drops to the merged Lock — usable, not a dead-end).
8. One real OpenAI chat call was consumed during provider-path verification (user's saved key, Ross household); no further provider calls were made once discovered. The Ross household has an Active OpenAI provider (model "gpt-5.5") — user drift since the audit; ISS-004's "no provider" context now lives in sample/local households.

## Files changed (worktree only, no git mutations)

server/store.mjs; server/test/harness.mjs; server/test/engine-hardening.test.mjs; server/test/web-tools.test.mjs; server/test/weather-honesty.test.mjs (new); server/connectors.mjs; server/index.mjs; .github/workflows/ci.yml; render.yaml; README.md; package.json + package-lock.json (react-router-dom removal only — topgun scripts/devDeps intact); src/store/useStore.ts; src/components/Shell.tsx; src/screens/Onboarding.tsx; src/screens/Lock.tsx; src/screens/Dashboard.tsx; src/screens/Assistant.tsx; src/lib/ai.ts; src/screens/Automations.tsx; src/connectors/api.ts (type mirror).

## Environment notes

- Backend restarted twice (journaled #47, #49) and stopped once for the backend-down check (journaled #48); healthy (200) at return. Vite :5173 and :9223 untouched. Weather connector config restored to defaults after the forced-bad test. `.claude/launch.json`, apps/mobile, phase-state.md, handoffs untouched.
