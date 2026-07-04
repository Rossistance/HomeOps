# HomeOps AI

**A premium family operating system with real connector infrastructure.**

HomeOps AI is a calm, high-trust command center for households — parents, couples, caregivers, roommates, and individuals. Helper agents coordinate schedules, documents, messages, bills, caregiving, school, travel, and recurring life workflows, and act on the outside world only through **real, permission-scoped connectors** behind **approval gates**.

This build pairs a polished React frontend with a **real local backend runtime** that owns OAuth, a secrets vault, webhooks, scheduled jobs, browser-automation boundaries, tool execution, and audit logging. There are **no simulated connectors and no fake success states** — a connector is either real-and-configured, real-but-unconfigured, local-only, or honestly unavailable.

---

## Quick start

```bash
cd homeops-ai
npm install
npm run dev        # starts BOTH the backend runtime (:8787) and the web app (:5173)
```

Open **http://localhost:5173**. The Vite dev server proxies `/api/*` to the backend runtime.

Other scripts:

```bash
npm run dev:web    # web only (Vite)
npm run server     # backend runtime only (Node, :8787)
npm start          # production server; serves /api plus built dist/ if present
npm run build      # typecheck (tsc) + production build (vite)
npm run typecheck  # type-check only
```

Requirements: Node 18+ (built on Node 20). No external accounts are required to run it — out of the box the **Weather** connector is live (real Open-Meteo calls) and the **Webhook Receiver** accepts real inbound events. Everything else shows an honest "Setup required" state until you configure it.

## Deploy

The recommended deployment for this repo is a **single Render web service**. The Node backend serves both `/api/*` and the built Vite app from `dist/`, which keeps session cookies and CSRF same-origin.

The included Blueprint uses Render's `starter` plan because HomeOps stores its vault and household data on disk, and Render Free web services cannot attach persistent disks. For a disposable demo, you can remove the `disk` block and `HOMEOPS_DATA_DIR` env var and change `plan` to `free`, but local app data will be lost on redeploys/restarts.

1. Push this repo to GitHub/GitLab/Bitbucket.
2. In Render, create a Blueprint from the root `render.yaml`.
3. If Render assigns a different URL than `https://homeops-ai.onrender.com`, update `HOMEOPS_PUBLIC_URL` and `HOMEOPS_ALLOWED_ORIGINS` to the actual service URL.
4. Set optional OAuth provider values in the Render dashboard. Do not commit real secrets.
5. For Google OAuth, add this authorized redirect URI: `https://your-render-url/api/oauth/callback`.

The Blueprint runs `npm ci && npm run build`, starts with `npm start`, and mounts `/data` as persistent storage for the file-backed vault and household data.

---

## Architecture

```
homeops-ai/
  server/                       REAL backend runtime (Node http, no deps)
    index.mjs                   routes: health, connectors, tools/execute, oauth, webhooks, jobs, browser, audit, settings
    connectors.mjs              connector registry + tool manifests + REAL executors + readiness model
    store.mjs                   file-backed config, AES-256-GCM secrets vault, audit log, webhook events
    .data/                      created at runtime (vault, configs, audit) — local only
  scripts/dev.mjs               runs backend + vite together
  src/
    connectors/api.ts           typed frontend client for the backend
    store/useStore.ts           Zustand store: app state + connector actions (configure/auth/run/health/webhook/killswitch)
    lib/runtime.ts              local agent-run orchestration (records local work; raises approvals for external steps)
    lib/ai.ts                   local deterministic assistant (NL→agent, NL→workflow plan, briefings)
    data/seed.ts                local sample household ("The Harper Family") — no fake external events
    components/                 premium design system (Shell, ui, Connections/Browser panels, CommandBar)
    screens/                    11 product screens
```

### Connector infrastructure (real)

