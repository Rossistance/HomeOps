# FamiliOS Brownfield PRD — Reliable End-to-End Task Execution on Web

Run: run-20260721-054151 · Source commit: 568c51f · Status: draft-for-selection · Every requirement traces to evidence IDs in audit/evidence-ledger.md and issues in audit/issue-register.md.

## 1. Problem statement and evidence

A user asks FamiliOS to do something and the system cannot be seen to finish it. Live repro (EV-032): a chat plan auto-executes server-side, parks on an approval, tells the user "Review it in your Inbox" — and both the Inbox and Approvals tabs render empty because the web client never reads the server's approvals (ISS-001), notifications (ISS-002), or artifacts (FEAT-019). After approval the summary claims "delivered 2 steps" for a run that only wrote a draft (ISS-003). Even a fully successful task write is invisible because no surface shows undated tasks (ISS-008). Resident-tenant data carries the scar tissue: 6 pending approvals, 6 expired runs, 7 forever-parked runs, 23 failures (EV-031). Prior "COMPLETE, 362/362 tests" verdicts measured the server world; the family lives in the web read-models that were never wired.

## 2. Target users and personas

Ross (owner-builder), Maya (busy parent), Noah (child view), Ellen (external recipient), Sam (scheduler) — cards and journeys in audit/journey-register.md. Primary journey: JRN-2 ("hey can you do this" → visibly done).

## 3. Current behavior and root cause

Two state worlds: a server-authoritative engine (runs/approvals/notifications/artifacts in per-tenant SQLite) and a local-first client console (zustand/IndexedDB) bridged by a partial one-second polling loop that omits exactly the collections that prove work happened. The only approval mirror runs on the legacy console path, not for chat or scheduled runs (useStore.ts:1093 vs 1255-1290). Chat runs carry no agent identity, so the sole real delivery tool refuses them (index.mjs:2890; internal-functions.mjs:448-451). Delivery is inferred from tool-name regex, so drafts count as "delivered" (assistant-runs.mjs:45). Full chain: audit/architecture-authority-map.md.

## 4. Goals, measurable success, non-goals

- G1: A user can watch one task go ask → run → (approval if gated) → done → visible result, entirely through the UI. Measure: JRN-2 Playwright spec green 3× consecutively.
- G2: Nothing user-facing ever claims delivery that did not happen. Measure: summarizeOutcome truth table unit suite; zero "delivered" strings for delivers:false steps.
- G3: The 22-use-case benchmark is an executable suite: every UC green, or green-in-sandbox with a named real-credential blocker. Measure: `npm run topgun:usecases` gate.
- G4: One helper surface: creating, scheduling, running, and inspecting a helper happens in Helper Agents alone. Measure: nav audit spec; task-completion click-count ≤2 from Home to any run result.
- G5: Memory recall is retrieval-grade and fully local. Measure: memory-search spec returns seeded facts; zero cloud calls in offline mode test.
- Non-goals: native iOS visual work (DEC-010); building OAuth apps for Microsoft/Slack/Dropbox on the user's behalf (user-owned, DEC-016); replacing the durable run engine (DEC-012: it is sound and kept).

## 5. Scope / out of scope

In: WP-001…WP-012 as specified in audit/work-packages.md. Out: mobile app parity work beyond shared API clients (HYP-007 first), TestFlight, deployment (S8 requires explicit authorization), real external sends during development (dry-run/sandbox only).

## 6. Chosen solution and rejected alternatives

- Read-model unification (WP-001/003/004) over patching the mirror: rejected mirror-patching because the bug class regenerates with every new run source (DEC-013).
- Orchestration-layer rebuild on the existing engine (WP-006) over full engine rewrite: the engine's approval/idempotency/recovery core observably works (EV-038); the entry/attribution/benchmark layer is what failed (DEC-012). The user's from-scratch authorization is honored at the layer that earns it.
- Supermemory self-host for memory (WP-007) over homegrown vector store or cloud memory: MIT, Node/TS stack fit, single-binary local, containerTag=householdId tenancy fit, explicit LM Studio support (EV-036, DEC-014). Fallback path defined (FTS5 hybrid) if the sidecar underperforms on Windows.

## 7. Target end-to-end user journey (the contract)

Maya types "Create a household task called 'Fix backyard fence' and add 'buy wood screws' to the weekend list." → chat answers "On it…", run card attaches live → steps run; any gated step raises an Inbox badge within 5 s; the Approvals card shows the REAL resolved input; Approve resumes it → run_result: "Done — task created (View task) and list item added (View list)" → both links open surfaces where the items are visible → the Friday-digest variant delivers in-app immediately and by email once a verified contact method + allowlist exist, saying exactly which happened.

## 8. UX/UI and content requirements (existing design system)

Keep the warm design system, PageHeader/Tabs/Card patterns, Calm Mode. New/changed: Inbox merged timeline (threads + notifications, unread badges); Approvals cards with source chip + countdown; run chips with cause-specific labels ("Needs approval" / "Needs a connection") and CTAs; plan cards without Run buttons once auto-started; Tasks surface (or default Chore Board) using existing list components; Files & Knowledge artifact kinds with filter chips; Improvements diff view (before/after monospace blocks) + Revert; profile picker listing the signed-in household's members. Content rules: never "delivered" without delivery; drafts say "drafted — review"; blocked says what to connect; all family-facing activity lines templated plain-language (raw behind Advanced Mode).

