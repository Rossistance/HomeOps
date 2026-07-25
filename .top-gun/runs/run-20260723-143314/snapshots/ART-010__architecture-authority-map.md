# Architecture and Authority Map — run-20260723-143314

Carried forward from the prior mission's map and re-verified where this run's issues touch it.

## Modules and boundaries

- **Web client** — React/Vite SPA, `src/`. Zustand store (`src/store/useStore.ts`, ~2.5 kLoC) holds both local-first household data and server-derived projections. API client at `src/connectors/api.ts` (EV-107).
- **Mobile client** — Expo/React Native, `apps/mobile/src/`. Independent store and API layer; shares the server but not the client code (EV-111, docs/platform-parity-matrix.md).
- **Server** — Node ESM, `server/`. Single router (`index.mjs`) with explicit gates; durable run engine (`engine.mjs`); orchestration entry (`orchestrator.mjs`); tool registries (`internal-functions.mjs`, `providers.mjs`, `connectors.mjs`); calendar sync (`calendar.mjs`); memory provider (sqlite-fts5).
- **Data** — one SQLite tenant per household; WAL mode; `HOMEOPS_DATA_DIR` selects the root (EV-121).

## Data flow and state ownership

- **Authority split is the load-bearing seam.** Execution truth (runs, approvals, notifications, artifacts) is server-owned; household content (events, tasks, meals) is mirrored client-side. The prior mission wired the server read-models into web; iOS still consumes some of them independently (ISS-118).
- **Template instantiation is client-owned** — `createAutomationFromTemplate` builds the plan, picks the agent, and creates the automation entirely in the browser store; no server function participates (EV-107, EV-109). This is the structural cause of ISS-103.
- **Task types partition household data across surfaces**: `BOARD_TASK_TYPES = {chore,task,reminder,errand}` render on the Chore Board; `type:"list"` (grocery/packing) and bills route to their own views (EV-112). Counts and lists are computed independently per surface → ISS-112.

## API/event/IPC/persistence relationships

- Runs start through `startRun` via three entry paths: chat (`runAssistantPlan`), agent (`runAgent`, server-verified agentId), and skill (`runSkill`). **Only the first two guarantee a non-null acting agent**; `runSkill` accepts null (EV-105) → ISS-102.
- `no_acting_agent` is raised at the tool boundary (`internal-functions.mjs:487`), i.e. *after* the run has already started and consumed steps (EV-106). The check belongs at run creation.
- Google Calendar: events carry `provenance.googleEventId` + account, enabling two-way write-back (`calendar.mjs:150`). Import maps `end.date` verbatim (`calendar.mjs:24`) → ISS-104.

## Integrations and background work

- Six AI provider adapters with fallback; local providers (LM Studio, Ollama) support optional bearer tokens (shipped 2026-07-22).
- Connector sandbox (`sandbox-connectors.mjs`) allows OAuth-gated use-cases to be exercised without credentials.
- Scheduler is tz-anchored per household; connector-parked runs now expire on a 7-day TTL with legacy grandfathering.
- **Production lacks a browser runtime** (`browserRuntime:false`, EV-122) → ISS-119.

## Auth, tenancy, and permissions

- Per-household SQLite tenancy; session via cookie + CSRF; role gates (Owner/Adult Admin/Adult Member/Child/Guest) enforced server-side.
- Sends are gated by a **per-helper recipient allowlist** — the design reason `runSkill`'s null actor is fatal rather than merely untidy (EV-106).
- Approval policy has **no single resolution point**: toggles exist per agent, per skill, and per function, plus a household risk matrix that claims coverage it does not have (ISS-107, ISS-124).

## Deployment, offline, and sync assumptions

- Render web service, `plan: starter`, persistent disk mounted at `/data`, `HOMEOPS_DATA_DIR=/data` (EV-121).
- **Local dev tenant (`server/.data/tenants/local/`) and the production tenant are entirely separate databases.** Any data operation must name its target explicitly; the 2026-07-21/22 operations targeted `local` only (ISS-101).
- Web sync moved to SSE (`/api/changes`) with rev-gated hydration; mobile still polls `/api/rev` on a 12s interval (deliberate divergence, documented in the parity matrix).
- Hot-WAL rule in force: never open a live tenant DB from a second process; take backups through the server's own export path.
