# Implementation Queue — Work Packages

Populated by audit-lead, run-20260719-073933. Each WP is a thin, orchestrator-ready vertical slice. Acceptance criteria are observable/testable.

## WP-001 — Stop the test suite from corrupting live data (P0 containment)

- Objective: Make `npm test` incapable of touching the real `server/.data`, so running tests never bricks a live backend or writes fixtures into a family's data.
- Issue/Feature IDs: ISS-001, ISS-008; FEAT-166.
- Rationale: `server/test/engine-hardening.test.mjs` imports `../store.mjs` + `../engine.mjs` into the test-runner process (where HOMEOPS_DATA_DIR is unset), so the store resolves the default live dir; a stall-test fixture + `expireStaleRuns()` then run against the live tenant DB, staling the running server's node:sqlite handle → permanent `disk I/O error` 500s (EV-116/117/118). CI can't see it (ISS-008/EV-143).
- User and architecture outcomes: Developers/operators can run tests beside a live server with zero data risk; the data-integrity guarantee the product sells becomes true for its own tooling.
- Affected files/modules/services/data: `server/test/harness.mjs`, `server/test/engine-hardening.test.mjs`, `server/store.mjs`, `.github/workflows/ci.yml`.
- Implementation steps (thin vertical slices):
  1. In `store.mjs`, refuse to open the default `.data` when `process.env.NODE_TEST_CONTEXT` (set by `node --test`) is present and `HOMEOPS_DATA_DIR` is unset — throw a loud error naming the fix.
  2. Rewrite `engine-hardening.test.mjs` to seed/exercise through the spawned server's API (harness `ctx`) or a store handle explicitly bound to `ctx.dataDir`, never a bare module import.
  3. Set `HOMEOPS_DATA_DIR` for the test PROCESS in the harness (not only the child), as belt-and-suspenders.
  4. (Optional) Add a CI job that boots the server then runs the suite, asserting `.data` is byte-identical afterward.
- Design/content direction: n/a (backend/test).
- State/API/data/job/migration implications: no schema change; behavior-only.
- Accessibility/responsive/security/performance: n/a; reduces data-integrity risk.
- Dependencies: none.
- Acceptance criteria: With the dev backend running, `npm test` passes AND `server/.data` hash is unchanged before/after AND `/api/health` stays 200; the stall test still proves the sweeper fails a 45-min-stale run.
- Focused validation: hash `.data` pre/post; health poll; keep the sweeper assertion green.
- Risk: Low. Test-only + a guard in store.mjs.
- Rollout/rollback: Pure repo change; revert the commit to roll back.
- Recommended sequence: FIRST — it protects every subsequent step and any developer.

## WP-002 — Honest degraded-mode + fix the claimed-server onboarding/sample dead-ends (P1 trust)

- Objective: Never present a hollow-healthy UI when the backend is unreachable, and make "Create household", "Explore the sample", and "Reset sample data" land in a working state on a claimed server.
- Issue/Feature IDs: ISS-002, ISS-003, ISS-003b; FEAT-001..005, FEAT-016, FEAT-146, FEAT-003.
- Rationale: On first run against a failing backend, 25+ failed fetches produced zero user-visible error and a misleading "may need PIN" (EV-119/120/121). On a claimed server, the local-claim and sample paths orphan the household and dead-end at a stranger's Lock (EV-123/124/138). Both violate PI-005 ("no fake success states") at first contact.
- User and architecture outcomes: A new user always knows whether the runtime is reachable; sample/local mode works without a server actor; no household is ever silently stranded in IndexedDB.
- Affected files/modules/services/data: `src/store/useStore.ts` (init, bootstrapSession, completeOnboarding, reseed, loginAs), `src/screens/Onboarding.tsx`, `src/screens/Lock.tsx`, `src/components/Shell.tsx` (surface RuntimePill/degraded banner on mobile), `src/screens/Dashboard.tsx`.
- Implementation steps (thin vertical slices):
  1. Add a global degraded-mode banner (reuse `StorageBanner` pattern) driven by health/session/claim failures; show it in the mobile shell, not only the desktop sidebar pill.
  2. Treat sample + local households as client-only sessions: mint a local session for "sample"/"create" mode so `loginAs` never needs a server actor; only require the server for connector/approval features (which already degrade honestly).
  3. In Lock, merge and label local-only households ("On this device — not registered with this server") instead of hiding them behind the server roster.
  4. Fix the "may need PIN" copy and the truncated subtitle fragment ("choose a profile…").
  5. On onboarding, read `/api/profiles` `claimed` and route "Create household" to email-signup when the server is already claimed.
- Design/content direction: Use existing status vocabulary (amber = attention) for the degraded banner; sentence-case, direction-not-mood copy per DESIGN_SYSTEM voice.
- State/API/data/job/migration implications: introduces a "local session" concept in the store; no server schema change; optionally expose `claimed` more prominently (already returned).
- Accessibility/responsive/security: banner must be announced (role=status), visible focus preserved; do not leak more roster PII (coordinate with WP-005).
- Dependencies: none (independent of WP-001).
- Acceptance criteria: (a) With backend down, fresh onboarding shows an explicit unreachable state at each failing step and the dashboard shows a degraded banner (no silent 401 loop). (b) "Reset sample data" on a claimed server lands in the working Harper dashboard. (c) A locally-created household is never hidden by the server roster.
- Focused validation: emulator run with backend stopped; emulator reseed on a claimed server; assert Harper dashboard + no orphan.
- Risk: Medium — touches auth/session flow; guard with the existing typed-error paths.
- Rollout/rollback: Feature-flag the local-session behavior if desired; revert commit to roll back.
- Recommended sequence: SECOND — highest user-visible trust impact.

