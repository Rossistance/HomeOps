# Implementation Work Packages — run-20260721-054151

Sequencing note: WP-001→004 form the "one task truly done" vertical (recommended bundle); WP-005/006/007 are the three authorized redesigns; WP-008+ are safety/hygiene. Effort scale: S (<½ day), M (½–2 days), L (2–5 days), XL (>5 days) of focused implementation-lead work.

## WP-001 — One truthful Inbox: server approvals + notifications on web

- Objective: Messages & Approvals becomes a live read-model of server truth; a parked run is visible, decidable, and announced within seconds, from every run source.
- Issue/Feature IDs: ISS-001, ISS-002, ISS-017 (surfacing part) / FEAT-010, FEAT-011; JRN-2, JRN-5; UC-21, UC-22.
- Rationale: root cause of the mission complaint; server contract already works (EV-038) — only the read side is missing.
- User outcome: "Review it in your Inbox" is true. Architecture outcome: approvals/notifications have exactly one source of truth; the local approvals store carries only its own legacy items during migration.
- Affected: src/connectors/api.ts (add listApprovals(), use notifications()), src/screens/Messages.tsx (Approvals + Inbox tabs), src/store/useStore.ts (hydrate set + badge counts), Shell nav badge, src/screens/Dashboard.tsx "Needs you" card; server: none (GET routes exist).
- Slices: (1) api.listApprovals + Approvals tab renders server pending/decided with decide wired to POST decide → verify live park→approve→complete through the UI; (2) unread server notifications merged into Inbox timeline + mark-read; (3) nav badge + Dashboard "Needs you" fed by the same selectors; (4) remove local-store read for approvals (keep write mirror during deprecation window).
- Design/content: approval card keeps existing ApprovalCard layout; source chip ("from chat", "scheduled"); expiry countdown.
- State/API/data: no schema change; polling piggybacks existing loop until WP-009.
- A11y/responsive/security/perf: cards keyboard-decidable; badge has aria-label; decide stays CSRF-gated; no extra polling endpoints beyond the two lists.
- Dependencies: none.
- Acceptance criteria: with a run parked from (a) chat and (b) a schedule with the browser closed then reopened, Messages→Approvals shows the pending card ≤5 s after open, badge ≥1; Approve resumes to completed and the chat thread gains the run_result; homeops.send_notification_draft(In-App)→ replaced flow (WP-002) lands an Inbox row with unread badge; zero references to `data.approvals` in Approvals tab render path.
- Validation: new Playwright spec tests/topgun/web (park→see→approve→complete); unit for selector merge.
- Risk: low — additive reads. Rollback: feature-flag the tab's data source.
- Sequence: 1.
- Effort: M.

## WP-002 — Honest delivery: delivers-flag semantics + chat-reachable delivery

- Objective: "delivered" is said only when something was delivered; a plain chat ask can actually deliver at least in-app without setup.
- Issue/Feature IDs: ISS-003, ISS-004 / FEAT-011, FEAT-012, FEAT-036; UC-4, UC-14, UC-21, UC-22.
- Rationale: false-success at the summary layer + the only real delivery tool unreachable from the primary surface (EV-032 §3).
- User outcome: chat says "drafted — review it here" vs "delivered to X" truthfully. Architecture outcome: delivery capability is a declared tool contract, not a name regex.
- Affected: server/internal-functions.mjs (add `delivers:true` to notify_contact; new In-App direct write or extend send_notification_draft with deliverInApp), server/providers.mjs + connectors.mjs (delivers flags on gmail.send/sms.send/etc.), server/assistant-runs.mjs:40-86 (summarizeOutcome uses flags; draft wording + link), server/index.mjs:2886-2951 or orchestrator.runAssistantPlan (attribute chat runs to `agt_household`, auto-provisioned per household), planner ASSISTANT_SYS catalog descriptions (draft vs deliver distinction).
- Slices: (1) delivers-flag + summarize rewrite + unit tests; (2) chat-run agent attribution via runAssistantPlan (single choke point) + policy clamp respected; (3) in-app delivery fallback when notify_contact has no method: write real notification to requester + honest "delivered in-app; add a verified contact method for email/SMS"; (4) run_result links drafts to their artifact (pairs with WP-004).
- Acceptance criteria: fence-sign-off repro says "1 step drafted (review), nothing sent externally"; "send me a note saying hi" from chat produces a visible Inbox notification (with WP-001) and run_result "delivered in-app"; summarizeOutcome unit table covers draft/notify/gmail/sms/toolless; no step with delivers:false ever counted in "delivered N steps".
- Validation: unit + the two chat E2Es; regression: UC-20 clean path still "finished (2/2)".
- Risk: medium (attribution changes touch policy paths — keep clamp visible-skip semantics). Rollback: flag `HOMEOPS_CHAT_AGENT_ATTRIBUTION=off`.
- Dependencies: WP-001 for visible assertions.
- Sequence: 2. Effort: M.

