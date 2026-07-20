# Verification Matrix — run-20260719-073933 (implementation)

Columns per register-contracts: Check | Level | Command or method | Result | Evidence ID | Notes. Blocked/partial never reported as pass.

| Check | Level | Command or method | Result | Evidence ID | Notes |
|---|---|---|---|---|---|
| Store guard refuses live .data in test context | unit | `NODE_TEST_CONTEXT=1 node -e "import('./server/store.mjs')"` (HOMEOPS_DATA_DIR unset) | pass | EV-201 | Throws loud named error before opening any DB |
| NODE_TEST_CONTEXT actually set by node --test | unit | scratch probe test printing env under `node --test` (v25.8.2) | pass | EV-202 | Value `child-v8` |
| Full suite beside live backend, data untouched | integration | `npm test` (node 25.8.2) + recursive sha256 of server/.data pre/post + /api/health poll | pass | EV-203 | 287/287 pass; manifest hash `8fc10892a5b0b280…` identical; health 200 before+after |
| Stall sweeper assertion preserved | integration | `node --test server/test/engine-hardening.test.mjs` | pass | EV-204 | 2/2 pass; 45-min-stale run swept to failed('stalled') against ctx.dataDir |
| Latent second offender (web-tools→web→store) isolated | unit | file-level guard failure reproduced, then fixed via env-then-dynamic-import; file green | pass | EV-205 | Pre-existing silent live-data touch, newly surfaced by guard |
| Weather executor honest failure (deterministic) | unit | node --test server/test/weather-honesty.test.mjs (stubbed upstream) | pass | EV-206 | 4/4: HTTP error, non-JSON, missing `current` (hollow case), healthy |
| Weather real upstream valid + forced-bad | integration | executeTool direct (Open-Meteo real read): valid coords; lat=999 via setConnectorConfig | pass | EV-207 | ok:true 26.7C; provider_error HTTP 400 with reason; audit log carries code+detail (HYP-003 logging) |
| Weather drawer error branch in emulator | e2e | Playwright: Connections→Weather, lat=999 saved, Run | pass | EV-211 | Coral-styled "provider_error — … HTTP 400 (Latitude must be in range…)" in tool panel; config restored + re-verified valid (26C) |
| Node story consistency | contract | yaml parse render.yaml + ci.yml; engines/README cross-check | pass | EV-208 | render NODE_VERSION=24 = CI node 24 ⊂ engines >=22.13 <25; README fixed |
| Node 24 local boot smoke | integration | — | blocked | — | No in-range Node installed locally (20.20.2/22.12.0/25.8.2); install not authorized; deferred to CI on first push |
| CI data-isolation job local simulation | integration | scripted job steps: fresh-dir server boot :8790, suite beside it, hash pre/post, health | pass | EV-209 | 291/291; sim dir byte-identical; health 200; CI end-to-end proof deferred to first push (declared) |
| CI end-to-end execution | e2e | — | blocked | — | Runs only on push; git mutations barred this mission |
| Typecheck (combined, post all fixes) | build/type | npm run typecheck (tsc) | pass | EV-214 | exit 0 |
| Full server suite beside live backend (final) | integration | npm test (node 25.8.2) + .data hash guard + health | pass | EV-215 | 291/291 pass; server/.data byte-identical; health 200 |
| Degraded banner mobile (backend down) | e2e+a11y | Playwright 375x812, backend stopped (journaled) | pass | EV-212 | role=status amber banner; explicit unreachable Lock note; local sign-in works |
| Degraded banner desktop | e2e | Playwright 1280x800, same state | pass | EV-213 | Banner spans top; sidebar Runtime-offline pill agrees |
| Claimed-server reseed lands in working sample session | e2e | Playwright: Settings → Reset sample data on claimed server | pass | EV-216 | Stays signed-in locally (Alex), degraded banner, no Lock dead-end — after reseed session-race fix |
| Lock merges + labels local households | e2e+a11y | Playwright: claimed server + local Harper data | pass | EV-217 | Server roster + 6 local members labeled "On this device — not registered with this server"; foreign-server notice role=status |
| Local profile sign-in on claimed server | e2e | Playwright: tap Alex Harper on merged Lock | pass | EV-218 | Local session established ("Good evening, Alex") after member_archived fallback fix |
| Claimed-server Create-household routes to email signup | e2e | Playwright: Lock → "Create or join a household" | pass | EV-219 | Email/password "Create your household" form (form not submitted — would mint a real tenant) |
| No-provider planning chat → local plan | e2e | Playwright: local Harper session, planning message | pass | EV-210 | Local-engine plan card, approvable, "Answered by the local rules engine" label — after error-code fix |
| Provider-configured chat path unchanged | e2e | Playwright: Ross household (OpenAI configured, user drift) | pass | EV-220 | Plan answered, "Answered by gpt-5.5." label; one real provider call consumed (noted); no further provider chats sent |
| Rules-engine trigger derivation | e2e | Playwright: builder "Every morning at 7am…" → rules engine → Activate; IndexedDB read | pass | EV-221 | Preview "Trigger: Schedule · every morning"; stored automation trigger=Schedule active (HYP-005 resolved) |
| Pre-auth roster privacy trim | contract/security | unauth curl /api/profiles before vs after backend restart | pass | EV-222 | Before: relationship exposed post-claim (HYP-004 = persists). After: actorId/displayName/role/pinRequired only |
| Local-session Workflow Builder crash fixed | e2e | Playwright: local session → Automations → Workflow Builder | pass | EV-223 | Was white-screen (useConnectables .map on undefined); renders after loadBackend hardening |
| User topgun:web harness | e2e | npm run topgun:web (web-chromium) | fail | EV-224 | 7 failed / 5 skipped — PRE-EXISTING expectation mismatch (harness expects fresh boot → Lock; fresh no-data boot has always shown Onboarding: audit SS-000 + untouched init branch). Not a slate regression; flagged to user; honestly reported as fail |
| Console noise in local sessions | manual | console review during local-session runs | partial | EV-225 | One-shot 401 burst per screen load remains (banner makes state honest; no loop). Improvement candidate, not acceptance-blocking |
