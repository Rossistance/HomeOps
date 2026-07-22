# Architecture and Authority Map — run-20260721-054151

Product morphology: client-server web app (Vite+React+TS SPA in src/, Node 22+ ESM backend in server/ using node:sqlite per-tenant DBs) with an Expo mobile sibling (apps/mobile) and a local-first heritage client store (zustand + IndexedDB). AI-assisted, approval-gated, multi-tenant ("household") system.

## Modules and boundaries

- Web client `src/`: screens (18), `store/useStore.ts` (~2 kLoC zustand store: local collections + partial server sync), `connectors/api.ts` (typed backend client). Evidence: EV-002 (nav), EV-034.
- Backend `server/index.mjs` (~3.5 kLoC router) + modules: `planner.mjs` (LLM planning/assistant/evolution prompts), `engine.mjs` (durable run executor), `orchestrator.mjs` (skill/agent→plan→run), `agents.mjs` (policy/clamp), `skills.mjs`, `functions.mjs` (registered functions), `internal-functions.mjs` (homeops.* tools), `triggers.mjs` (scheduler), `notify.mjs` (delivery), `connectors.mjs`/`providers.mjs` (tools), `accounts.mjs`/`oauth.mjs` (per-actor OAuth), `ai.mjs` (provider adapters), `store.mjs` (sync facade) over `tenant-db.mjs` (SQLite per household), `auth.mjs`/`identity.mjs`/`tenant-context.mjs` (sessions/tenancy). Evidence: EV-028, code reads.
- Browser-runtime sidecar (`server/browser-runtime`, :9223) for Browser Automation connector. Evidence: EV-028.

## Data flow and state ownership

- AUTHORITY (server, per-tenant SQLite): runs, run steps, approvals, notifications, conversations+messages, artifacts, memory, agents/skills/functions/playbooks, triggers, members, events, tasks, meals, settings, connector configs + secrets (vault key at .data/key), audit.jsonl. Evidence: EV-031, tenant-db.mjs.
- SHADOW (client zustand/IndexedDB): its own approvals, runs, threads, agents, spaces… partially hydrated from the server via a ~1 s polling loop over TEN endpoints (events, tasks, members, conversations, memory, agents, contact-methods, household, files, knowledge). NOT hydrated: approvals, notifications, runs list, artifacts, triggers. Evidence: EV-030, EV-032.
- The client "mirror" for server approvals exists only inside `syncServerRun` (useStore.ts:1107-1153) and runs only for console-started agent/automation runs — not for chat-born or scheduled runs (ISS-001).
- Conversations are server-owned when online (created via POST /api/conversations); chat turns persist server-side post-stream (index.mjs:2957) — ordering race with engine hooks (ISS-009).

## API/event/IPC/persistence relationships

- REST-ish JSON under /api (single router in index.mjs), session cookie + x-homeops-csrf on mutations; SSE for /api/assistant/stream, /api/assistant/build/stream, /api/runs/:id/events.
- Chat pipeline (observed live): POST /api/assistant/stream → planner.assistantStream (provider call) → kind:plan → engine.startRun (index.mjs:2939-2951, sourceRef {conversationId, via:"chat"}, NO agentId) → driveRun executes steps (internal/connector/provider/function tools; reasoning steps via provider) → approval gate parks run + createApproval + pushApprovalNotification (Expo only) + onRunParked → conversation status message. Decide: POST /api/approvals/:id/decide → resumeRun → consume-once approval (input-hash bound) → execute → complete → onRunFinished → run_result message (+ save-as-helper offer / self-repair on failure). Evidence: EV-029, EV-032, EV-038.
- Agent/automation pipeline: UI Run → POST /api/runs/start | /api/agents/:id/run → orchestrator.runAgent/runSkill → policy clamp (visible skips) → same engine. Triggers (schedule/recurring/webhook/connector_event/manual) fire runAgent/runSkill server-side with tz-anchored scheduling. Evidence: EV-032 §6, EV-039.
- Divergence seam: orchestrator.runAssistantPlan (would attribute agt_household) is BYPASSED by both assistant routes → chat runs are agent-less → notify_contact refuses them (ISS-004).

## Integrations and background work

- Local connectors live by default: Weather, Webhook Receiver, Local Files, Web Search & Reading (+ Browser Automation via sidecar). Gmail/Calendar/Drive via per-actor Google OAuth (resident tenant has 1 healthy Google account, EV-031). Microsoft 365/Slack/Dropbox/Notion/Todoist/TickTick/Alexa/Google Home: "Setup by admin — Not configured by deployment" (EV-020) — hence 13/22 use-cases inactive.
- Background: trigger scheduler tick, expireStaleRuns sweeper (approval-parked + stalled running only; connector-parked runs never expire — ISS-017), run recovery on boot (at-most-once, idempotency keys), backups (backup.mjs; resident lastBackupAt 2026-07-20).
- AI providers (ai.mjs): openai/anthropic/gemini/compatible/ollama/lmstudio; per-tenant config in connectors.json; active provider per household settings; fallback chain providerChatWithFallback. LM Studio currently 401 (ISS-006). Resident tenant: openai gpt-5.5 healthy (EV-031).

## Auth, tenancy, and permissions

- Tenancy: one SQLite dir per household under server/.data/tenants (local = resident/legacy, _system = identities/sessions). Deleting a household = deleting a directory; local/_system protected. Evidence: tenant-db.mjs:306-313, EV-031.
- Sessions: cookie-based; roles Owner…Guest; childAiGate blocks AI for child roles; approvals carry allowedApproverRoles; canApprove enforced server-side (GET /api/approvals filters visibility). Evidence: EV-032 §2, index.mjs:1007-1014.
- Server-authoritative requiresApproval per tool (client input never decides), consume-once approvals bound to input hash; risk overrides per household are audited. Evidence: engine.mjs:594-660.
- Web profile picker enumerates ONLY the resident household (ISS-012, EV-027).

## Deployment, offline, and sync assumptions

- Local dev: scripts/dev.mjs (backend :8787 pinned, vite :5173, optional browser-runtime). NODE_EXTRA_CA_CERTS handled for TLS-intercepted networks. Evidence: EV-028.
- Hosted: Render service "homeops-ai" auto-deploys from main (historical memory; not verified this run — labeled historical). Env bootstrap can seed cloud AI keys for the resident household (ai.mjs:109-128).
- Offline/local-first: copy still promises "everything stays on this device" (EV-001) while runs/approvals/notifications are server-only — the load-bearing contradiction (PI-006).
- Drift note: audited source = commit 568c51f dirty-clean; the live dev instance was built from this working tree, so source/runtime parity holds for this audit. Production parity NOT verified (out of scope). Node engine declared `>=22.13 <25` vs host v25.8.2 (works; engines field stale).