## WP-003 — One run world: unify histories, statuses, and the plan card

- Objective: every run, from every source, appears in one history with one status vocabulary; a plan that auto-started can never be started twice from its card.
- Issue/Feature IDs: ISS-005, ISS-009, ISS-011, ISS-016 / FEAT-013, FEAT-015, FEAT-016.
- Affected: src/store/useStore.ts (retire local runs store: list from GET /api/runs; keep runFromServer as pure mapper with full status enum), src/screens/Automations.tsx Run History, Agents Run History tab, Assistant plan card (hide Run button when runId present; show attached run chip), server/index.mjs:2957 (persist user turn before startRun) or client timestamp sort.
- Slices: (1) status-label map fix (waiting_for_connector → "Needs a connection" + CTA; waiting_for_approval → "Needs approval" + CTA); (2) Run History reads /api/runs for both screens; (3) plan-card double-run guard; (4) thread-order fix (persist user turn pre-run); (5) recents dedupe/labeling for error threads.
- Acceptance criteria: runs started via chat, agent Run now, and POST /api/runs/start all appear in Automations→Run History and agent Run History with identical status text; parked-cause labels differ correctly (EV-009 scenario shows "Needs a connection"); a plan card with runId renders no Run button; new thread order is user→answer→status; error-only threads are labeled and not duplicated in recents.
- Validation: Playwright multi-source run listing test; component tests for mapper.
- Risk: medium (store refactor); Rollback: keep legacy store behind flag for one release.
- Dependencies: WP-001 (badge selectors reuse).
- Sequence: 3. Effort: L.

## WP-004 — Results have homes: tasks surface + artifacts library + deep links

- Objective: everything a run produces is reachable within two clicks; "Done" always links to the thing.
- Issue/Feature IDs: ISS-008, FEAT-019 gap / FEAT-005; UC-11, UC-18, UC-20.
- Affected: new Tasks surface (either a To-dos tab in Household Spaces or auto-provisioned Chore Board mini app fed by data.tasks — decide in-slice with existing design system), src/screens/FilesKnowledge.tsx (read /api/artifacts into Knowledge Library with kind filters: run summaries, drafts, decisions), run_result messages carry links ("View task", "Review draft").
- Slices: (1) artifacts in Files & Knowledge (server route exists); (2) tasks surface + dashboard "Needs attention" includes undated open tasks section; (3) run_result deep links.
- Acceptance criteria: after UC-20 repro, the task and the list item are visible from Home ≤2 clicks and the chat result links to them; the fence-day draft is visible under Files & Knowledge with kind=notification-draft (EV-019 scenario now non-empty); knowledge count reflects artifacts.
- Validation: extend the UC-20 E2E; snapshot tests.
- Risk: low. Sequence: 4. Effort: M.

## WP-005 — Helper Agents unification (redesign A)

