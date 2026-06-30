# HomeOps Connector Platform — Developer Handoff Spec

**Status:** framework + Google OAuth + AI providers shipped (Phase 5); OAuth providers 7–12 specced for build.
**Owner:** HomeOps (first-party). **No** Nango / Pipedream / Composio / Zapier / managed connector provider.
**Audience:** engineers implementing the connector framework and provider connectors.
**Stack:** React 18 + TS + Vite + Tailwind v3 + Zustand (frontend); Node built-in `http`, zero-dependency backend (`server/`).

> This is a handoff, not prose. Where it says **EXISTS**, the contract is already implemented in the named file (Phase 5) and you extend it. Where it says **BUILD**, it is net-new against that contract.

---

## 0. Non-negotiables (hard-failure gates → QA)

These are the acceptance gates. Each maps to an automated probe in [§9](#9-acceptance-gates). A build that trips any of these is rejected.

| # | Must never happen | Enforced by |
|---|---|---|
| H1 | A normal flow says "demo / mock / simulated / fake" | Source scan (CI grep) + copy review |
| H2 | A connector becomes `connected` without a real OAuth callback **or** real API-key/health validation | `connected` is only ever written by the callback handler or a passing validation call |
| H3 | A tool execution returns success without a real provider/local call | Executors have no synthetic branch; failures return typed errors |
| H4 | Approval bypassable from the frontend | Server-side approval record, consume-once, input-hash bound (`approved` flag ignored) |
| H5 | Tokens in `localStorage` | Tokens only in the backend vault (AES-256-GCM); frontend holds none |
| H6 | OAuth client secrets reach the frontend | Secrets only in env; never serialized to any `/api` response |
| H7 | Provider health seeded rather than checked | Health = result of a live call, persisted with a timestamp |
| H8 | UI shows fake "available tools" with nothing connected | Tools render disabled with a reason until an account is connected |

---

## 1. Architecture overview

```
Browser (no secrets, no tokens)
  │  same-origin /api  (cookie + CSRF)        ┌─ env only ─────────────┐
  ▼                                           │ HOMEOPS_OAUTH_*_ID      │
HomeOps backend control plane (server/)       │ HOMEOPS_OAUTH_*_SECRET  │
  ├─ auth.mjs      origin allowlist, session,  │ HOMEOPS_PUBLIC_URL      │
  │                CSRF, roles, gate()         └────────────────────────┘
  ├─ providers.mjs provider registry + scope catalog        [BUILD]
  ├─ oauth.mjs     start/callback, PKCE, state, refresh      [BUILD: generalize]
  ├─ accounts.mjs  connected-accounts store                  [BUILD]
  ├─ vault (store) AES-256-GCM token vault                   EXISTS
  ├─ tools.mjs     tool manifest registry + execution engine [BUILD: split out]
  ├─ triggers.mjs  trigger manifest registry                 [BUILD]
  ├─ approvals     server-side, consume-once, input-hash     EXISTS
  ├─ audit         actor/origin/requestId/outcome            EXISTS
  ├─ health        live checks, persisted                    EXISTS (extend)
  └─ ai.mjs        key + local providers                     EXISTS
        │
        ▼ real provider APIs / localhost runtimes (SSRF-guarded egress)
```

### 1.1 Framework component map (the 15 required pieces)

| Component | Contract | Location | Status |
|---|---|---|---|
| Provider registry | static list of provider definitions (auth type, endpoints, default scopes) | `server/providers.mjs` | **BUILD** (extract from `connectors.mjs`) |
| OAuth authorization start route | `GET /api/oauth/:provider/start` → consent URL (PKCE, state) | `server/index.mjs` + `server/oauth.mjs` | EXISTS for Google; **generalize** |
| OAuth callback route | `GET /api/oauth/callback` → exchange, create connected account, postMessage | `server/index.mjs` | EXISTS; **bind to provider registry** |
| Encrypted token vault | AES-256-GCM, decrypt only in backend, redacted in API | `server/store.mjs` (`encrypt/decrypt/getSecret`) | EXISTS |
| Refresh-token handling | auto-refresh on 401, persist new access token | `server/connectors.mjs` (`refreshGoogle/googleApi`) | EXISTS for Google; **generalize per provider** |
| Connected-account table | one row per (household, provider, external account) | `server/accounts.mjs` (`connected_accounts.json`) | **BUILD** |
| Scope catalog | provider → scope keys → {oauthScope, label, tools, risk} | `server/providers.mjs` | **BUILD** |
| Tool manifest registry | declarative tools w/ required scopes, inputs, executor | `server/tools.mjs` | EXISTS inline in `connectors.mjs`; **formalize** |
| Tool execution engine | gate → resolve account → refresh → call → audit | `server/tools.mjs` (`executeTool`) | EXISTS; **route via accountId** |
| Trigger manifest registry | declarative triggers (poll/webhook/schedule) | `server/triggers.mjs` | EXISTS inline; **formalize** |
| Server-side approval enforcement | record bound to actor+tool+inputHash, consume-once | `server/store.mjs` + `index.mjs` | EXISTS |
| Audit logging | every config/exec/oauth/webhook/job/approval w/ actor | `server/store.mjs` (`appendAudit`) | EXISTS |
| Connector health checks | live call, persisted `{ok,status,at}` | `server/connectors.mjs` (`healthCheck`/`setHealth`) | EXISTS; **per-provider probes** |
| Revoke / reconnect flow | `DELETE` account → revoke tokens; reconnect = re-run start | `server/index.mjs` + UI | EXISTS (revoke); **add per-account reconnect** |
| Frontend connection-state UI | state machine + cards + drawer | `src/screens/Connections.tsx` | EXISTS; **extend to account model** ([§7](#7-frontend-connection-state-ui-handoff)) |

---

## 2. Data model

File-backed JSON today (under `server/.data/`, git-ignored), shaped to migrate to SQL later. All writes go through `store.mjs`.

### 2.1 Provider registry (static, in code — `server/providers.mjs`)
```ts
interface ProviderDef {
  id: string;                       // "google" | "microsoft" | "slack" | ...
  name: string;
  authType: "oauth2" | "apiKey" | "local";
  // oauth2:
  authUrl?: string; tokenUrl?: string; usePKCE?: boolean;
  scopeSeparator?: " " | ",";       // Google " ", others ","
  refresh?: "rotating" | "static" | "none";
  // deployment env var names (NEVER sent to client):
  clientIdEnv?: string; clientSecretEnv?: string;
  // health probe (live):
  health: (account) => Promise<{ ok: boolean; status: string; detail?: string }>;
}
```

### 2.2 Scope catalog (`server/providers.mjs`)
```ts
interface ScopeEntry {
  key: string;            // "gmail.read"
  oauthScope: string;     // "https://www.googleapis.com/auth/gmail.readonly"
  label: string;          // "Read Gmail messages"
  risk: "Low"|"Medium"|"High"|"Sensitive";
  enablesTools: string[]; // ["gmail.search"]
}
```
The UI renders the scope list on the connect step so the user sees what they grant.

### 2.3 Connected accounts (`server/accounts.mjs` → `connected_accounts.json`) **[BUILD]**
```ts
interface ConnectedAccount {
  id: string;                 // "acct_..."
  householdId: string;
  connectedByActorId: string; // who connected it
  provider: string;
  externalAccountId: string;  // provider's stable id (sub / team_id / etc.)
  displayName: string;        // email / handle / workspace name (NOT a secret)
  scopes: string[];           // granted scope keys
  status: AccountStatus;      // see §7.1
  tokenRef: string;           // vault key; NEVER the token itself
  createdAt: string; updatedAt: string;
  lastHealthAt: string | null; lastHealthOk: boolean | null;
}
```
**Tokens** live only in the vault under `tokenRef`: `{ access, refresh, expiresAt }`, AES-256-GCM. The public account view (`/api/accounts`) omits `tokenRef` and all token material (gate **H5/H6**).

### 2.4 Approvals — EXISTS (`store.mjs`)
`{ id, actorId, householdId, connectorId, toolId, inputHash, risk, status, createdAt, expiresAt, consumedAt }`. `status: pending|approved|denied|consumed|expired`. Execution requires `approved`, unexpired, unconsumed, and `hashInput(input) === inputHash`; consume is atomic (gate **H4**).

### 2.5 Audit — EXISTS (`store.mjs`, `audit.jsonl`)
Every record: `{ id, at, type, ok, actorId, actorName, role, origin, requestId, ip, ...payload }`. Reads gated to Adult Admin+.

---

## 3. OAuth framework

### 3.1 Deployment-owned credentials (gate **H6**, "users don't configure")
Client IDs/secrets and the redirect base are **environment variables only**. There is **no UI field** for them (remove the Phase-5 client-id/secret config inputs for OAuth providers).

| Env var | Example |
|---|---|
| `HOMEOPS_PUBLIC_URL` | `https://home.example.com` (redirect base) |
| `HOMEOPS_OAUTH_GOOGLE_CLIENT_ID` / `_SECRET` | from Google Cloud Console |
| `HOMEOPS_OAUTH_MICROSOFT_CLIENT_ID` / `_SECRET` | Azure app registration |
| `HOMEOPS_OAUTH_SLACK_CLIENT_ID` / `_SECRET` | Slack app |
| `HOMEOPS_OAUTH_DROPBOX_CLIENT_ID` / `_SECRET` | Dropbox app |
| `HOMEOPS_OAUTH_NOTION_CLIENT_ID` / `_SECRET` | Notion integration |
| `HOMEOPS_OAUTH_TODOIST_CLIENT_ID` / `_SECRET` | Todoist app |
| `HOMEOPS_OAUTH_TICKTICK_CLIENT_ID` / `_SECRET` | TickTick app |

Redirect URI registered with each provider: `${HOMEOPS_PUBLIC_URL}/api/oauth/<provider>/callback` (single per-provider path). If the env pair is absent, the provider's readiness is **`not_configured_by_deployment`** and Connect is disabled (no fake success — gate **H2/H8**).

### 3.2 Start route — `GET /api/oauth/:provider/start` (session + CSRF)
1. Look up `ProviderDef`; 401 if no session; 423 if kill switch off; `not_configured_by_deployment` if env missing.
2. Generate `state` (random) + PKCE `code_verifier`/`code_challenge` (S256).
3. Persist state server-side bound to `{ provider, sessionToken, codeVerifier }`, 10-min TTL (`putOAuthState`, EXISTS).
4. Return `{ url }` with `client_id` (public), exact `redirect_uri`, `scope`, `state`, `code_challenge`. **Never** returns the secret.

### 3.3 Callback — `GET /api/oauth/callback`
1. `takeOAuthState(state)` — reject unknown/expired (forged-state → fail, EXISTS).
2. Exchange `code` + `code_verifier` at `tokenUrl` using the **env** secret (server-side).
3. Fetch the provider identity (`/userinfo`, Graph `/me`, Slack `auth.test`, etc.) → `externalAccountId`, `displayName`.
4. **Create/Update `ConnectedAccount`**, store tokens in vault, set `status: "connected"`. This is the **only** place `connected` is written for OAuth (gate **H2**).
5. Respond with the success HTML that `postMessage`s to the **exact** app origin (no `*`, EXISTS) and auto-closes; the SPA reloads accounts.

### 3.4 Refresh — generalize `googleApi` into `providerApi(account, req)`
On `401`, use `refresh_token` per `ProviderDef.refresh` semantics (Google/MS rotating; Slack tokens generally non-expiring; Dropbox short-lived + refresh; Notion non-expiring). Persist the new access token. If refresh fails → account `status: "needs_reconnect"`, never silent fake.

### 3.5 One-click end-user flow (gate H2)
```
Connections → [Connect Google] (one click)
   → backend builds consent URL (PKCE) → popup to accounts.google.com
   → user signs in + approves the listed scopes
   → Google → /api/oauth/callback → token exchange → ConnectedAccount{connected}
   → popup postMessages exact origin → closes → SPA refreshes
   → account shows "Connected as alex@…", tools become enabled.
```
The user never sees a client ID, secret, or redirect URI.

---

## 4. Tool execution engine + approval (EXISTS — contract to honor)

`POST /api/tools/:toolId/execute` (session + CSRF):
1. Resolve tool from registry; resolve target `accountId` (or single account for provider).
2. If `tool.requiresApproval`: require a valid `approvalId` → `consumeApproval()` (consume-once, input-hash match). The client `approved` boolean is **ignored** (gate **H4**).
3. Kill-switch check for Send/Write/Download.
4. Execute against the real provider via `providerApi` (auto-refresh) or local runtime; egress through `safeFetch` SSRF guard for non-allowlisted hosts.
5. Audit `{actor, tool, account, ok, error}`. Return typed result or typed error — **no synthetic success** (gate **H3**).

Tools render **disabled with a reason** ("Connect Google to enable") until an account exists (gate **H8**).

---

## 5. Connector specs (build order 1–12)

Each connector = `ProviderDef` + scope catalog entries + tool manifests + trigger manifests + health probe. `requiresApproval = true` for every Write/Send/Delete/Download tool. "Not configured" = `not_configured_by_deployment` (OAuth env missing) — never demo.

### 1. Google (OAuth) — **EXISTS, extend to Drive + accounts model**
- Env: `HOMEOPS_OAUTH_GOOGLE_CLIENT_ID/_SECRET`. PKCE S256, refresh rotating.
- Scopes: `gmail.readonly`, `gmail.send`, `calendar.events`, `drive.readonly`, `drive.file`.
- Tools: `gmail.search` (Read), `gmail.send` (Send✋), `calendar.list` (Read), `calendar.create` (Write✋), `drive.list` (Read), `drive.get` (Read), `drive.upload` (Write✋).
- Triggers: `gmail.received` (poll), `calendar.starting` (poll).
- Health: `GET gmail/v1/users/me/profile` (or token introspection) → ok.

### 2. OpenAI (API key) — **EXISTS** (`ai.mjs`)
- Key entry one screen; validated via `GET /v1/models`. Tools: `ai.chat`. Health: live `/v1/models`.

### 3. Anthropic (API key) — **EXISTS** — `GET /v1/models` w/ `x-api-key` + `anthropic-version`; `POST /v1/messages`.

### 4. Gemini (API key) — **EXISTS** — `GET {base}/models?key=`; `:generateContent`.

### 5. Ollama (local) — **EXISTS** — health/list `GET http://localhost:11434/api/tags`; chat `POST /api/chat`. SSRF guard allows loopback **only** here + LM Studio. Honest `unreachable` when not running.

### 6. LM Studio (local, OpenAI-compatible) — **EXISTS** — `GET http://localhost:1234/v1/models`; `POST /v1/chat/completions`.

### 7. Microsoft Graph (OAuth) — **BUILD**
- Env: `HOMEOPS_OAUTH_MICROSOFT_CLIENT_ID/_SECRET`. Auth `login.microsoftonline.com/common/oauth2/v2.0/authorize`; token `…/token`; PKCE; `offline_access` for refresh.
- Scopes: `Mail.Read`, `Mail.Send`, `Calendars.ReadWrite`, `Files.Read`, `Files.ReadWrite`.
- Tools: `outlook.search` (Read), `outlook.send` (Send✋), `mscal.list` (Read), `mscal.create` (Write✋), `onedrive.list` (Read), `onedrive.upload` (Write✋).
- Health: `GET https://graph.microsoft.com/v1.0/me`.

### 8. Slack (OAuth) — **BUILD**
- Env: `HOMEOPS_OAUTH_SLACK_CLIENT_ID/_SECRET`. `slack.com/oauth/v2/authorize` → `oauth.v2.access`. Bot/user token; generally non-expiring.
- Scopes: `channels:read`, `chat:write`, `users:read`.
- Tools: `slack.listChannels` (Read), `slack.postMessage` (Send✋).
- Triggers: Events API webhook (`/api/webhooks/slack`, signature-verified) — optional.
- Health: `auth.test`.

### 9. Dropbox (OAuth) — **BUILD**
- Env: `HOMEOPS_OAUTH_DROPBOX_CLIENT_ID/_SECRET`. `dropbox.com/oauth2/authorize?token_access_type=offline` (refresh), short-lived access.
- Scopes: `files.metadata.read`, `files.content.read`, `files.content.write`.
- Tools: `dropbox.list` (Read), `dropbox.download` (Read), `dropbox.upload` (Write✋).
- Health: `POST /2/users/get_current_account`.

### 10. Notion (OAuth) — **BUILD** (+ optional MCP client path)
- Env: `HOMEOPS_OAUTH_NOTION_CLIENT_ID/_SECRET`. `api.notion.com/v1/oauth/authorize` → token (non-expiring). `Notion-Version` header on all calls.
- Tools: `notion.search` (Read), `notion.createPage` (Write✋), `notion.appendBlock` (Write✋).
- Health: `POST /v1/search` (limit 1).
- **MCP path (if practical):** a `NotionMcpClient` that speaks MCP to Notion's hosted server, surfaced as tools through the same registry. Gate it behind `HOMEOPS_NOTION_MCP_URL`; if absent → REST path. Document as a follow-up if not reached.

### 11. Todoist (OAuth) — **BUILD**
- Env: `HOMEOPS_OAUTH_TODOIST_CLIENT_ID/_SECRET`. `todoist.com/oauth/authorize` → `/oauth/access_token`. Scope `data:read_write`.
- Tools: `todoist.listTasks` (Read), `todoist.createTask` (Write✋), `todoist.complete` (Write✋).
- Health: `GET /rest/v2/projects`.

### 12. TickTick (OAuth) — **BUILD**
- Env: `HOMEOPS_OAUTH_TICKTICK_CLIENT_ID/_SECRET`. `ticktick.com/oauth/authorize` → `/oauth/token`. Scopes `tasks:read tasks:write`.
- Tools: `ticktick.listTasks` (Read), `ticktick.createTask` (Write✋).
- Health: `GET /open/v1/project`.

> **Session floor:** if time-boxed, ship 1–6 end-to-end (done) + the generalized framework, and render 7–12 as `not_configured_by_deployment` / `not_implemented`. Never demo success.

---

## 6. Backend routes (summary)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/providers` | GET | session | registry + per-provider readiness (`configured` vs `not_configured_by_deployment` vs `not_implemented`) |
| `/api/accounts` | GET | session | connected accounts (redacted) |
| `/api/oauth/:provider/start` | GET | session | consent URL (PKCE) |
| `/api/oauth/callback` | GET | (state) | exchange → create account |
| `/api/accounts/:id` | DELETE | Adult Admin | revoke (delete account + best-effort token revoke at provider) |
| `/api/accounts/:id/health` | POST | session | live health probe, persisted |
| `/api/tools/:toolId/execute` | POST | session+CSRF | execute (approvalId for gated) |
| `/api/approvals` `/api/approvals/:id/decide` | POST | session+CSRF | create / decide |
| `/api/ai/*` | — | session(+admin for config) | AI providers (EXISTS) |
| `/api/audit` | GET | Adult Admin | audit log |

---

## 7. Frontend connection-state UI handoff

Screen: **Connections** (`src/screens/Connections.tsx`) + connector **Drawer**. This is the design-handoff core.

### 7.1 State machine (single source of truth: backend status)
```
not_configured_by_deployment ─(env set)→ disconnected ─[Connect]→ connecting
        │ (Connect disabled, no popup)                              │ popup + callback
        ▼                                              ┌── error ───┘
   not_implemented                                     ▼
   (label only, no Connect)                connected ──[health fail]→ degraded
                                              │ │           │
                                   [Revoke]   │ └─[token]──→ needs_reconnect ─[Reconnect]→ connecting
                                              ▼
                                          revoked
```

| State | Badge label | Color token | Connect/primary action |
|---|---|---|---|
| `not_configured_by_deployment` | "Not configured by deployment" | `amber` | disabled; tooltip names the env var |
| `not_implemented` | "Not implemented" | `gray` | none |
| `disconnected` | "Not connected" | `gray` | **Connect <Provider>** (primary) |
| `connecting` | "Connecting…" | `sky` | spinner, disabled |
| `connected` | "Connected as {displayName}" | `sage` | Manage / Revoke |
| `degraded` | "Connected · health check failed" | `amber` | Run health check / Reconnect |
| `needs_reconnect` | "Reconnect needed" | `coral` | **Reconnect** |
| `revoked` | "Revoked" | `coral` | Connect |

> Reuse the existing `READINESS_META` map and `ReadinessBadge` in `src/connectors/api.ts`; add the four account-level states above.

### 7.2 Layout
- Grid of provider cards: `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`, gap `gap-3`.
- Two groups (existing pattern): **Live & ready** (`account.status===connected && health.ok`) and **Available · needs setup or attention** (everything else). `not_implemented` providers sort last with reduced emphasis.
- Card → opens right **Drawer** (`max-w-2xl`) with scopes, tools, triggers, health, accounts.

### 7.3 Design tokens (from the app's Tailwind theme — use tokens, not hex)
| Token / class | Usage |
|---|---|
| `card`, `card-pad` | card container + padding |
| `chip` + `BADGE_BG[color]` | status badges (AA-contrast -700 text on -100 fill) |
| `bg-sand-50/100/200` | surfaces / borders |
| `text-ink-900/700/500` | title / body / muted (muted is `ink-500`, not `ink-400`, for AA) |
| `sage / amber / coral / sky / lavender / gray` | semantic accents (see state table) |
| `btn-primary / btn-secondary / btn-ghost / btn-danger` | actions |
| `shadow-pop`, `animate-fade-in`, `animate-scale-in`, `animate-slide-in-right` | elevation + motion |
| `RiskBadge` | per-tool risk (Low sage / Medium amber / High coral / Sensitive lavender) |

### 7.4 Components & props
| Component | Variant / props | Notes |
|---|---|---|
| `Group` | `title, hint, items` | the two readiness groups |
| Provider `Card` | `onClick`, `ariaLabel` | keyboard-operable (role=button, Enter/Space, focus ring) — already in `ui.tsx` |
| `ReadinessBadge` | `readiness` | extend with account states |
| `Drawer` | `open, onClose, title, footer` | focus-trapped + restores focus (already in `ui.tsx`) |
| Scope list | `scopes[]` | shown on the connect step — "you're granting…" |
| `ToolCard` | `tool, disabled` | disabled w/ reason until connected (gate **H8**) |
| Account row | `displayName, status, health, [Reconnect][Revoke]` | one row per connected account |

### 7.5 States & interactions
| Element | State | Behavior |
|---|---|---|
| Connect button | default → click | opens provider popup; card → `connecting` |
| Connect button | `not_configured_by_deployment` | disabled; tooltip: "Set `HOMEOPS_OAUTH_<P>_CLIENT_ID/_SECRET` to enable." |
| Popup | success | `postMessage` (exact origin) → toast "Connected as {email}" → tools enable |
| Popup | closed/timeout | card returns to `disconnected`; toast "Authorization cancelled" |
| Tool Run (gated) | click | creates server approval → toast "Approval requested"; runs only after approve |
| Health check | click | live probe; badge → `connected`/`degraded` with timestamp |
| Revoke | click | confirm modal → delete account + revoke at provider → `disconnected` |

### 7.6 Responsive
| Breakpoint | Layout |
|---|---|
| Desktop > 1024 | 3-col grid; Drawer `max-w-2xl` overlay |
| Tablet 768–1024 | 2-col grid; Drawer full-height right |
| Mobile < 768 | 1-col stacked; Drawer full-width sheet; bottom nav; **no horizontal overflow** |

### 7.7 Edge cases
- **No env configured (fresh deploy):** all OAuth providers `not_configured_by_deployment`; AI key providers `not_configured`; local providers probe and show `unreachable`. Zero fake connected.
- **Multiple accounts** per provider (e.g., two Gmail): list each row; tools prompt for which account when >1.
- **Token expired / refresh fails:** `needs_reconnect`; tools disabled with reason.
- **Local runtime offline (Ollama/LM Studio):** `unreachable`, empty model list — never a seeded list.
- **Long display names / emails:** truncate with `truncate`, full value in `title`.
- **Backend offline:** banner "Runtime offline — start with `npm run dev`"; cards read-only.

### 7.8 Motion
| Element | Trigger | Animation | Duration | Easing |
|---|---|---|---|---|
| Card | mount | `animate-fade-in` | ~240ms | ease-out |
| Drawer | open | `animate-slide-in-right` | ~240ms | ease-out |
| Connecting badge | state | soft pulse (`animate-soft-pulse`) | 2s loop | ease-in-out |
| Connected toast | callback | scale-in | ~180ms | ease-out |

### 7.9 Accessibility
- Provider cards: `role="button"`, `tabIndex=0`, Enter/Space activate, visible focus ring (`focus-visible:ring-2 ring-ink-500`). (Done in `Card`.)
- Drawer/Modal: focus trap, initial focus, focus restoration, `aria-modal`, `aria-labelledby`. (Done.)
- Each status badge has a text label (not color-only). Health dot pairs with a text status.
- Connect buttons have explicit names ("Connect Google"); icon-only controls have `aria-label`.
- Scope list is a real `<ul>`; the consent summary is announced before the Connect action.
- Contrast: muted text `ink-500`+, badge text `-700` on `-100` (AA).

---

## 8. Security model (already enforced — keep)
- Origin allowlist (`HOMEOPS_ALLOWED_ORIGINS`), httpOnly session cookie, CSRF double-submit on mutations, deny-by-default `gate()`.
- Tokens & secrets only in the AES-256-GCM vault; never in any `/api` response or `localStorage`.
- Server-side approvals, consume-once, input-hash bound.
- SSRF guard on all egress except provider-allowlisted hosts; loopback allowed only for Ollama/LM Studio.
- Audit on every config/oauth/exec/webhook/job/approval with actor + origin + requestId.

---

## 9. Acceptance gates (QA — map to H1–H8)

| Gate | Test |
|---|---|
| H1 | `grep -riE "demo|mock|simulat|fake" src/` returns nothing in product copy |
| H2 | With env unset, `GET /api/providers` shows `not_configured_by_deployment`; no path writes `connected` except the callback/validation |
| H3 | Tool executors have no synthetic branch; offline provider → typed error, never `ok:true` |
| H4 | `approved:true` w/o `approvalId` → 422; tamper → `approval_input_changed`; reuse → `approval_already_used` (curl probes) |
| H5 | `localStorage` contains no tokens; vault file holds only ciphertext |
| H6 | No `/api/*` response contains a client secret; secrets only in `process.env` |
| H7 | Health endpoints make a live call; disconnect provider → `degraded/unreachable` reflected |
| H8 | With nothing connected, tool buttons render disabled with a reason |

CI additions: the H1 grep; a typecheck + build gate; the curl probe suite from Phase 5 verification.

---

## 10. Build order & status

1. **Framework refactor** — extract `providers.mjs` (registry+scope catalog), `accounts.mjs` (connected-accounts), `oauth.mjs` (generalized start/callback/refresh), `tools.mjs`/`triggers.mjs` registries. Migrate Google off the single-config model to the account model. *(Phase-5 primitives exist: vault, approvals, audit, health, PKCE, SSRF.)*
2. **Remove OAuth client-id/secret UI fields**; read strictly from env; add `not_configured_by_deployment` state. *(gate H6)*
3. **Google** → accounts model + Drive tools. **AI providers** already done.
4. **Frontend** connection-state UI per [§7](#7-frontend-connection-state-ui-handoff).
5. Providers **7–12** in listed order, each: ProviderDef + scopes + tools + health + UI entry. Notion MCP path optional/last.
6. QA: run [§9](#9-acceptance-gates) gates.

**Done now (Phase 5):** vault, sessions/CSRF/origin/roles, server-side approvals, PKCE OAuth (Google), SSRF guard, audit, health separation, real AI providers (OpenAI/Anthropic/Gemini/Ollama/LM Studio), connection UI with truthful states.

---

## 11. Open decisions (need product/eng sign-off)
1. **Multi-account vs single-account per provider** — spec assumes multi; confirm UX for "which account" on tool run.
2. **Per-account vs per-household connections** — who can use a connected account (owner-only vs shared in household)? Affects tool authorization.
3. **Notion MCP** — REST now, MCP behind a flag, or skip MCP this cycle?
4. **Token revocation at provider** on Revoke — best-effort per provider (some lack a revoke endpoint); confirm acceptable.
5. **Trigger delivery** — polling interval budget vs. webhooks where providers support them (Slack/Microsoft); confirm infra for inbound webhooks in production.
