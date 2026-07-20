# Architecture and Authority Map — run-20260720-073025

Scope: the Ask Famili chat→execution chain at HEAD c0c4596 (mission scope per ART-003).

## Modules and boundaries

- Backend: single Node HTTP server `server/index.mjs` (~3.2k lines, route switch) + per-domain modules. Canonical runtime: `orchestrator.mjs` → `engine.mjs` (durable runs). Brain: `planner.mjs` (assistant/planner prompts) over `ai.mjs` (real provider adapters incl. local Ollama). Registries: `agents.mjs`, `skills.mjs`, `triggers.mjs`, `functions.mjs`/`internal-functions.mjs`, `connectors.mjs`, `providers.mjs`. Delivery: `notify.mjs`. Store: per-tenant SQLite (`store.mjs`, `tenant-db.mjs`). (EV-020, file inventory)
- Clients: Expo mobile (`apps/mobile`, Ask screen `(ask)/index.tsx`, run watch `run-context.tsx`) and Vite web (`src/`, `Assistant.tsx`) — both thin observers of server state at HEAD. (EV-021, EV-022)

## Data flow and state ownership

- Chat turn: client → `POST /api/assistant[/stream]` → `assistantRespond/assistantStream` (server-built context, tool catalog, history) → JSON envelope kind answer|lookup|plan|build. Plans AUTO-EXECUTE via `startRun` (source "assistant", sourceRef.conversationId); builds wait for explicit confirm. (EV-025, EV-023)
- Build confirm: client → `POST /api/assistant/build` → `materializeBuild` → `createSkill` + `createAgent` (tools derived from skill steps) + `createTrigger` (target = `{kind:"agent", agentId, params}` fallback — **skill/goal lost here**, EV-001/EV-002) → `persistBuildOutcome` appends "Done — I set up …".
- Scheduling: `setInterval(tick, 10s)` per tenant (index.mjs:3244); `tick` fires due triggers exactly-once → `fireTrigger` → `runAgent`/`runSkill` as actor "scheduler" or the personal agent's owner. (EV-003)
- Run: `startRun` freezes steps (server-authoritative requiresApproval) → `_drive` loop: reasoning steps (toolId:null) via LLM (vacuously succeed, EV-005); tool steps resolve→fill input→approval gate→execute; parks on approval/connector; run_finished hooks append chat run_result (only for terminal statuses, EV-008).
- Conversations: server-owned; turns, build cards, run results persisted. (EV-025)

## API/event/IPC/persistence relationships

- Key routes: /api/assistant[,/stream], /api/assistant/build[,/stream], /api/runs[,/start,/:id], /api/triggers[,:id,/fire], /api/agents, /api/skills, /api/notify, /api/approvals, /api/conversations. All gate() sessioned + CSRF; role-gated (build = Adult Admin+). (EV-016, EV-025)
- Engine events: per-run EventEmitter + onRunFinished hooks (assistant-runs.mjs). Expiry sweep does NOT fire the finished hooks for approval-expired runs (EV-007).

## Integrations and background work

- AI providers: openai/anthropic/gemini/compatible/ollama/lmstudio — real HTTP, fallback chain. (ai.mjs)
- Email: gmail.send provider tool (per-ACTOR Google account + gmail.send scope + approval) and notify.mjs registry delivery (HTTP-only `/api/notify`, fail-closed; NOT an engine tool — EV-010). SMS via connector. Draft-only internal tool `homeops.send_notification_draft` (EV-009). Web read tools (web.search/read/recipe) live.
- Background: trigger tick 10s, stale-run sweep 60s (30-min TTL), calendar auto-sync, run recovery at boot. (index.mjs:3240-3248)

## Auth, tenancy, and permissions

- Session-cookie + CSRF; roles Owner > Adult Admin > Adult Member > Limited Member > Child View > Guest/Helper resolved server-side. Child AI gate honest (403 ai_disabled, EV-016). Agent capability policy = (allow − deny) ∩ available, re-validated per step in the engine (EV-004; a denied tool can never execute — but the clamp DROPS it silently pre-run, ISS-005). Approvals: consume-once, input-hash-bound, 30-min TTL. Tenancy: per-household context, per-household tick fairness caps.

## Deployment, offline, and sync assumptions

- Local: `scripts/dev.mjs` (backend :8787, vite :5173), node 25.8.2. Healthy at HEAD (EV-020).
- Prod: homeops-ai.onrender.com, node v24.18.0, env production (EV-019). Render autodeploy broken per ART-002 (historical, user-side): prod serves ffcfa33-lineage. **Version skew on the audited chain: none — implicated files identical ffcfa33↔HEAD (EV-018).**
- Mobile TestFlight builds point at prod URL (ART-002, historical).