- **Connector registry** (`server/connectors.mjs`): each connector declares provider, category, auth type, config schema, tools (with action/risk/approval), triggers, runtime location, and a computed **readiness** state (`connected`, `not_configured`, `needs_auth`, `local_only`, `runtime_unavailable`, `error`, …).
- **Auth manager / OAuth boundary**: `/api/oauth/:id/start` builds a real provider consent URL when a client ID is configured; `/api/oauth/callback` performs a real token exchange and stores tokens in the vault. Without credentials it returns an honest `setup_required`.
- **Secrets vault** (`server/store.mjs`): AES-256-GCM encryption at rest; secrets are decrypted only inside the backend and are **redacted** (`••••••••`) in every API response.
- **Tool registry + execution engine** (`/api/tools/:id/execute`): checks readiness → scopes → approval → kill switch, then runs the **real** call. Read tools on configured connectors execute for real (Weather → Open-Meteo, RSS → real feed fetch, Custom HTTP → real request). Write/send tools return `approval_required`; unconfigured connectors return `not_configured`. Nothing is fabricated.
- **Webhook receiver** (`/api/webhooks/:id`): a real inbound endpoint with optional HMAC signature verification; stores events and surfaces them in the UI.
- **Background jobs** (`/api/jobs`): real in-process scheduler with inspectable status and run-now.
- **Browser automation boundary** (`/api/browser/session`): honest runtime status — `runtime_unavailable` until `BROWSER_RUNTIME_URL` is set; provides a login-handoff state and never fakes a completed login or download.
- **Audit log** (`/api/audit`): every tool attempt (success/failure) is recorded with redaction.

---

## Provider setup (optional)

Configure connectors in **Connections** (UI) or via environment variables. No credentials are hardcoded.

| Connector | What enables it |
|---|---|
| Weather | Live out of the box (no key). Optionally set a location in the UI. |
| Webhook Receiver | Live out of the box. Real endpoint: `POST /api/webhooks/webhook`. |
| RSS / Feed | Paste a real feed URL in the UI. |
| Custom HTTP | Base URL (+ optional API key, stored in the vault). |
| Gmail / Google Calendar | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (env or UI), then "Authorize". |
| Text Messaging (Twilio) | `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` + from-number. |
| Browser Automation | `BROWSER_RUNTIME_URL` (e.g. a Playwright endpoint). |
| Local Files | Local-only; no setup. |

A master **kill switch** (Settings) disables all write/send tools at the backend.

---

## Safety & approvals

- High-risk tools (send email/text, calendar writes, downloads, form submits, subscription cancellation, browser actions) **always create an approval request** and are blocked until you approve.
- Each approval shows the requesting agent, connector, risk, data used, recipient, and a preview, with **Approve / Deny / Edit before approval / Ask for changes**.
- Sensitive categories (children/school, medical, financial, legal, identity) are labeled; sensitive memories stay within their space.
- The app **never asks for external passwords**; browser workflows pause for a real login handoff in the runtime.

---

## Persistence

- Household app data (members, spaces, agents, automations, runs, threads, files, knowledge, playbooks, mini apps, memories, approvals, activity, tasks, events, settings) is normalized in a Zustand store, **autosaved to IndexedDB** (localStorage fallback), with JSON export/import and a sample-data reset.
- Connector configuration and secrets live in the **backend vault** (`server/.data/`), separate from the browser.

---

## Known limitations (honest)

- **Out-of-the-box live connectors are Weather + Webhook Receiver.** Others are real but require credentials/URLs; until configured they are honestly "Setup required" / "Runtime not connected" and their tools refuse to run.
- **Network egress** is required for Weather/RSS/HTTP/Gmail/Twilio to actually return data. In a sandbox without egress, these fail honestly with `provider_error` (they do not fabricate results).
- **Browser automation** ships as a boundary: it reports an honest runtime status and login-handoff and integrates approvals, but you must connect a real runtime (`BROWSER_RUNTIME_URL`) to drive a live browser.
- **Cloud AI providers** require an API key; the local deterministic engine powers on-device assistance.
- The backend is a lightweight single-process runtime with a file-backed vault. For hosted use, mount persistent storage (the included Render Blueprint mounts `/data`); for larger or regulated production use, migrate durable state to managed storage.

---

## Migration note

This codebase previously shipped demo/mock adapters ("Authorize demo", simulated browser/webhook flows, `.demo` URLs, disabled provider placeholders). Those were removed entirely from product behavior and replaced with the real connector runtime described above. Sample data ("The Harper Family") remains as **local sample data only** and never implies that a real external event occurred.

*The product name and labels live in `src/brand.ts` and can be changed in one place.*
