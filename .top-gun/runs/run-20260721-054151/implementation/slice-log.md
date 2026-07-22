# Slice Log — run-20260721-054151 implementation

Five-point iteration check per slice: (1) works as expected? (2) broke anything that worked? (3) narrow/mobile/responsive layouts hold? (4) required integrations still connected? (5) verdict ship|another-round.

## Baseline (before wave 1) — 2026-07-21

- Scope: entry revalidation per matching-guide checklist (no code changes).
- Commands + verbatim results:
  - `npm run typecheck` → exit 0, no output (green).
  - `npm test` → `tests 369 / suites 18 / pass 369 / fail 0 / cancelled 0 / skipped 0` (green).
  - `npm run topgun:web` → pending (running).
  - LM Studio probe `curl http://localhost:1234/v1/models` → **connection refused** (was HTTP 401 token-gated at matching 06:57Z; gate HARDENED — LM Studio not running).
  - `tests/topgun/usecases` → does not exist (as expected; WP-006 builds it).
  - `NODE_EXTRA_CA_CERTS` → empty (set before any node CLI TLS fetch, e.g. npx supermemory).
  - git tree dirty only with .top-gun files + "automations and agents.txt" (matches audit baseline; preserved untouched).
- `npm run topgun:web` first run (Playwright-managed webServer cold boot): **9 failed / 5 skipped — all ERR_CONNECTION_REFUSED at :5173**; manual `node scripts/dev.mjs` boots both ports fine (HTTP 200). Root cause: Playwright's webServer child spawn does not survive this sandboxed environment; NOT a product defect. **Standing workaround for the whole mission: lead keeps the dev stack running; `reuseExistingServer: true` picks it up.**
- Rerun against running stack: 7 passed / 1 failed / 6 skipped. Real baseline failure: `core-flows.spec.ts:70 calendar renders view tabs and month controls` — spec expected month-nav controls on open but Calendar defaults to list view (controls render only inside MonthGrid). Stale test, not product regression.
- Baseline repair (test-only, XS inline): spec now clicks the month tab before asserting controls. Rerun single spec → `1 passed`. Full suite rerun → **`6 skipped / 8 passed (17.2s)`** (skips = mobile-variant + PWA-production specs, by design on web-chromium).
- Commit: 1e4a084 `test(topgun): calendar spec follows the list->month view switch`.
- Five-point check: (1) works — suite green; (2) nothing broken — full suite + typecheck + npm test green; (3) responsive n/a (test-only); (4) integrations n/a; (5) verdict: **ship**.
- BASELINE GREEN — wave 1 may start.

## Incident — backend SQLITE_IOERR during wave 1 (2026-07-21 ~12:30Z)

