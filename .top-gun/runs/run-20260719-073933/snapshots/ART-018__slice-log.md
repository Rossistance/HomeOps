# Implementation Slice Log — run-20260719-073933

Author: implementation-lead. One block per slice; five-point verdict per convergent-360 S6.

## Slice 1 — T-01 Test isolation (WP-001)

- Scope: WP-001; ISS-001, ISS-008; FEAT-166
- Expected: `npm test` incapable of touching live `server/.data`; guard in store.mjs refuses default dir under NODE_TEST_CONTEXT; harness pins test-process HOMEOPS_DATA_DIR; stall test seeds via ctx.dataDir-bound store, never a bare import.
- Evidence:
  - Red/green guard proof: `NODE_TEST_CONTEXT=1 node -e "import('./server/store.mjs')"` → "GUARD THREW OK: server/store.mjs: refusing to open the default server/.data from a test process…" (guard fires); NODE_TEST_CONTEXT confirmed `child-v8` under `node --test` (v25.8.2).
  - Guard caught a SECOND latent offender beyond the audited one: `web-tools.test.mjs` → `web.mjs` → `store.mjs` bare import (file-level failure with the guard message). Fixed with the sibling env-then-dynamic-import pattern.
  - Full suite beside the LIVE backend: 287/287 pass (node v25.8.2), duration ~11.4s.
  - `server/.data` recursive sha256 manifest hash pre == post: `8fc10892a5b0b280ac7e49b5…` (byte-identical).
  - `/api/health` 200 `ok:true` before, during-window, and after.
  - Stall assertion explicit: `node --test server/test/engine-hardening.test.mjs` → 2/2 pass incl. "a run silent for 30+ minutes is swept to failed('stalled')".
- Regressions checked: full 287-test suite green (baseline was 287; earlier 281 count was the web-tools file crashing at load under the new guard — now restored and green).
- Responsive/platform: not-applicable (backend/test-only slice).
- Integrations: live backend :8787 unaffected (health 200, data byte-identical); Vite :5173 and :9223 untouched.
- Verdict: **ship**

## Slice 2 — T-06 Weather executor honesty (WP-004)

- Scope: WP-004; ISS-006; FEAT-062; HYP-003
- Expected: weather.current mirrors RSS/HTTP siblings — `r.ok` check, JSON-parse guard, `j.current` validation — returning `{ok:false,error:"provider_error",message}` with upstream status/detail in the audit log; never a hollow `{location,fetchedAt}` success.
- Evidence:
  - New focused test `server/test/weather-honesty.test.mjs` (stubbed upstream): 4/4 pass — HTTP 400 → provider_error; non-JSON 200 → provider_error; 200-with-no-`current` (the exact ISS-006 hollow case) → provider_error; healthy → real readings.
  - Real Open-Meteo (permitted read), valid coords: `{"ok":true,"result":{"temperatureC":26.7,"windKph":12.2,"weatherCode":0,…}}`.
  - Real Open-Meteo, forced lat=999 via setConnectorConfig: `{"ok":false,"error":"provider_error","message":"Weather lookup failed — Open-Meteo returned HTTP 400 ({\"error\":true,\"reason\":\"Latitude must be in range of -90 to 90°. Given: 999.0.\"})."}` — HYP-003 logging path (code+detail into audit) demonstrated against the live provider.
  - Frontend error branch: `ToolResult` in src/screens/Connections.tsx:543-546 already renders any `!res.ok` result in coral (`border-coral-200 bg-coral-50 text-coral-700`) — no frontend change needed; matches design vocabulary (coral = attention).
- Regressions checked: full suite deferred to wave-close (runs again after G2/G3 land); targeted file 4/4; no other executor touched.
- Responsive/platform: not-applicable (server executor); UI branch is the existing generic error panel.
- Integrations: live backend still runs pre-fix code until next restart — in-emulator drawer check deferred to the consolidated runtime verification pass (backend restart will be journaled).
- Verdict: **ship** (runtime drawer re-check queued in verification pass)

## Slice 3 — T-07 Node story reconciliation (WP-005)

