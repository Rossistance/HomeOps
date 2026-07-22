# Verification Matrix (S7) — run-20260721-054151

Legend: pass(real) = UI-observed on local dev + server truth · pass(sandbox+blocker) = sandbox twin green, named external blocker printed · fail · blocked(gate) · pending. A passing build/test suite alone is never end-to-end proof; every UI-facing row requires Playwright-rendered evidence. All claims are LOCAL-DEV evidence — production (Render) parity NOT verified this run.

## Baseline

| Check | Result | Evidence |
|---|---|---|
| npm run typecheck (pre-wave-1) | pass — exit 0 | slice-log baseline |
| npm test (pre-wave-1) | pass — 369/369 | slice-log baseline |
| npm run topgun:web (pre-wave-1, after stale-spec repair 1e4a084) | pass — 8 passed / 6 skipped (by-design skips) | slice-log baseline |
| Playwright webServer cold-boot in this sandbox | fail (environment) — standing workaround: lead-managed dev stack + reuseExistingServer | slice-log baseline |

## Per-WP acceptance criteria

| WP | Criterion | Status | Evidence |
|---|---|---|---|
| WP-001 | Parked run visible in Messages→Approvals ≤5 s, badge ≥1 | pass(real) | inbox-truth 2/2; wp001-approvals-pending.png |
| WP-001 | Approve in UI resumes run to completed | pass(real) | inbox-truth; wp001-approved-completed.png |
| WP-001 | Notification lands in Inbox; mark-read persists | pass(real) | inbox-truth; wp001-inbox-notification.png |
| WP-001 | Zero `data.approvals` reads in Approvals render path | pass(real) | grep exit 1; commit 3a685e8 |
| WP-001 | Dashboard "Needs you" + nav badge server-fed | pass(real) | wp001-badge.png |
| WP-002 | summarizeOutcome truth table honest | pass(real) | summarize-outcome.test.mjs; b6174e6 |
| WP-002 | Chat attribution via choke point; clamps preserved | pass(real) | chat-agent-attribution + orchestrate-entry tests |
| WP-002 | notify_contact in-app fallback honest | pass(real) | notify-contact-delivery tests |
| WP-002 | "send me a note" chat E2E lands visible Inbox row (joint with WP-001) | pass(real) | chat-delivery.spec.ts 1 passed (1.4s): in_app fallback disclosed (inAppFallback:true) + Inbox row rendered; required the agt_household self-heal fix (368514d — new households never had the default agent, chat attribution no-oped) |
| WP-002 | UC-20 clean path still honest ("finished (2/2)") | pass(real) | uc01 asserts honest "finished (2/2)" run_result; uc20 asserts honest 4/4; both through the real chat UI |
| WP-003 | One history, identical status text everywhere | pass(real) | run-world 5/5; wp003-unified-history.png |
| WP-003 | Cause-specific parked labels + working CTAs | pass(real) | run-world (c)/(d); wp003-needs-*.png |
| WP-003 | Plan card with runId renders no Run button | pass(real) | run-world double-run guard; wp003-plan-card-no-run-button.png |
| WP-003 | Thread order user→answer→status | pass(real) | assistant-thread-order.test.mjs (write-time fix) |
| WP-003 | Error-only threads labeled/deduped | pass(real) | run-world spec + 3d7080d |
| WP-004 | Task visible ≤2 clicks from Home + links | pass(real) | results-homes 1/1; wp004-dashboard-open-tasks.png |
| WP-004 | Draft artifact visible in Knowledge Library | pass(real) | wp004-knowledge-artifacts.png |
| WP-004 | run_result links[] payload + chat render | pass(real) | results-links.test.mjs + Assistant render (3d7080d) |
| WP-005 | Create/schedule/run/inspect helper without leaving Helper Agents | pass(real) | helper-agents-nav.spec.ts (in-drawer trigger composer, schedule w/o navigation); commit 45008b2; wp005-agent-package-detail.png |
| WP-005 | Nav shows one entry (+Advanced reveals); flag-off restores old nav | pass(real) | helper-agents-nav.spec.ts (a)+(b/c) flag-off pinned byte-identical; wp005-nav-unified.png |
| WP-005 | 51→≤20 migration ON COPY with printed mapping report; zero orphaned triggers | pass(real) | migration-dry-run-report.md (ART-024): 57→14, 4/4 invariants on real copy-apply; DEC-020 approval; resident apply 39/39 actions + post-apply invariants 4/4; wp005-resident-migrated.png |
| WP-005 | 22-UC skills invocable post-migration | pass(real — bounded) | post-apply invariants incl. zero-orphan (ART-024); UC-suite invocation semantics proven on disposable tenants (resident skill invocation deliberately not exercised — would write runs into family data) |
| WP-006 | orchestrate() single entry; grep gate | pass(real) | orchestrate-entry.test.mjs; grep clean (9ff42f7) |
| WP-006 | npm run topgun:usecases runs 22 specs; every UC green or sandbox-green+named blocker | pass(real) | 23 specs (22 UCs + unattended scheduler soak) — 23 passed; 9 active-lane real, 11 sandbox+named blocker, 2 honest-park+named blocker, 3 hermetic-bound w/ named net.mjs limitation; commits 29f6c63/1c7401b/7180c65 |
| WP-006 | Suite green 3× consecutively (soak) | pass(real) | 23 passed ×3 consecutive on Windows dev host (2.8m / 3.3m / 2.3m); per-UC latency table evidence/uc-suite-latency.md |
| WP-006 s7 | Unattended: tz-anchored trigger fires alone; approval park→real-UI decide→complete; unified history | pass(real) | scheduler-soak.spec.ts green in all 3 soak runs (57–87s, real anchored wait); soak-unattended-scheduler.png; commit dbc077d |
| WP-007 s1 | Token field + header injection unit; live "Test connection" green | DEFERRED-ON-GATE (LM Studio not running; token user-owned) | |
| WP-007 | Memory search + planner profile + honest degradation + zero cloud | pass(real — DEC-014 FTS5 backend) | memory-search 1/1; wp007-memory-search.png; planner-memory-context tests |
| WP-007 | Resident memory migration parity | pass(real) | 22/22 written; idempotent re-run 0/22/0 |
| WP-008a | Every accepted improvement shows before/after diff; Revert restores prior version (audited) | pass(real) | improvements-review.spec.ts 1 passed; commit f7961cf; wp008a-diff.png, wp008a-reverted.png |
| WP-008a | autoApproveImprovements default OFF for new households + banner for existing | pass(real) | f7961cf (evolution-revert tests + settings default); improvements-review spec on disposable household |
| WP-008b | Dry-run report + backup before mutation | pass(real) | ART-021; export-diff clean |
| WP-008b | Selective revert after user approval; instructions==v1 | pass(real) | DEC-019 executed; slice-log execution record |
| WP-009 | Idle 60 s network trace ≤6 requests; change visible ≤5 s; badge freshness intact | pass(real) | sync-hygiene.spec.ts; commit 91c0ada (rev-gated hydrate + SSE, 660→3-4 req/min); wp009-idle-trace.png, wp009-badge-freshness.png |
| WP-010 | Sign-out from 2-member household offers both profiles; childAiGate refusal; privacy flag hides names | pass(real) | roles-profiles.spec.ts 2 passed; commit 605017b; wp010-picker-own-household.png, wp010-child-chat-gate.png, wp010-child-no-decide.png |
| WP-011 | Non-advanced Activity shows only templated plain-language lines | pass(real) | trust-polish.spec.ts; commit 4d89f8d; wp011-activity-plain.png vs wp011-activity-advanced.png |
| WP-011 | Connector-parked run expires after TTL with honest Inbox notice | pass(real) | connector-park-ttl.test.mjs 6/6 (incl. 2 lead-2 regression pins); lead-2 flagged re-sweep: 9/9 resident legacy parks expired + 9 Inbox notices (commit 9a499f8) |
| WP-012 | Per-provider real-credential checklist surfaced; sandbox spec green per gated UC | pass(real checklist) / per-UC sandbox greens tracked in the 22-UC table below | connections-setup.spec.ts; commit a635420; wp012-setup-checklist.png |
| WP-012 | Real SMS/email sends | blocked(gate: user credentials + explicit go-ahead — never automated) | |