## 9. System states (required coverage)

Loading skeletons (existing); empty states (existing copy kept); success with links (new); invalid/unauthorized (unchanged role gates; child sees existing kid-friendly refusals); denied approval → run fails with honest text (existing, now visible); offline/backend-down → banner + read-only local data (existing backendOnline path); slow provider → streamed progress + 120 s budget (existing); retry (engine bounded retries, existing); cancellation (run cancel, existing; now reachable from unified history); undo: approval decisions are final (consume-once) — copy states it; recovery: restart-parked runs resume (existing recoverRuns); integration-unavailable → park with TTL + Inbox notice (WP-011).

## 10-13. Frontend, backend, data, integrations (delta view)

Frontend: api.ts gains listApprovals; notifications() gets callers; runs list becomes server-fed; hydrate loop rev-gated (WP-009). Backend: delivers flags; orchestrate() choke point; evolution beforeVersionId + revert endpoint; connector-parked TTL; profiles household-scoped variant; sandbox connector mode. Data: no schema breaks — additive fields (delivers, beforeVersionId, packageVersion), evolution_archive collection, Supermemory sidecar store (external, per-household containerTag), migration scripts all dry-run-first with printed reports; tenant backups precede any data surgery (backup.mjs). Auth/tenancy: unchanged gates; CSRF unchanged; no new unauthenticated surfaces (profiles flag reduces exposure). AI: LM Studio token field (ISS-006); catalog pruning for local models; provider fallback chain unchanged.

## 14. Performance and reliability budgets

Idle network ≤6 req/min per tab (from ~660); parked-approval visibility ≤5 s; chat first token ≤3 s with local model reachable; run step timeout stays 60 s; UC suite p95 per-UC ≤120 s in sandbox; sidecar memory search ≤300 ms p95 (Supermemory claims ~50 ms profiles — verify, EV-036).

## 15. Observability

Every delivery decision audited (existing appendAudit) plus new `notify.delivered_inapp`; benchmark suite emits per-UC latency+pass JSON artifact; rev/polling metrics logged in dev; Supermemory health in Settings runtime card.

## 16. Acceptance criteria per use-case (testable through the UI)

Executable spec per UC at tests/topgun/usecases/ucNN.spec.ts (WP-006). Pattern: seed sandbox state → drive the REAL UI (chat or agent) → assert visible outcome surface + server record + honest summary text. Concrete criteria: UC-1 label applied to sandbox school mail + Inbox notice names count; UC-4 digest delivered (sandbox email log) + run_result "delivered to Ellen (email)"; UC-11 overdue list rendered from tasks surface; UC-14 SMS sandbox log + morning text content includes weather+RSS titles; UC-15 GET/POST bridged with signed webhook + approval visible/decidable; UC-16 file downloaded to Local Files and listed; UC-17 recipe card with ingredients+steps+source link in chat; UC-18 memory searchable + artifact visible in Files & Knowledge; UC-19 event + checklist + driver + what-to-bring visible on Calendar/event detail; UC-20 task+list item+attachment visible and linked from run_result (LIVE-verified baseline EV-032§4); UC-21 meal plan + grocery list + calendar slots + sign-off approval card in Inbox + delivery per channel with per-channel truth; UC-22 transcript → memory rows + "recent inbox digest" renders a dashboard digest from real notifications. Full per-UC gating table: journey-register.md.

## 17. Validation plan

Unit (summarize truth table, anchors, revert), component (status mapper, approval card), integration (orchestrate() sources, Supermemory client, sandbox connectors), contract (api.ts vs routes for approvals/notifications/artifacts/runs), E2E (JRN-2 core spec, multi-source history, 2-member roles, 22-UC suite), migration (agent-package dry-run diff, memory row-parity, wipe dry-run), recovery (sidecar-down degradation, restart mid-run), regression (existing tests/topgun/web suite + server node --test stay green).

## 18. Implementation slices in dependency order

WP-001 → WP-002 → WP-003 → WP-004 (the truth-and-visibility vertical) → WP-006 slices 1-4 with WP-007 slice 1 (token) → WP-005 (unification) → WP-007 (memory) → WP-008/009/010/011 → WP-012 + WP-006 slices 5-7 (benchmark closure).

## 19. Rollout, compatibility, migration, rollback

Feature flags per WP (nav unification, chat attribution, data-source switches); migrations dry-run-first on copies with printed reports; tenant backup before any resident-data mutation; version stores are never deleted; every WP defines its rollback in work-packages.md; deployment to Render only on explicit user authorization (S8).

## 20. Risks, assumptions, open questions, definition of done

Risks: IA migration breadth (WP-005), Qwen3.6-27B latency (HYP-005), Windows sidecar stability (DEC-014 fallback). Assumptions: user supplies LM Studio API token; user provisions OAuth apps for gated UCs or accepts sandbox verification. Open: HYP-002 (per-record improvement diffs), HYP-006 (rev semantics), HYP-007 (mobile consumers). Definition of done: G1–G5 measures green + audit issue register P0/P1 rows closed with linked evidence + JRN-2 completable by a first-time user with no console, no API calls, and no explanation.