- Objective: ONE user-facing "Helper Agents" surface; an agent is a package (instructions + skills + automations/triggers + tools/functions + memory + history) created/managed in one place; Skills/Functions/Workflow builders become advanced editors of the same package; template catalogs merge.
- Issue/Feature IDs: ISS-013 (+ ISS-005 groundwork) / FEAT-013, FEAT-015, FEAT-032, FEAT-033; PI-009.
- Affected: src/screens/Agents.tsx (becomes the hub: package view, capability chips, triggers inline, run history via WP-003), Automations.tsx (recurring/trigger management folds into agent detail "Schedule" + a lean cross-agent "Schedules" view), SkillBuilder/FunctionBuilder reachable from agent detail Advanced; src/data catalogs merged into one packaged-template catalog (12 agent + 23 automation + 20 dashboard templates deduped); server: agent packaging metadata (agent.skillIds/allowedToolIds/triggerIds already exist — add packageVersion), migration script mapping resident 18 agents + 16 playbooks + 13 skills + 4 functions + 3 triggers into packages (playbooks become agent instructions/recipes).
- Slices: (1) IA change behind a flag: nav collapses to Helper Agents (+ Schedules under it); (2) packaged template catalog (single source) powering New Agent; (3) agent detail absorbs triggers + capabilities editing; (4) migration script (dry-run report first) for resident data; (5) retire standalone Automations nav for non-advanced users.
- Acceptance criteria: a new user can create, schedule, run, and inspect a helper without leaving Helper Agents; nav shows one entry (plus Advanced reveals); the resident tenant's 51 fragments migrate to ≤20 packages with a printed mapping report and zero orphaned triggers; every 22-UC skill remains invocable post-migration.
- Validation: migration dry-run diff on a COPY of resident data (never in place), full nav Playwright audit, UC skill invocation smoke.
- Risk: high (IA + data migration). Rollback: flag off restores old nav; migration runs on copied data until sign-off.
- Dependencies: WP-003 (one run world), WP-001.
- Sequence: 5. Effort: XL.

## WP-006 — Orchestration harness rebuild to the 22-UC bar (redesign B)