## Final validation (lead-2 close-out, 2026-07-22, HEAD = 7180c65 + close-out docs)

| Check | Result (verbatim) |
|---|---|
| npm run topgun:usecases ×3 (soak) | `23 passed (2.8m)` / `23 passed (3.3m)` / `23 passed (2.3m)` |
| npm run topgun:web | `29 passed (2.9m)` / `6 skipped` (skips = mobile-variant + PWA-production by design) |
| npm test | `tests 549 / suites 38 / pass 548 / fail 0 / skipped 1` (skip = Supermemory sidecar boot, honest Windows skip per DEC-014) |
| npm run typecheck | exit 0 |
| Render bundle | serves 4d89f8d client build (all 6 entry asset hashes byte-identical to local build); /api/health memoryProvider sqlite-fts5 |
| Resident tenant | read-only except DEC-020 flagged sweep: 9/9 legacy parks expired + 9 Inbox notices; one new self-created park (run_10407a1f) under normal TTL |

## 22 use-cases (final gate at WP-006 s4–s7)

| UC | Lane | Status | Evidence |
|---|---|---|---|
| UC-1 School Correspondence Organizer | sandbox (blocker: Google OAuth app, gmail.readonly + gmail.modify — user-owned, DEC-016) | pass(sandbox+blocker) | uc01-school-correspondence.spec.ts 1 passed (2.7s): search→approval park→REAL UI approve→resume; effect sbx-msg-1+School asserted; commit 29f6c63 |
| UC-2 Emergency Work-to-Home Forwarder | sandbox (blocker: Microsoft 365 OAuth app — user-owned, DEC-016) | pass(sandbox+blocker) | uc02 spec: outlook.search→gmail.send park→real-UI approve→effect (recipient family.home.sandbox@example.invalid, "Invoice #4471"); uc02-work-to-home-forwarder.png |
| UC-3 Urgent Slack Escalation | sandbox (blocker: MS365 + Slack OAuth apps — user-owned, DEC-016) | pass(sandbox+blocker) | uc03 spec: outlook.search→slack.postMessage park→approve→effect (channel C_SBX_FAMILY); uc03-urgent-slack-escalation.png |
| UC-4 Grandparent Weekly Digest | sandbox (blocker: email-send OAuth, gmail.send / MS365 Mail.Send — user-owned, DEC-016) | pass(sandbox+blocker) | uc04 spec: calendar digest→gmail.send park→approve→effect (grandma.sandbox@example.invalid, fixture events in body); uc04-grandparent-digest.png |
| UC-5 Cross-Calendar Conflict Sync | sandbox (blocker: MS365 + Google OAuth apps — user-owned, DEC-016) | pass(sandbox+blocker) | uc05 spec: mscal.list+calendar.list→mscal.create hold park→approve→effect (ISO start asserted) 3/3; uc05-cross-calendar-conflict.png |
| UC-6 Corporate Hold Generator | sandbox (blocker: Microsoft 365 OAuth app — user-owned, DEC-016) | pass(sandbox+blocker) | uc06 spec: calendar.list→mscal.create park→approve→effect; uc06-corporate-hold-generator.png |
| UC-7 Secure Document Cloud Sync | sandbox (blocker: Google Drive + OneDrive OAuth apps — user-owned, DEC-016) | pass(sandbox+blocker — read-both-stores bound) | uc07 spec: drive.list+onedrive.list fixtures asserted 2/2, zero fabricated effects. HONEST BOUND: no drive/onedrive WRITE tool exists in providers.mjs — "sync" cannot exceed read-both-stores until product adds one (gap flagged) |
| UC-8 Secure Archive Builder | sandbox (blocker: Dropbox OAuth app — user-owned, DEC-016) | pass(sandbox+blocker) | uc08 spec: dropbox.list→createFolder park→real-UI approve→effect (exact archive folder path); uc08-secure-archive-builder.png |
| UC-9 Database-to-Checklist Pipeline | honest-park (blocker: Notion + Todoist — NOT sandboxed by design, credentials user-owned) | pass(park-honesty+blocker) | uc09 spec: external step parks waiting_for_connector w/ "Needs a connection" + Connections CTA through real UI; internal checklist half completes for real; uc09-database-to-checklist.png |
| UC-10 Vacation Project Onboarding | honest-park (blocker: Notion + TickTick — NOT sandboxed by design, credentials user-owned) | pass(park-honesty+blocker) | uc10 spec: same honest-park contract; internal task items complete for real; uc10-vacation-onboarding.png |
| UC-11 Overdue Chore Auditor | real (internal-tasks variant; Todoist lane annotated blocker: connector not sandboxed by design) | pass(real) | uc11 spec: 2 past-due tasks seeded via run→chat audit→Dashboard "Needs you" shows both Overdue; uc11-overdue-chore-auditor.png |
| UC-12 Smart Climate Night-Mode | sandbox (blocker: Google Home/Nest Device Access SDM project + OAuth — user-owned, DEC-016) | pass(sandbox+blocker) | uc12 spec: setThermostat park→approve→effect heatCelsius:18 (synthetic SDM project, sandbox-filled); uc12-climate-night-mode.png |
| UC-13 Smart Speaker Dinner Bell | sandbox (blocker: Amazon Alexa credentials — user-owned, DEC-016) | pass(sandbox+blocker) | uc13 spec: alexa.announce park→approve→effect (announcement text verbatim); uc13-dinner-bell.png |
| UC-14 Morning Status Text | sandbox SMS + REAL weather (blocker: Twilio credentials — user-owned, DEC-016; rss leg scoped out under net.mjs no-dev-seam limitation) | pass(sandbox+blocker; weather real) | uc14 spec: sms.send effect body carries the LIVE Open-Meteo temperature; uc14-morning-status-text.png |
| UC-15 Family Dashboard API Bridge | real (http connector) | pass(hermetic + named limitation) | uc15 spec: honest-refusal/park path through the real UI. LIMITATION: net.mjs SSRF guard has no dev/test seam (connectors.mjs:459-462), so a hermetic live GET/POST round-trip is unreachable — real-bridge smoke needs a user-supplied allowlisted endpoint |
| UC-16 School Menu Data Harvester | real (browser-runtime) | pass(hermetic + named limitation) | uc16 spec: honest park/refusal path through real UI (net.mjs guard, no local-fixture seam; connectors.mjs:355-356). PLUS product/spec mismatch logged: PRD names files-local file.import which is runtime:"client" — fails closed for EVERY agentic plan in any environment |
| UC-17 Smart Recipe Extractor | real (web read) | pass(hermetic + named limitation) | uc17 spec: honest-refusal path through real UI (web.mjs:290 same guard). Recipe parsing itself pinned by recipeFromHtml unit tests (npm test) — live extraction needs a real allowlisted URL |
| UC-18 Digital Memory Scrapbooker | real | pass(real) | uc18 spec: write_memory+create_artifact run→Memory tab search finds it, artifact opens in Knowledge Library; uc18-memory-scrapbooker.png |
| UC-19 Event Coordinator & Logistics | real | pass(real) | uc19 spec: full functional proof — event + checklist + driver + what-to-bring all visible on Calendar/event detail; uc19-event-coordinator.png |
| UC-20 Chore Manager & Document Linker | real (LIVE-verified baseline EV-032§4) | pass(real) | uc20-chore-manager.spec.ts 1 passed (2.4s): chat→task+list+event+attachment (eventId threaded), Dashboard+Calendar+run_result links UI-verified; commit 29f6c63 |
| UC-21 Meal Planner & Sign-Off | real (in-app lane; external channels are UC-4/14's sandbox evidence) | pass(real) | uc21 spec: plan_meal visible on Meals + sign-off approval decided by real UI click, run completes only after decide; uc21-meal-planner-signoff.png (lead-inspected: decided card + Approved toast) |
| UC-22 Internal System Sync | real | pass(real) | uc22 spec: note→memory searchable in Memory tab + real server notification renders unread in Messages→Inbox; uc22-internal-system-sync.png |