- Scope: WP-005; ISS-007; FEAT-166/167; HYP-006 (parity remains open)
- Expected: production Node pinned inside a reconciled engines range equal to CI's Node; README no longer contradicts engines.
- Decision (two paths compared): keep engines `>=22.13 <25` + pin Render `NODE_VERSION=24` (LTS, equal to CI's server+web jobs, node:sqlite flag-free) — CHOSEN. Alternative — widen engines to include the dev machine's 25.8.2 — REJECTED: Node 25 is non-LTS and CI-untested; widening would legitimize production booting the exact untested-major risk ISS-007 names.
- Evidence: render.yaml parses (yaml.safe_load OK, NODE_VERSION="24"); consistency table — engines `>=22.13 <25` (unchanged, no package.json edit needed) ⊇ CI node 24 = render pin 24 = README statement (updated from the false "Node 18+ (built on Node 20)").
- Regressions checked: render.yaml + ci.yml YAML-parse clean; no runtime code touched.
- Responsive/platform: not-applicable (config/docs).
- Integrations: local boot smoke on Node 24 NOT possible (nvm has 20.20.2/22.12.0/25.8.2 — none in-range; install not authorized). Declared deferred to CI-on-push per matching guide Unavailable Effects. Not claimed as pass.
- Verdict: **ship** (with the declared boot-smoke gap)

## Slice 4 — T-12 CI guard for the ISS-001 class (WP-001 slice 4)

- Scope: WP-001/ISS-008; FEAT-166
- Expected: CI job `data-isolation` boots a real server on the default `server/.data`, runs the full suite beside it, asserts the data dir byte-identical and the server healthy afterward.
- Evidence: ci.yml YAML-parse clean (jobs: server, data-isolation, web, mobile); LOCAL simulation of the job's exact steps (fresh temp data dir standing in for CI's fresh workspace, PORT=8790 to avoid the live backend, node 25.8.2 as no in-range Node exists locally): health 200 → pre-hash 9 files → `npm test` 291/291 pass → post-hash byte-identical → health 200 → server stopped.
- Regressions checked: existing CI jobs untouched (server/web/mobile blocks preserved verbatim).
- Responsive/platform: not-applicable.
- Integrations: end-to-end CI execution impossible pre-push (git mutations barred) — explicitly deferred to the user's first push; local simulation is the honest proxy.
- Verdict: **ship** (CI end-to-end proof deferred, declared)

## Slice 5 — T-02+T-03 Honest degraded mode + local sessions (WP-002, via G2 sonnet agent)

- Scope: WP-002; ISS-002, ISS-003, ISS-003b; FEAT-001..005, 016, 146
- Expected: global amber `role="status"` degraded banner in the mobile shell; explicit unreachable states in onboarding/dashboard; local (client-only) sessions for sample/local households so loginAs never dead-ends; Lock merges + labels local households; claimed servers route Create-household to email signup; PIN/subtitle copy fixed.
- Evidence: G2 report (typecheck exit 0, exactly its 5 owned files); combined post-landing `npm run typecheck` exit 0 by lead; code inspected (Lock merge logic + amber role=status notes at Lock.tsx:124-129; isLocalSession/isDegraded in useStore). Runtime evidence in Slice 8 below.
- Regressions checked: email-signup and server-backed session paths preserved per G2 report; full suite + runtime pass at wave close.
- Responsive/platform: verified at 375x812 + desktop in Slice 8.
- Integrations: server claim semantics untouched (T-08 coordinated separately).
- Verdict: **ship** (contingent runtime confirmation recorded in Slice 8)

## Slice 6 — T-04+T-05 Assistant local fallback + trigger fix (WP-003, via G3 sonnet agent)

- Scope: WP-003; ISS-004, ISS-005; FEAT-020, 021, 042; HYP-005
- Expected: no-provider chat routes through the local rules engine (plan card + approvable automation + provenance labels; scoped nudge instead of blanket wall); detectTrigger() applied in the automation-creation path with the resolved trigger shown pre-activation.
- Evidence: G3 report (typecheck exit 0, exactly its 3 owned files — AIProviders.tsx needed no change); combined typecheck exit 0; runtime evidence in Slice 8.
- Regressions checked: provider-configured path untouched per G3 report; one transient mid-edit typecheck flicker (G2 concurrent edit) resolved — final combined typecheck clean.
- Responsive/platform: verified at 375x812 in Slice 8.
- Integrations: approval gating preserved (plan Approve creates the automation through the existing path).
- Verdict: **ship** (contingent runtime confirmation recorded in Slice 8)

## Slice 7 — T-08 pre-auth roster minimization + T-09 dependency removal (WP-005)

- Scope: WP-005; ISS-009, ISS-010; FEAT-005, 160; HYP-004
- Expected: pre-auth `/api/profiles` carries only actorId/displayName/role/pinRequired (no relationship/child-age strings); react-router-dom removed from dependencies and bundle.
- Evidence:
  - HYP-004 resolved OBSERVED: pre-restart unauth curl on the claimed resident tenant returned `"relationship":"Account owner"` → exposure persists post-claim. Post-restart (new code): `{"profiles":[{"actorId":"m-owner","displayName":"Ross","role":"Owner","pinRequired":false}],"claimed":true,...}` — no relationship/age fields.
  - Lock/Onboarding consume only actorId/displayName/role/pinRequired/claimed/householdName (code-read of landed G2 files); client type mirror updated in src/connectors/api.ts.
  - T-09: zero `react-router` imports repo-wide (grep); `npm uninstall react-router-dom --ignore-scripts` — package.json + lock clean, user's 8 topgun:* scripts and drift devDeps intact; `npm run build` exit 0; `grep -ril react-router dist/assets/` → 0 files.