- Objective: one orchestration entry (chat, agent, schedule, webhook all → orchestrator with attribution) reliably passing the 22-use-case benchmark through the UI, with the benchmark encoded as an executable suite.
- Issue/Feature IDs: ISS-004 (attribution), HYP-003/004/005 / FEAT-007, FEAT-016, FEAT-031; all UC rows.
- Rationale & path comparison (per mandate, two paths): (a) full from-scratch engine rewrite — rejected: the durable engine's approval/idempotency/recovery core is sound and battle-commented (EV-032/038; DEC-012); (b) rebuild the ORCHESTRATION LAYER (entry unification, plan quality, catalog pruning, repair loop) on top of the engine — chosen. User authorized from-scratch; this scopes "from scratch" to the layer that is actually broken.
- Affected: server/orchestrator.mjs (single entry API: orchestrate({source, goal|plan|skillId, session, agentId})), index.mjs assistant routes call it, planner catalog compaction for local models (prune to agent-permitted tools + top-N relevant by keyword), per-run repair budget already exists (keep), benchmark: tests/topgun/usecases/*.spec.ts — one UI-level spec per UC (22 files) with a connector sandbox mode (mock Google/MS/Slack endpoints behind net.mjs allowlist) so gated UCs are testable without real OAuth; a `HOMEOPS_CONNECTOR_SANDBOX=1` server mode.
- Slices: (1) orchestrate() choke point + attribution (with WP-002 slice 2); (2) catalog pruning + local-model prompt budget (HYP-005 probe); (3) sandbox connector layer; (4) UC specs 16/17/19/20/22 (runnable-now set) green; (5) UC specs for internal-broken set green after WP-001..004; (6) gated UC specs green under sandbox; (7) reliability soak: 3 consecutive green runs of the full suite.
- Acceptance criteria: `npm run topgun:usecases` runs 22 specs; pass gate = every UC either green or SKIPPED with a printed named external blocker (real OAuth absent) while its sandbox twin is green; chat/agent/schedule all route through orchestrate() (grep-enforced: no direct startRun from index.mjs assistant routes); benchmark suite green 3× consecutively on Windows dev host.
- Validation: the suite itself + soak; latency histogram recorded per UC.
- Risk: high (breadth). Rollback: orchestrate() delegates to legacy paths behind a flag.
- Dependencies: WP-001..004; WP-012 for any real-credential UCs.
- Sequence: 6. Effort: XL.

## WP-007 — Memory subsystem redesign: Supermemory + local LM Studio (redesign C)

- Objective: replace flat recency memory with retrieval-quality memory (hybrid search + profiles) running fully local, compatible with LM Studio Qwen3.6-27B.
- Issue/Feature IDs: ISS-006 (dependency), FEAT-018 / PI-011; UC-18, UC-22; DEC-014.
- Affected: NEW server/memory-provider.mjs (Supermemory client: add/search/profile with containerTag=householdId; health check), server/internal-functions.mjs write_memory dual-writes (tenant memory.json + Supermemory) during migration, planner.buildServerContext recentMemory → profile+search results, src/screens/ActivityMemory.tsx Memory tab gains search + profile card, Settings AI providers: API-key field for local providers (ISS-006 fix: UI + ai.mjs lmstudio needsKey stays false but keyOptional:true), scripts: memory migration (export memory.json → Supermemory add loop), supervisor to launch `npx supermemory local` alongside dev (scripts/dev.mjs opt-in like browser-runtime).
- Slices: (1) ISS-006 token field + verified LM Studio health/chat with real token; (2) Supermemory sidecar boot + health surface in Settings; (3) write path dual-write + migration script (idempotent, dry-run first); (4) read path: planner context uses profile() + search(goal) with fallback to legacy list when sidecar down (disclosed in context); (5) Memory tab search UI.
- Acceptance criteria: with LM Studio token set, Test connection shows reachable+models (EV-035 scenario passes); memory search "fence" returns the fence-day fact after the UC-18 flow; planner context includes profile facts (observable in a debug endpoint) with sidecar up, and honestly notes degraded recall with it down; full flow works with zero cloud calls (network-observed); resident memory migrates with row-count parity report.
- Validation: integration tests against a live local sidecar; offline-mode test (sidecar killed mid-run → honest degradation, run still completes).
- Risk: medium (new sidecar on Windows; Qwen latency HYP-005). Rollback: provider flag reverts to legacy memory reads; dual-write means no data loss either direction.
- Dependencies: ISS-006 fix (slice 1); WP-006 slice 2 for prompt budget.
- Sequence: 7 (slice 1 can land with WP-001 wave). Effort: L.

## WP-008 — Improvements safety: diff, revert, default-off, and the SAFE WIPE

- Objective: the self-improvement loop becomes reviewable and reversible; the user's "uncertain improvements" are individually addressable; the opt-in wipe executes with backup-first.
- Issue/Feature IDs: ISS-007, HYP-002 / FEAT-014; DEC-015.
- Affected: src/screens/ActivityMemory.tsx Improvements tab (before/after diff from agent_versions/skill_versions, Revert button), server: evolution records store beforeVersionId at apply time (engine.mjs:807-826), revert endpoint (restore prior version via existing version stores), Settings default autoApproveImprovements=false for new households + explicit banner for existing.
- SAFE WIPE plan (opt-in menu item 9): (0) full tenant backup via existing backup.mjs export; verify bundle opens; (1) dry-run report: list 21 evolution records, mark the 15 accepted with their target agent/skill and whether a prior version exists; (2) selective revert of auto-approved instruction/planner_guidance changes to pre-apply versions (keep human-accepted ones unless user opts otherwise); (3) archive (not delete) evolution rows to evolution_archive; (4) print before/after diff summary; (5) rollback path = re-import step-0 backup. No deletion of version history ever.
- Acceptance criteria: every accepted improvement shows a diff; Revert restores the prior version and is itself audited; wipe dry-run report generated and approved before any mutation; post-wipe, agents' instructions match their last human-authored versions and all 22-UC skills still invoke.
- Validation: unit on revert; dry-run diff review; UC smoke after wipe.
- Risk: medium (data surgery) — mitigated by backup-first + archive-not-delete. Sequence: 8 (dry-run report can run any time, read-only). Effort: M.

## WP-009 — Sync hygiene: rev-gated hydration, backoff, SSE deltas

- Objective: idle app ≤1 request/10 s; changes still visible ≤5 s.
- Issue/Feature IDs: ISS-010, HYP-006 / FEAT-020.
- Affected: src/store/useStore.ts hydrate loop (rev check短-circuit, visibility backoff), server /api/rev semantics audit, optional SSE /api/changes stream.
- Acceptance criteria: network trace of 60 idle seconds shows ≤6 requests; a server-side task insert appears in UI ≤5 s; no functional regressions in the WP-001 badge freshness.
- Validation: before/after HAR comparison in the E2E suite. Risk: low. Sequence: 9. Effort: M.

## WP-010 — Web access & roles: household-scoped profiles, child session, privacy flag

- Objective: a signed-up family can profile-switch on web; child role usable; resident-name exposure controllable.
- Issue/Feature IDs: ISS-012, ISS-015 / FEAT-002, FEAT-023, FEAT-026; JRN-3.
- Affected: src/screens/Lock.tsx + session plumbing (last-household profile list, per-profile PIN rules), server /api/profiles (household-scoped variant + privacy flag).
- Acceptance criteria: sign-out from a 2-member household offers both profiles; Kid Tester session gets childAiGate behavior (chat refuses with the kid-friendly message) and cannot see Approvals decide buttons; with privacy flag on, pre-auth screen shows no profile names (EV-025 scenario).
- Validation: 2-member Playwright E2E; JRN-3 unblocks and completes. Risk: medium (auth surface — no weakening of PIN/password gates). Sequence: 10. Effort: M.

## WP-011 — Trust & lifecycle polish

- Objective: family-readable activity feed; parked-run lifecycle completeness.
- Issue/Feature IDs: ISS-014, ISS-017 / FEAT-017, FEAT-016.
- Affected: ActivityMemory presentation mapping (raw behind Advanced), engine expireStaleRuns adds connector-parked TTL (default 7 days) with honest notification (via WP-001 inbox), retro sweep as part of WP-008 wipe or standalone.
- Acceptance criteria: non-advanced Activity shows only templated plain-language lines; a connector-parked run expires after TTL with an Inbox notice and shows "expired — needed Google connection"; resident tenant's 7 stuck runs surfaced with resume/expire choices (proposal only until user confirms).
- Validation: unit on sweeper; snapshot on feed. Risk: low. Sequence: 11. Effort: S-M.

## WP-012 — Connector provisioning for the gated 13 use-cases

- Objective: the OAuth/device-gated UCs become configurable (real) and testable (sandbox).
- Issue/Feature IDs: DEC-016; UC-1..10, 12, 13, 14 / FEAT-027.
- Affected: docs + Settings guidance per provider (Google OAuth app with gmail.send scope — user action; Microsoft/Slack/Dropbox app registrations — user action), Twilio config, re-enable http connector (resident revoked), sandbox mode from WP-006 slice 3 for CI.
- Acceptance criteria: each gated UC has (a) a named real-credential setup checklist surfaced in Connections and (b) a green sandbox spec; UC-14 delivers a real SMS only after user-supplied Twilio credentials and explicit user go-ahead (external send authorization stays with the user).
- Validation: sandbox suite; real-credential smoke deferred to user-authorized session. Risk: low code / external dependency high. Sequence: 12. Effort: M (code) + user provisioning.
