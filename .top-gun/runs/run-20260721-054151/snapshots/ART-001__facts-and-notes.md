# Facts and Notes — Mission Handoff

- Run: run-20260721-054151
- Goal: Fix FamiliOS end-to-end task execution on web: root-cause why no task completes start-to-finish (agent vs automation subsystem conflict, nothing written to the inbox); consolidate to ONE user-facing 'Helper Agents' entry pre-packaged with correct tools/skills/automations; evaluate and safely retire uncertain in-flight 'improvements' that may be causing breakage; rebuild the chat+agent orchestration harness toward OpenClaw/Hermes-level reliable task execution across all agents; redesign the memory subsystem (candidate: self-hosted Supermemory, https://supermemory.ai/docs/self-hosting/overview) with local LM Studio Qwen3.6-27B-GGUF compatibility; run a full screenshot-led end-to-end discovery of every page/element/feature to ground the spec; produce spec + docs. Directive: /top-gun fable 5 high.

## Mission and boundaries

- Success criterion (user's words): user says "hey can you do this" → the system replies "done, as you requested" — and it is actually done. One task, end to end, verifiably.
- Deliverables this mission: (1) root-cause diagnosis of the E2E execution failure, grounded in screenshot-led discovery of every page/feature; (2) spec + docs for the rebuilt chat/agent harness, single "Helper Agents" surface, and memory-subsystem redesign; (3) implementation of the selected scope after the numbered menu.
- Non-goals: native iOS visual work (DEC-10 in prior run postponed it); shipping to TestFlight is not in this mission's core ask.
- User authorized: rebuilding the chat+agent harness from scratch; replacing the memory brain (Supermemory self-hosted is a candidate, not a mandate — user explicitly delegated model/tool choice: "if you think it is helping then go ahead and implement it"); wiping/clearing the "improvements" data IF audit shows it is safe (user is unsure what applied — treat as investigate-then-propose, not blind wipe).
- User frustration context: repeated prior missions claimed success (last run recorded COMPLETE, 362/362 tests, TestFlight build 22) yet the user still cannot run a single task end to end on web. Test-passing ≠ feature-working is the central credibility gap; verification this mission must be UI-observed, not test-suite-only.

## Observed facts

- Project root: D:\FamiliOS\FamiliOS (git repo; outer D:\FamiliOS is not a repo). Vite+React+TS web app (src/), Node ESM server (server/*.mjs), Expo mobile app (apps/mobile), Playwright E2E harness (tests/topgun/).
- Prior run run-20260720-225249 phase-state: COMPLETE at 2026-07-21T01:17:16Z claiming "9 active use-cases built+verified, 13 inactive specced, committed/pushed/deployed, TestFlight build 22". User's report contradicts the user-facing outcome.
- git log heads: 568c51f (household timezone), fd15f92 (per-use-case criteria docs), f7558e0 (9 active use-cases), dfed14f (Ask Famili false-success fix). Working tree dirty only with .top-gun files + "automations and agents.txt" (identical to prior run's source-use-cases.txt; diff clean).
- Key server modules: engine.mjs, orchestrator.mjs, planner.mjs, assistant-runs.mjs, agents.mjs, triggers.mjs, notify.mjs, internal-functions.mjs, skills.mjs, providers.mjs, seed.mjs, ai.mjs, store.mjs, tenant-db.mjs.
- "Inbox" in-app = notifications/approvals surface: assistant-runs.mjs:205 writes approval-wait messages "Review it in your Inbox"; user reports nothing gets written there.
- "Improvements" feature exists across src/screens/{Settings,Automations,Dashboard,ActivityMemory,Agents}.tsx, src/store/useStore.ts, src/connectors/api.ts, src/types/index.ts, src/data/workflowTemplates.ts — user cannot tell which improvements were applied; suspects breakage.
- Agents vs Automations vs Workflows vs Skills vs Functions are separate concepts across src/data/{agentTemplates,workflowTemplates,playbooksCatalog,seed}.ts and server seed.mjs — the fragmentation the user wants collapsed into one "Helper Agents" surface.
- "52 Agents": no literal "52 agent" string in repo. Count must be established from live server data / seed catalogs during audit (agentTemplates.ts + seed data + spike data-copy shows many agents incl. "Inbox Helper Agent").
- AI provider layer (server/ai.mjs) already supports LM Studio (openai-style, http://localhost:1234/v1, model discovery); net.mjs allowlists loopback for local providers; readiness tests exist. Historical audit.jsonl shows lmstudio health ok:false on old checks — current health unknown.
- Server data: per-tenant DBs under server/.data/tenants (tenant-db.mjs); stray *.json.tmp files in server/.data (idempotency, jobs, routing, runs ~1.9MB, skills) — legacy pre-migration artifacts, .migrated marker present.
- Scripts: npm run dev (scripts/dev.mjs runs server+vite), server on node server/index.mjs, topgun:web Playwright suite, typecheck, test (node --test server/test).
- Memory (auto-memory, historical): Ask Famili false-success bug fixed 2026-07-20 but real email delivery still blocked on user reconnecting Google with gmail.send scope; Render service "homeops-ai" auto-deploys from main.

## Supported inferences

- The COMPLETE verdicts of prior runs were test-anchored, not user-journey-anchored; the failing layer is most likely the runtime wiring between chat-created agents, the trigger/scheduler (triggers.mjs), the run engine (engine.mjs/orchestrator.mjs/assistant-runs.mjs), and the notifications/inbox write path (notify.mjs + store) — since the user sees "good things happening" but no inbox entries and no completed tasks. Basis: user report + assistant-runs.mjs inbox-message code existing but reportedly never firing.
- "Conflict between agents and automation" plausibly = two parallel execution paths (agent runs vs automation/workflow runs) racing or shadowing each other, so runs start under one subsystem and complete (or stall) invisibly in the other. Basis: separate agents.mjs/engine.mjs/orchestrator.mjs/assistant-runs.mjs modules plus separate client-side agents/automations/workflows stores.
- The stray .tmp files in server/.data indicate at least one interrupted atomic-write in the legacy store; per-tenant migration happened later, so they are probably inert — but the same write pattern may still be failing silently in tenant DBs. Needs check, not assumption.

## Unknowns and open questions

- Which "improvements" records exist in live tenant data and whether any half-applied improvement corrupts agent/automation state → check tenant DB contents + Improvements UI via browser.
- Actual agent count (user says 52) and how many are chat-built vs seeded vs template → query live server /api state during discovery.
- Whether LM Studio (Qwen3.6-27B) is currently reachable and what latency/context limits it imposes on planner/orchestrator prompts → health-check during audit.
- Where exactly the inbox write fails: trigger never fires? run never starts? run starts but notify.mjs write fails? approval gate swallows it? → instrument one E2E task while watching server logs + network + UI.
- Supermemory self-hosting requirements (it is open source; docs at supermemory.ai/docs/self-hosting/overview) vs current memory implementation (ActivityMemory screen, server memory functions) → web research + repo read during audit.
- What OpenClaw/Hermes-level means operationally for this codebase (user references earlier-built task benchmarks) → define measurable pass/fail criteria in PRD from the 22 use-cases as the benchmark suite.

## Authority and safety limits

- Local repo edits: allowed. Commit/push/deploy: only after explicit user selection/confirmation (push triggers Render auto-deploy — shared state).
- Destructive data actions (wiping improvements, deleting agents/tenant data): PROPOSE in the menu with a backup-first plan; do not execute during audit. Audit is read-only + screenshots + a disposable local dev instance.
- External sends (email/SMS/Slack): forbidden during audit; use dry-run/approval-gated paths only.
- Google reconnect (gmail.send) is a user-only action; treat as external gate where relevant.

## Capability inventory summary

- Use now: Bash/PowerShell, Read/Write/Edit/Glob/Grep; git; node 22 + npm scripts; python 3.14 (top-gun/mem scripts verified working); Playwright MCP (mcp__plugin_playwright_playwright__*, loaded via ToolSearch) — primary web runtime driver for screenshot-led discovery; Claude Browser pane (preview_start + navigate/read_page/computer) as secondary; chrome-devtools MCP for perf/console deep-dives; Agent tool with top-gun:audit-lead / matching-lead / implementation-lead; WebFetch/WebSearch (deferred, loadable) for Supermemory research; context7 for library docs.
- Use if needed: Workflow tool (multi-agent fan-out; user's top-gun directive covers orchestration), Render MCP-less deploy via git push (existing auto-deploy), scheduled-tasks MCP.
- Unavailable/blocked: many claude.ai connectors need OAuth (not needed for this mission); no gh CLI (use git credential fill per environment memory); NODE_EXTRA_CA_CERTS needed for node CLIs on this Windows host (see memory windows-tls-and-cli-environment).
- Model directive: leads run on Fable 5 (claude-fable-5) at high effort per user's "/top-gun fable 5 high".

## Artifact links

- ART: facts-and-notes.md (this file) — registered as snapshot on completion.
- Prior-run evidence (historical, label as such): .top-gun/runs/run-20260720-225249/{audit/master-report.md, phase-state.md, implementation/}.

## Next discriminating checks

1. Live E2E repro: start dev server, create/run one simple task via Ask/chat UI, watch server log + network + Inbox — pinpoint the first silent failure (sharpest single check).
2. Trace the run pipeline in code: chat → planner.mjs → agents.mjs/assistant-runs.mjs → engine.mjs/orchestrator.mjs → triggers.mjs → notify.mjs/store — map every handoff and find where agent-path and automation-path diverge/conflict.
3. Enumerate live tenant data: agents (count vs 52), automations, improvements records, inbox/notifications — establish what actually exists vs what UI shows.
4. LM Studio health + model probe against localhost:1234/v1.
5. Screenshot-led full-surface crawl (every route in src/screens + Shell nav) with element interaction per convergent-360 S3.
6. Supermemory self-hosting research (docs + repo) → integration feasibility note vs current memory code.