## WP-003 — Give "Ask FamiliOS" a local fallback + fix rules-engine trigger detection (P1 headline)

- Objective: Make the product's headline surface useful with no AI provider, consistent with the Workflow Builder's "built-in rules engine", and make built automations honor schedule phrasing.
- Issue/Feature IDs: ISS-004, ISS-005; FEAT-020, FEAT-021, FEAT-042.
- Rationale: The Assistant chip "Plan three dinners…" dead-ends with "No AI provider is connected" (EV-130), yet the same class of request builds a real automation via the deterministic engine (EV-131) — and README promises "every task resolves locally". Separately, the rules engine set trigger "Manual" for "Every morning at 7am" (EV-132) despite `detectTrigger()` mapping it to Schedule (EV-133).
- User and architecture outcomes: A no-provider user gets a real, approvable plan or a scoped "needs a provider for X" message — never a blanket wall; scheduled routines actually fire.
- Affected files/modules/services/data: `src/screens/Assistant.tsx`, `src/lib/ai.ts`, `src/screens/Automations.tsx`, `src/screens/AIProviders.tsx`.
- Implementation steps: (1) Route planning/capability chat through `lib/ai.ts` when no provider is configured; reserve the provider prompt for genuinely provider-only tasks. (2) Align suggestion chips to local-engine capability. (3) Apply `detectTrigger()` in the rules-engine automation-creation path and show the resolved trigger in the plan preview.
- Design/content direction: Keep the existing "FamiliOS proposes; you approve" reassurance; label local vs provider-backed answers.
- State/API/data/job/migration: no schema change; automation trigger now derived, not defaulted.
- Accessibility/responsive/security: preserve approval gating for any external step surfaced by the plan.
- Dependencies: none.
- Acceptance criteria: (a) With no provider, a planning chat returns a local plan or a scoped provider prompt (never a bare dead-end). (b) Building "every morning at 7am…" via the rules engine yields a Schedule trigger visible in the preview.
- Focused validation: no-provider emulator chat; rebuild automation and assert trigger=Schedule.
- Risk: Low-Medium.
- Rollout/rollback: revert commit.
- Recommended sequence: THIRD.

## WP-004 — Make the flagship Weather connector fail honestly (P2 promise-integrity)

- Objective: The out-of-box "live" Weather tool must never render a hollow success; on any upstream problem it returns a visible `provider_error`.
- Issue/Feature IDs: ISS-006; FEAT-062.
- Rationale: `weather.current` lacks the `r.ok`/`provider_error` path its RSS/HTTP siblings have (EV-136); undefined fields are dropped by JSON so a broken upstream renders as `{location,fetchedAt}` success (EV-134) — the exact "fake success" the product forbids.
- Affected files/modules/services/data: `server/connectors.mjs` (weather.current executor ~L397-402); tool-result rendering in Connections drawer for the error branch.
- Implementation steps: check `r.ok`; validate `j?.current` exists; return `{ok:false,error:"provider_error",message}` otherwise; surface it in the tool-result panel like RSS does.
- State/API/data/job/migration: none.
- Accessibility/responsive/security: error text must be readable (status color = coral/amber per vocabulary).
- Dependencies: none.
- Acceptance criteria: With a forced bad lat/lon or upstream error, the Weather tool shows a provider_error (not a hollow object); with valid upstream it shows temperature/conditions.
- Focused validation: unit/integration on the executor + one emulator run.
- Risk: Low.
- Rollout/rollback: revert commit.
- Recommended sequence: FOURTH.

## WP-005 — Deploy-safety + privacy hardening + code-debt cleanup (P2/P3 hygiene)

- Objective: Remove the Node-version deploy risk, minimize the pre-auth roster exposure, and drop dead dependencies.
- Issue/Feature IDs: ISS-007, ISS-009, ISS-010; FEAT-166, FEAT-160.
- Rationale: render.yaml pins no Node while CI uses 24, engines excludes 25, dev runs 25.8.2 (EV-106/143) — production could boot on an untested Node and break node:sqlite. `/api/profiles` leaks names/roles/relationships (incl. child ages, caregiver role) pre-auth (EV-125). `react-router-dom` is an unused prod dependency (EV-102).
- Affected files/modules/services/data: `render.yaml`, `package.json` (engines), `README.md`, `.github/workflows/ci.yml`, `server/index.mjs` (/api/profiles), `package.json` (deps).
- Implementation steps: (1) Pin `NODE_VERSION` in render.yaml within a reconciled engines range; align CI + README. (2) Gate or minimize the pre-auth roster payload (drop relationship/age hints; consider a device-pairing token). (3) Remove `react-router-dom` or adopt it intentionally for real URL routing.
- State/API/data/job/migration: none (config + a payload trim).
- Accessibility/responsive/security: net privacy improvement.
- Dependencies: none; the roster change should coordinate with WP-002's Lock rework.
- Acceptance criteria: render.yaml pins an in-range Node that CI also uses and a boot smoke test passes; pre-auth `/api/profiles` on a claimed public deployment returns no child-age/relationship PII; bundle no longer ships react-router-dom.
- Focused validation: deploy dry-run/boot check; curl the pre-auth endpoint; build + bundle inspect.
- Risk: Low.
- Rollout/rollback: config revert.
- Recommended sequence: FIFTH (can parallelize with WP-004).