- Regressions checked: typecheck exit 0; full suite at wave close; Lock renders post-trim (Slice 8).
- Responsive/platform: not-applicable (payload/config).
- Integrations: backend restarted (journaled event #47) to serve new code; health 200.
- Verdict: **ship**

## Slice 8 — Consolidated runtime verification + integration fixes (all WPs)

- Scope: WP-002, WP-003, WP-004, WP-005; ISS-002/003/003b/004/005/006/009; HYP-004, HYP-005
- Expected: every WP acceptance criterion exercised live in the Playwright emulator at 375x812 (+ desktop 1280x800 for the banner), against the restarted backend running the new server code.
- Runtime results (evidence under implementation/evidence/, all screenshots inspected):
  - T-02: backend stopped (journaled #48) → Lock shows role=status "The backend is unreachable — showing local profiles…"; local sign-in works; dashboard shows the amber role=status banner "Can't reach the FamiliOS server…" at 375x812 (EV-212) AND desktop 1280x800 (EV-213, plus sidebar Runtime-offline pill). Backend restarted (journaled #49), health 200. No silent-failure UI. Residual: a one-shot burst of 401 console errors remains (visible banner makes it honest; not a loop).
  - T-03: reseed on the claimed server now lands signed-in to the local Harper session (was: dead-end at stranger's Lock); Lock merges local members labeled "On this device — not registered with this server" under a role=status foreign-server notice; tapping Alex Harper establishes a local session → "Good evening, Alex" with degraded banner; claimed-server "Create or join a household" opens the email/password signup form. Local sessions do not survive reload — lands on the usable merged Lock, no dead-end (accepted, noted).
  - T-04: in a genuinely provider-less context (local Harper session), the planning chat renders the local-engine plan card — approvable, trigger badge, "Answered by the local rules engine." (EV-210). Provider path re-verified untouched: Ross's provider-configured household answered with "Answered by gpt-5.5." provenance label (one real OpenAI call, user's key — noted, no further provider chats sent).
  - T-05: Workflow Builder "Every morning at 7am…" → rules-engine preview shows "Trigger: Schedule · every morning" BEFORE activation; Activate stores automation with trigger "Schedule", status active (IndexedDB record verified). HYP-005 resolved observed: wiring gap, now derived.
  - T-06: Weather drawer valid run → real readings (temperatureC 26); lat=999 forced → coral provider_error with the real Open-Meteo 400 reason visible in the tool panel (EV-211 shows the forced config; error text verified via DOM extraction — coral-styled element captured verbatim); config restored to 40.7128 and re-verified valid.
  - T-08: pre-restart unauth curl showed relationship exposed post-claim (HYP-004 resolved observed: persists); post-restart payload carries no relationship/age fields; Lock renders fine on the trimmed contract.
- Integration fixes required during the pass (all in G2/G3-owned files, typecheck exit 0 after each, re-verified at runtime):
  1. `reseed()` now severs the server session FIRST — a live session's server-authoritative hydrate was clobbering the fresh Harper roster (the ISS-003 race one level up), leaving members=[server roster] and a silent loginAs failure.
  2. `loginAs` local-session fallback extended to `member_archived` — claiming a server ARCHIVES the demo roster, so sample members answer "archived" (403), not "unknown"; the foreign server's verdict has no authority over a local-only household.
  3. Assistant chat error handling stores the machine-readable code in m.error (was prose — the no_provider fallback could never fire when the server attached a message) and maps local-session auth refusals + backend_unreachable to no_provider so chat routes to the local engine.
  4. `loadBackend` no longer clobbers connectors/providers/accounts with undefined on unauthenticated responses — this white-screened Workflow Builder (useConnectables .map crash) in any local session. Pre-existing latent bug newly reachable via local sessions.
- Regressions checked: full suite 291/291 pass beside the live backend, `server/.data` byte-identical (final hash guard), health 200 after; typecheck exit 0; provider chat path intact.
- Responsive/platform: banner + Lock verified at 375x812 and 1280x800.
- Integrations: user's `npm run topgun:web` harness run — 7 failed / 5 skipped. Attributed to a PRE-EXISTING expectation mismatch, not slate regression: the harness expects a fresh browser to boot to the Lock screen, but fresh no-data boot has always shown Onboarding (audit SS-000, pre-slate) and the boot decision (useStore init needsOnboarding branch) is untouched by the slate (git diff). Flagged for the user; not claimed as pass.
- Verdict: **ship**