- Symptom: :8787 SQLite "disk I/O error" on every route, then listener gone; vite healthy. devstack.log: `ERR_SQLITE_ERROR errcode 266 (SQLITE_IOERR_SHORT_READ)` inside the server's own `backupTick` (backup.mjs:119 → store.getSettings → tenant-db rowBacked), `[backend] exited with 1`.
- Cause (working hypothesis, timeline-consistent, orchestrator-confirmed): WP-008b analyst opened the HOT WAL `household.db` from a second process (`node:sqlite` readOnly) at 12:29:58Z; on Windows a second WAL reader participates in `-shm` locking and can induce IOERR in the live writer.
- Remediation: killed remnants; PRAGMA integrity_check = **ok**; record counts match EV-031 exactly (18 agents/53 approvals/21 evolution/22 notifications/16 playbooks/13 skills/4 functions/3 triggers; runs 99→102 = the repo's own TG- spec runs, benign); cold snapshot taken pre-restart under implementation/evidence/backups/local-cold-snapshot-20260721T131540Z; stack relaunched clean.
- PREVENTION RULE (mission-wide): nobody opens a hot tenant DB from a second process. Backups/mutations happen either through the server's own process or with the server stopped.
- Side observation: transient vite client unhandled rejections (`calendarAutoSync`, `.map`) during agent dev/mid-HMR + backend death; not reproduced after restart with final code (inbox-truth spec asserts a clean console via watchPageErrors and passed 2/2).

## Wave 1 — WP-002 honest delivery (commit b6174e6)

- Scope: delivers-flag contract, summarizeOutcome rewrite (regex deleted), chat attribution via runAssistantPlan choke point (flag HOMEOPS_CHAT_AGENT_ATTRIBUTION), notify_contact in-app fallback + notify.delivered_inapp audit, run_result draft artifact linkage. Files: server/{assistant-runs,internal-functions,providers,connectors,orchestrator,index,notify}.mjs + 4 test files (summarize-outcome truth table, chat-agent-attribution new; assistant-runs, notify-contact-delivery extended — GATE 1 rewritten to the in-app-fallback contract deliberately).
- Validation (verbatim): `npm test` → `tests 394 … pass 394 fail 0` at slice return; final wave state `pass 403 fail 0`. `npm run typecheck` → exit 0. Grep-gate: delivery name-regex survives only in explanatory comments; `delivers` flags present in 4 server files.
- Five-point: (1) works — truth table + attribution tests green; (2) no breakage — full suite green, UC-20 semantics intact; (3) n/a server; (4) policy clamps + consent gates preserved (tests); (5) **ship**. Chat-E2E visible-in-Inbox assertion lands with WP-006 fake-provider harness (WP-002 acceptance carried to verification matrix as pending that E2E).

## Wave 1 — WP-007 s1 LM Studio/Ollama tokens (commit 7dd7be0)

- Scope: keyOptional metadata for lmstudio+ollama, Settings token field (masked, provider-aware hint), bearer injection on chat/health/model-discovery when key stored, 401 hint naming the token page. Includes orchestrator-relayed user follow-up: ollama bearer parity (ai-ollama-auth.test.mjs, 9 tests).
- Validation (verbatim): `npm test` → `pass 403 fail 0`; typecheck exit 0. 17 hermetic auth tests total.
- Five-point: (1) works per units; (2) no breakage; (3) n/a; (4) provider fallback chain intact; (5) **ship** with acceptance line "Test connection green with real token" = **DEFERRED-ON-GATE** (LM Studio connection-refused this session; token user-owned). Evidence screenshot of the field deferred to the wave-2 joint pass (agent's attempt was interrupted by the backend incident) — tracked in verification matrix.

## Wave 1 — WP-001 inbox read-models (commit 3a685e8)

- Scope: api.listApprovals; Messages Approvals tab = GET /api/approvals (pending+decided, decide wired, source chip, countdown, real resolved input); Inbox merges server notifications with mark-read; Shell badge + topbar "N to approve" + Dashboard "Needs you" off serverApprovals/serverNotifications on the existing hydrate loop; zero data.approvals in render path (grep exit 1); family-readable approval status labels (consumed→Approved) — lead integration fix after spec caught raw `Consumed` rendering.
- Validation (verbatim): `npx playwright test … inbox-truth` → `2 passed (5.9s)`; full `npm run topgun:web` → `6 skipped, 10 passed (25.3s)`; typecheck exit 0.
- Evidence (inspected by lead): wp001-approvals-pending.png (pending card, resolved input, countdown, badges, "3 to approve"), wp001-approved-completed.png (DECIDED + green Approved badge + toast, counts decremented), wp001-inbox-notification.png (unread/read server notifications in Inbox), wp001-badge.png. Spec runs in disposable "TG Harness Household".
- Five-point: (1) works — park→see→approve→complete through the real UI; (2) no breakage — full suite green; (3) webkit-iphone variants remain skipped-by-design on chromium project (mobile pass scheduled with wave-2 joint verification); (4) hydrate loop + CSRF decide intact; (5) **ship**.

## WP-008b — selective wipe EXECUTED (user-approved DEC-019)

- Gate honored: dry-run report (ART-021) produced read-only BEFORE any mutation; orchestrator relayed recorded user approval "Revert Gmail agent + archive all 21" (decision log DEC-019 verified firsthand).
- Execution (server STOPPED, single process, script wp008b-execute.mjs): fresh format-2 backup verified (18 agents/21 evolution/13 skills) → rollbackAgent(agt_b805192d4c2a6fd95513, v1) self-snapshotting (v2 corrupted "weather" instructions preserved as snapshot; agent now v3 == v1 Gmail policy byte-exact) → all 21 evolution rows copied to evolution_archive (archivedAt/By/Reason) → active evolution emptied → re-export diff: ONLY expected deltas; skills/skill_versions/other agents byte-identical.
- Output (verbatim tail): `REVERT OK: agent now version=3; instructions match v1 exactly.` / `ARCHIVE OK: evolution_archive=21, active evolution=0.` / `DIFF OK: only expected deltas…` / `WP-008b EXECUTION COMPLETE.`
- Rollback: FRESH bundle familios-backup-local-FRESH-2026-07-21T13-30-31-255Z.json.gz (+ pre-incident cold snapshot). Version stores never deleted.
- Post-restart health: vite+api 200, zero fatal patterns in devstack4.log. Skill smoke: export-diff proves 13 skills byte-identical; full invocation smoke deliberately deferred to WP-006 sandbox suite on a disposable tenant (invoking resident skills would create real runs in family data).
- Five-point: (1) works; (2) nothing else changed (diff-proof); (3) n/a; (4) server boots clean on mutated data; (5) **ship** (UI diff/revert surfaces arrive in WP-008a, wave 5).

## Wave 2 — stability infra (commit 7b953ae)

- Scope: three mission-stability fixes forged by incident triage — (a) tenant-db stale-handle self-heal (close+reopen+retry-once on SQLITE_IOERR 266; loud log; real corruption still quarantines), (b) vite watcher ignores server/.data + tests/topgun/.artifacts + .top-gun (watcher held WAL handles → backend write wedges; artifact churn caused page reloads MID-SUITE), (c) signUpDisposableHousehold() helper — writing specs now use fresh hh_* tenants, never the resident family tenant. Also swept TG- junk from resident via server API (3 tasks + 6 agents deleted; TG-labeled runs 33 / approvals 4 / notifications 12 kept — audit-trail entities, clearly labeled).
- Validation: npm test 468/468; typecheck clean; health/profiles/session 200 post-restart; no disk-I/O recurrence through subsequent spec runs.
- Five-point: (1) works; (2) suite green; (3) n/a; (4) quarantine semantics preserved; (5) **ship**.

## Wave 2 — WP-004 results have homes (commit c502aeb)

- Scope: run_result links[] (buildResultLinks + unit), Chore Board = the tasks surface (seed for new households + lead-added lazy client-side provision on first Open-tasks click for existing ones), board renders live tasks, Dashboard "Open tasks" (undated + upcoming), Files & Knowledge Knowledge Library (dynamic kind chips, detail drawer, count badge, offline states). E2E results-homes.spec.ts on a DISPOSABLE household.
- Validation (verbatim): lead rerun `1 passed (2.7s)` (spec run `1 passed, 3.1s` at owner return); typecheck clean; npm test 468/468. Evidence (lead-inspected): wp004-dashboard-open-tasks.png (undated TG task under NEEDS YOU/OPEN TASKS on Home, disposable household), wp004-knowledge-artifacts.png (Knowledge Library 2, kind chips All/Briefing/Notification Draft, artifact cards with From-run chips + "Mini app created" toast), wp004-choreboard-task.png, wp004-artifact-detail.png.
- Five-point: (1) works through the real UI; (2) full-suite regression at wave joint pass; (3) mobile variants scheduled with webkit pass at wave 5 soak; (4) hydrate/store integrations intact; (5) **ship**.

## Wave 2/3 — WP-006 s3 connector sandbox (commit 77ffd0a)

- Scope: HOMEOPS_CONNECTOR_SANDBOX=1 transport-swap seam (apiForAccount + sms executeTool) AFTER all consent gates; per-tenant sandbox_effects + sandbox.effect audit; zero external sockets; real-mode egress untouched (regression-pinned); coverage map in README-sandbox.md; 47 tests incl. sandbox-off pinning, no-conjured-accounts, consent-gates-still-refuse. Lead integration: Owner-only session-time account seeding wired at 4 index.mjs session sites (Owner-only after full-login seeding broke the no-conjure invariant — deliberate; other actors stay truthfully not_connected); index.mjs commit deferred (file in flight with WP-006 s1+s2).
- Validation (verbatim): npm test `tests 468 / pass 468 / fail 0`; typecheck clean.
- Five-point: (1) works per module+e2e tests; (2) sandbox-off byte-identical (pinned); (3) n/a; (4) consent/allowlist gates proven intact; (5) **ship** (session-seeding lands with index.mjs commit).

## WP-007 s1 addendum — UI evidence spec (commit faf0220)

- tests/topgun/web/ai-provider-token-field.spec.ts (disposable household): token label + write-only field + honest helper text on local provider cards → `1 passed (1.2s)`; evidence wp007s1-token-field.png (lead-inspected). Found in passing: ui Field lacks htmlFor (getByLabel can't associate) — queued for WP-011 polish. Live acceptance still DEFERRED-ON-GATE.


## Waves 2/3 close — WP-003 + WP-006 s1+s2 (commits 9ff42f7 + 3d7080d)

- WP-003 shipped: runStatusView total mapper (cause CTAs), one history via useServerRuns in Automations+Agents, plan-card double-run guard (mapConv root cause), thread-order (user turn persists pre-run; assistant-thread-order.test.mjs), recents hygiene, run_result links rendering, AND the "Run now" server rewiring (ISS-018 client half: runAgentOnServer registers local-first agents idempotently then runs; "Run via server" button collapsed). run-world.spec.ts 5/5 on throwaway per-test tenants (verbatim: `5 passed (33.8s)`), incl. the ONE-HISTORY guarantee (identical status text in both listings after settle-to-terminal). Evidence wp003-*.png.
- WP-006 s1+s2 shipped (banked complete in 9ff42f7; builder killed pre-report): orchestrate() single entry + HOMEOPS_ORCHESTRATE_ENTRY=off rollback; chat/agent/schedule/webhook/manual all route through it; grep gate passes ("No route creates a run directly anymore"); ISS-018 server-verified attribution incl. smuggle-rejection + ?agentId filter tests; planner pruneCatalogForPrompt (permitted tools + keyword relevance under HOMEOPS_PLANNER_CATALOG_BUDGET for local providers; cloud unchanged). HYP-005 latency tuning DEFERRED-ON-GATE (LM Studio absent).
- Environment forensics shipped with the slice: vite watch.ignored glob strings silently killed the ENTIRE watcher under chokidar v4 (Vite 8) — zero HMR, stale client served to Playwright (caught via trace network showing the OLD /api/runs/start path after the fix landed). Function-matcher form restored HMR (touch-test verified).
- Five-point (both): (1) works through the real UI/tests; (2) 507-test suite green (1 honest skip) + topgun:web 17 passed/6 skipped; (3) webkit-iphone variants scheduled at soak; (4) engine untouched (DEC-012), policy clamps pinned; (5) **ship**.

## Wave 4 — WP-007 s2–s5 memory (commit e841585)

- DEC-014 fallback EXECUTED honestly: `npx supermemory local install` fails on Windows ("unsupported OS: MINGW64"; WSL-only, no distro). FTS5 hybrid (bm25+recency) behind the same provider interface; sidecar client kept as labeled UNVERIFIED scaffolding; the sidecar test genuinely attempts boot and skips with reason.
- Dual-write write_memory; migration via LIVE server HTTP only (no second-process DB opens): resident parity 22/22 written, re-run 0 written/22 deduped (idempotent). Planner context: profile+search when healthy, legacy list + explicit memoryDisclosure when degraded. /api/health exposes memoryProvider (live: ok:true, degraded:false, backend:"sqlite-fts5").
- UI: Memory tab provider search + profile card + degraded banner. E2E memory-search.spec.ts (disposable household): run writes fence fact -> search "fence" renders it (verbatim `1 passed (1.1s)`); evidence wp007-memory-search.png (lead-inspected: profile card, fact row with household-Fact chips). UC-18 memory acceptance satisfied.
- Five-point: (1) works; (2) suite green; (3) standard responsive components (webkit at soak); (4) planner pruning intact; (5) **ship**. Zero-cloud is structural (in-process provider, no sockets).

## Lead-2 finale — residual A: connector-park TTL clock fix + legacy re-sweep (commit 9a499f8)

- Entry revalidation (2026-07-22): typecheck exit 0; npm test `tests 546 / pass 545 / fail 0 / skipped 1` — matches banked PAUSE-STATE exactly; git clean at 4d89f8d + run files.
- Root cause (observed in resident data, server stopped, read-only): expireStaleRuns keyed BOTH legacy classification and the TTL off run.updatedAt — a generic write stamp. The incident-3 restart (Jul-21T18:28:47Z) mass-touched all 8 legacy parks, so the orchestrator's HOMEOPS_SWEEP_LEGACY_PARKED=1 sweep expired ZERO resident runs (audit.jsonl had no connector_park_expired events at all; the "8 expired" were hh_* tenants).
- Fix: park clock = blocked cursor step startedAt (the attempt that parked the run) with updatedAt/createdAt fallback; legacy+flag expires immediately (the flag IS the operator decision); post-epoch TTL immune to unrelated touches. 2 regression tests pin both faces (548/547/1skip green).
- One-shot flagged re-sweep executed and verified with server stopped: 9/9 legacy parks expired (run_d0f11e1f, run_a4ef73a6, run_6b7e2c33 + 6 June "Label marketing emails" runs), 9 audit events with honest parkedAt, 9 in-app Inbox notifications. Flag OFF afterwards. One NEW park (run_10407a1f, created 11:53Z by the resident's own daily trigger during the boot window) remains by design — post-epoch, TTL applies.
- Five-point: (1) works — re-sweep proven in data; (2) approval-sweep + fresh-park tests still green, full suite green; (3) n/a server; (4) Inbox notification path intact (9 created); (5) **ship**.
- Verdict: ship

## Lead-2 finale — residual B: Render bundle-hash verification (no code)

- Local `npm run build` of the client-identical tree vs live https://homeops-ai.onrender.com: all 6 entry assets byte-identical by hash (index-BIA7DuDG.js, index-Bgq51dbi.css, icons-BBhEuszh.js, react-KnJeB_ck.js, rolldown-runtime-QTnfLwEv.js, vendor-CdbSE3_O.js); /api/health shows memoryProvider sqlite-fts5 (wave-4 behavior). Render serves the 4d89f8d bundle; auto-deploy repaired. Read-only checks only.

## Lead-2 finale — WP-006 s4 harness + pilots (commit 29f6c63)

- tests/topgun/usecases.config.ts (json latency reporter, 120s timeout, disposable-household serialization) + `npm run topgun:usecases`; shared usecases/uc.ts (fake deterministic AI provider, real-UI approval loop, gated-lane requireSandbox that annotates the named blocker and skips honestly); sandbox-only GET /api/sandbox/effects (404 in real mode) so UI specs assert would-be effects without second-process tenant reads.
- Pilots green: UC-20 active lane (chat→4-step run incl. deterministic eventId threading; task on Dashboard, event+attachment on Calendar, run_result links in chat) `1 passed (2.4s)`; UC-1 gated lane (gmail.search→modifyLabels parks→REAL Approvals UI approve→resume→sandbox effect sbx-msg-1+School asserted) `1 passed (2.7s)`.
- Five-point: (1) works; (2) typecheck + sandbox suite 47/47 green; (3) config carries web-webkit-iphone project for the soak's mobile pass; (4) consent gates + CSRF proven in the loop; (5) **ship** (suite completes as authors return).
- Verdict: ship

## Lead-2 finale — WP-002 gap: new households had no default agent (commits 368514d + c384a3d)

- Found BY the benchmark (chat-delivery spec on a disposable household): seedDefaults() is resident-boot-only, so every /api/signup household lacked agt_household — chat attribution silently no-oped and homeops.notify_contact hard-refused every plain chat ask for every new family. Two paths compared: (a) seed at signup route (future households only, duplicates agent shape) vs (b) self-create at the attribution choke point ensureOpenDefaultAgent (heals existing households too, one knowledge site) — (b) chosen.
- Validation: new regression test (creation + idempotency in non-resident tenant) 7/7 in file; full suite 549/548/1skip; chat-delivery E2E `1 passed (1.4s)` post-restart — in_app fallback disclosed + real Inbox row.
- Five-point: (1) works E2E; (2) attribution/orchestrate/flag-off suites green — resident path untouched; (3) n/a server; (4) policy clamp + deny-list semantics preserved (existing tests); (5) **ship**.
- Verdict: ship

## Lead-2 finale — WP-006 s4–s6: the 22-UC executable benchmark (commits 29f6c63, dbc077d, c384a3d, 1c7401b, 7180c65)

- 23 specs in tests/topgun/usecases (22 UCs + unattended scheduler soak), all driven through the real UI on disposable households with DELETE /api/account teardown. Lanes: 9 active pass(real) — UC-11/18/19/20/21/22 full functional, UC-15/16/17 hermetic-bound honest-refusal (net.mjs SSRF guard has no dev/test seam — named limitation, connectors.mjs:459-462/355-356, web.mjs:290); 11 gated pass(sandbox + named user-owned blocker) with real-UI approval loops + exact recorded-effect assertions (incl. live Open-Meteo temperature threaded into the UC-14 SMS body); 2 honest-park pass (UC-9/10 — Notion/Todoist/TickTick deliberately not sandboxed).
- Product findings logged, not fixed (out of scope): (a) no drive/onedrive WRITE tool exists — UC-7 "sync" is honestly read-bounded; (b) UC-16 PRD names files-local file.import which is runtime:"client" — fails closed for every agentic plan anywhere.
- Harness finding fixed: 22 signups/run trips the (correct) auth rate limiter — signUpDisposableHousehold now backs off on 429 (22s/44s/66s) instead of failing the suite.
- Five-point: (1) works — 23/23 green; (2) topgun:web 29 passed/6 skipped + npm test 549/548/1skip + typecheck clean; (3) config carries web-webkit-iphone project (chromium is the soak lane; webkit variant available); (4) consent gates, CSRF, sandbox-off pinning all proven inside the loop; (5) **ship**.
- Verdict: ship

## Lead-2 finale — WP-006 s7 soak: 3× consecutive green + unattended scheduler (no new code)

- `npm run topgun:usecases` 3× consecutively on the Windows dev host: 23 passed (2.8m) / 23 passed (3.3m) / 23 passed (2.3m). Zero flakes after the rate-limit backoff landed. Per-UC latency table: implementation/evidence/uc-suite-latency.md (typical UC 1.4–4s; uc21/scheduler-soak legitimately include approval + anchored-minute waits).
- Unattended scenario green in all three runs: tz-anchored trigger (tzSource:household, nextRunAt = exact anchored instant) fired from the server tick with zero client involvement, parked on the approval gate, was decided through the real Approvals UI, completed with agent attribution, and rendered in the unified history.
- Dev-stack health across the whole benchmark window: two SQLITE_IOERR blips, both recovered by the wave-2 stale-handle self-heal (retry-once), zero second failures, zero wedges.
- Five-point: (1) works; (2) nothing regressed (final validation table in verification-matrix); (3) responsive lane available (webkit project); (4) scheduler/tick + approval push loop + SSE intact; (5) **ship** — MISSION SCOPE COMPLETE (user-owned gates remain: LM Studio token, OAuth/Twilio provisioning, real-credential smokes).
- Verdict: ship
