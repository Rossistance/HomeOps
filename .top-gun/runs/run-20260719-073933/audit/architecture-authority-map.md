# Architecture and Authority Map

Populated by audit-lead, run-20260719-073933. Confidence labels inline. Evidence IDs refer to evidence-ledger.md.

## Modules and boundaries

- **Web app** `src/` — React 18.3 + Vite 8 + Tailwind 3.4 + Zustand 5, TypeScript 5.6 strict (typecheck passes, EV-101). 18 screen files in `src/screens/`; 16 screen IDs in the `SCREENS` map (`src/App.tsx:47-66`); `Lock.tsx` and `Onboarding.tsx` render outside the shell; `AIProviders.tsx` is imported by Settings (observed) not routed directly. Navigation is store-based (`route.screen` in Zustand), NOT URL-based: `react-router-dom` is declared in package.json dependencies but never imported anywhere in `src/` (EV-102, code debt).
- **Backend** `server/` — dependency-free Node http server, "control plane v1.2.0" (`server/index.mjs`, 3214 lines, ~95 route branches, 74 unique route roots, EV-103). 30 .mjs modules incl. engine.mjs (49KB), planner.mjs (47KB), store.mjs (46KB), providers.mjs (38KB), functions.mjs (34KB), connectors.mjs (33KB), seed.mjs (33KB).
- **Browser runtime** — separate `homeops-browser-runtime v1.0.0` on :9223 (health-confirmed at bootstrap); backend `browser.mjs` mediates; Playwright is a production dependency of the main package.
- **Mobile** `apps/mobile/` — Expo/EAS iOS app (TestFlight per HEAD commit message); code-review scope only this audit. `mobile-version/` — legacy/asset folder (icon setup script). Root `app.json`/`eas.json` belong to the Expo app.
- **Build/deploy** — `render.yaml` single Render web service (backend serves dist/), `.github/` CI. `dist/` present from an earlier build (parity unverified, treat as stale).

## Data flow and state ownership

- Frontend: normalized `AppData` collections in one Zustand store (`src/store/useStore.ts`, 2763 lines) — members, spaces, agents, automations, runs, threads, files, knowledge, playbooks, miniapps, memories, approvals, activity, tasks, events, settings. Autosaved to IndexedDB via `idb` (`src/storage/db.ts`), localStorage fallback; JSON export/import (`src/storage/backup.ts`); seed dataset "The Harper Family" (`src/data/seed.ts`).
- Backend: file-backed tenant databases (`server/tenant-db.mjs`, `server/store.mjs`) under `server/.data/` with AES-256-GCM secrets vault, audit log, webhook events, legacy-JSON→tenant migration with quarantine (server tests observed passing, EV-104).
- Authority split (observed in README + code, verified in journeys): household app data is local-first (browser IndexedDB); connector config/secrets/approvals/jobs/audit are backend-owned; `/api/backups` push/restore bridges local data to server storage.

## API/event/IPC/persistence relationships

- Vite dev proxies `/api/*` → :8787. Typed frontend client `src/connectors/api.ts` (~800+ lines) with CSRF token header after login; sessions via cookie (`authRequired: true` in /api/health, EV-105).
- 74 backend route roots (EV-103) incl. auth (signup/login/session/password-reset/verify-email), household (members/invites/claim/profiles), domain (meals, calendar+ICS+Google, events, tasks, knowledge, files, memory, conversations), agent system (agents, runs, plan, assistant+streaming, skills, functions, playbooks, evolution, miniapps/generate), control plane (connectors, providers, oauth/callback, webhooks incl. revenuecat+sms, jobs, triggers, notifications, push-tokens, approvals, risk-overrides, audit, settings, backups, browser/session, store/quarantine/ack, rev).
- Webhooks: `/api/webhooks/sms` (Twilio inbound), `/api/webhooks/revenuecat` (subscription), generic receiver; HMAC verification optional (tests: prod rejects unsigned, dev accepts marked unverified — EV-104).

## Integrations and background work

- Connector registry (`server/connectors.mjs`): Weather (Open-Meteo, live no-key), Webhook Receiver (live), RSS, Custom HTTP, Gmail/Google Calendar (OAuth, needs client id/secret), Twilio SMS, Browser Automation (needs BROWSER_RUNTIME_URL), Local Files. Readiness states: connected / not_configured / needs_auth / local_only / runtime_unavailable / error.
- AI providers (`server/ai.mjs`, `src/screens/AIProviders.tsx`): BYO-key model providers + local deterministic assistant fallback (`src/lib/ai.ts`).
- In-process job scheduler (`/api/jobs`), triggers (`server/triggers.mjs`), notifications/push tokens, SMS gateway (`server/sms.mjs`).
- Kill switch (Settings) disables write/send tools backend-side. `externalActionsEnabled: true` currently (authority boundary: do NOT execute external side-effect tools this audit).

## Auth, tenancy, and permissions

- Roles: Owner / Adult Admin / Adult Member / Limited Member / Child View / Guest-Helper; view modes owner/adult/child/grandparent/sitter derived role+relationship (`src/lib/roles.ts`, mirrored in `apps/mobile/src/lib/roles.ts`). Server `server/auth.mjs` `gate()` is stated source of truth; client checks only hide what would 403.
- Login modes: profile picker with optional PIN (Lock screen) + email/password signup/login; sessions cookie-backed w/ CSRF token; password reset + email verification routes exist.
- Tenancy: per-household tenant DBs server-side (`tenant-context.mjs`, `tenant-db.mjs`; tenant-isolation tests pass, EV-104).

## Deployment, offline, and sync assumptions

- Render blueprint: single web service, `npm ci && npm run build`, `npm start`, persistent disk at /data via HOMEOPS_DATA_DIR (starter plan). Production URL claim `https://homeops-ai.onrender.com` (unverified this run).
- Node engines contradiction (observed, EV-106): README "Node 18+ (built on Node 20)" vs package.json engines ">=22.13 <25" vs actual dev runtime v25.8.2 (violates engines). Render default Node unknown → deploy-time risk.
- PWA via vite-plugin-pwa (offline shell expected — verify in journeys). Local-first offline: IndexedDB survives; backend-dependent features degrade (RuntimePill shows offline state, `src/components/Shell.tsx:113-130`).
- CORS/origins include LAN IPs 192.168.4.24 (dev artifact leak risk — check `.env.example`/defaults in CI/CD pass).
