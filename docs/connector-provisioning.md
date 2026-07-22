# Connector provisioning — the gated 13 use-cases (WP-012)

**Owner of the content below: the household/deployment admin, not FamiliOS.** Thirteen of
the 22 benchmark use-cases (UC-1 through UC-10, UC-12, UC-13, UC-14 — audit/work-packages.md
WP-012) need a real OAuth app registration, a real Twilio account, or a real device-access
project before they can run against live services. FamiliOS never creates these accounts,
runs an OAuth consent flow on your behalf, or enters credentials for you (DEC-016) — that
lane stays entirely user-owned. What this document (and the matching in-app checklist under
**Connections → \<provider\> → Set up**) gives you is the exact, honest path to do it
yourself: which console, which steps, which scopes, which environment variables, and how to
prove it worked once you're done.

The single source of truth for this content is `src/data/providerSetup.ts` — the checklist
you see in the app is rendered straight from that file, and
`server/test/provider-setup.test.mjs` asserts it can never drift from the provider registry
(`server/providers.mjs`) or the connector registry (`server/connectors.mjs`) it describes.

## Before you start: the one shared redirect URI

Every OAuth provider below registers the **same single callback URL** — FamiliOS
multiplexes providers through one route using an opaque `state` parameter
(`server/index.mjs` `oauthRedirectUri()` / `server/oauth.mjs` `buildAuthUrl()`):

```
<your deployment's public URL>/api/oauth/callback
```

Locally that's `http://localhost:8787/api/oauth/callback` (or whatever `HOMEOPS_PUBLIC_URL`
is set to in production). The exact value for your deployment is also shown live in
**Connections → \<provider\> →** the "Not configured by deployment" panel.

## Sandbox mode — verifying without real credentials

Set `HOMEOPS_CONNECTOR_SANDBOX=1` and Google, Microsoft 365, Slack, Dropbox, and Amazon
Alexa all run against an in-process deterministic mock instead of the real API — see
`server/test/README-sandbox.md`. That covers UC-1, UC-2, UC-3, UC-4, UC-5, UC-6, UC-7,
UC-12, and UC-13, plus SMS (`sms.send`, UC-14) via `server/connectors.mjs`'s credentialed
connector path. **Notion, Todoist, and TickTick have no sandbox twin** — UC-9 and UC-10 stay
honestly `not_connected` until those three are really provisioned; there is no simulated
pass to fall back on for them.

Per-UC, the next-wave benchmark suite is expected to report either a real green, or
`SKIPPED (real) — blocker: <named env var / OAuth app>; sandbox twin GREEN` — the
`setupGuide` marker each provider/connector now carries in its public API payload
(`GET /api/providers`, `GET /api/connectors`) is what lets that suite point at a named,
concrete unblock instead of a bare "not configured."

---

## Google — unlocks UC-1, UC-2, UC-5, UC-7, UC-12

**Console:** [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
(menu layout changes periodically — treat exact click paths as approximate).

1. Create or select a project.
2. **APIs & Services → Library** → enable: Gmail API, Google Calendar API, Google Drive
   API, and — for UC-12 (smart home) only — Smart Device Management API.
3. **APIs & Services → OAuth consent screen** → configure it (External or Internal) and add
   the scopes below. Add test users if the app stays in Testing mode.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID** → Application
   type: Web application.
5. Add the redirect URI (above) as an Authorized redirect URI.
6. Copy the Client ID and Client Secret into the env vars below.
7. **UC-12 only:** also register a Device Access project at the
   [Device Access Console](https://console.nest.google.com/device-access) (one-time
   registration fee) and set `HOMEOPS_SDM_PROJECT_ID` to that project id.

| Scope needed | OAuth scope string |
|---|---|
| Basic identity | `openid` |
| See your email address | `https://www.googleapis.com/auth/userinfo.email` |
| Read Gmail | `https://www.googleapis.com/auth/gmail.readonly` |
| Send email | `https://www.googleapis.com/auth/gmail.send` |
| Organize inbox (labels, archive) | `https://www.googleapis.com/auth/gmail.modify` |
| Manage calendar events | `https://www.googleapis.com/auth/calendar.events` |
| Read Google Drive | `https://www.googleapis.com/auth/drive.readonly` |
| Google Home devices | `https://www.googleapis.com/auth/sdm.service` |

**Env vars:** `HOMEOPS_OAUTH_GOOGLE_CLIENT_ID`, `HOMEOPS_OAUTH_GOOGLE_CLIENT_SECRET`

**Verify:** Connections → Google → Connect Google → sign in → account shows Connected. Run
"Search inbox" or "List events" from the provider drawer to confirm a live call.

**Sandbox twin:** yes (`HOMEOPS_CONNECTOR_SANDBOX=1`) — until real credentials exist, UC-1,
UC-2's Google half, UC-5's Google half, UC-7's Google half, and UC-12 verify green in
sandbox mode.

---

## Microsoft 365 — unlocks UC-2, UC-3, UC-4, UC-5, UC-6, UC-7

**Console:** [Microsoft Entra admin center](https://entra.microsoft.com/) → App
registrations (Microsoft has renamed this console before — Azure AD → Microsoft Entra ID —
and may again; search "App registrations" from entra.microsoft.com or portal.azure.com if
this link moves).

1. **Identity → Applications → App registrations → New registration.**
2. Add a redirect URI of type "Web" set to the shared redirect URI above.
3. **Certificates & secrets → New client secret** — copy the value immediately, it's shown
   once.
4. **API permissions → Add a permission → Microsoft Graph → Delegated permissions** → add
   the scopes below. Grant admin consent if your tenant requires it.
5. Copy the Application (client) ID and the client secret value into the env vars below.

| Scope needed | OAuth scope string |
|---|---|
| Stay connected | `offline_access` |
| Read Outlook mail | `Mail.Read` |
| Send Outlook mail | `Mail.Send` |
| Manage calendar | `Calendars.ReadWrite` |
| Read OneDrive | `Files.Read` |

**Env vars:** `HOMEOPS_OAUTH_MICROSOFT_CLIENT_ID`, `HOMEOPS_OAUTH_MICROSOFT_CLIENT_SECRET`

**Verify:** Connections → Microsoft 365 → Connect Microsoft 365 → sign in → account shows
Connected. Run "Search mail" or "List events" from the provider drawer.

**Sandbox twin:** yes — Outlook search/send, calendar list/create, and OneDrive list all
resolve deterministic sandbox fixtures until real credentials exist.

---

## Slack — unlocks UC-3

**Console:** [api.slack.com/apps](https://api.slack.com/apps)

1. **Create New App → From scratch** → name it and pick the workspace.
2. **OAuth & Permissions → Redirect URLs** → add the shared redirect URI above.
3. **OAuth & Permissions → Scopes → Bot Token Scopes** → add the scopes below.
4. **Basic Information → App Credentials** → copy the Client ID and Client Secret into the
   env vars below.
5. Install the app to the workspace (or distribute it) — FamiliOS's own per-user OAuth
   connect happens after that.

| Scope needed | OAuth scope string |
|---|---|
| List channels | `channels:read` |
| Post messages | `chat:write` |
| Read members | `users:read` |

**Env vars:** `HOMEOPS_OAUTH_SLACK_CLIENT_ID`, `HOMEOPS_OAUTH_SLACK_CLIENT_SECRET`

**Verify:** Connections → Slack → Connect Slack → sign in → workspace shows Connected. Run
"List channels" from the provider drawer.

**Sandbox twin:** yes — `slack.listChannels` / `slack.postMessage` resolve fixed sandbox
fixtures.

---

## Dropbox — unlocks UC-8

**Console:** [Dropbox App Console](https://www.dropbox.com/developers/apps)

1. **Create app → Scoped access** → Full Dropbox or App folder access → name the app.
2. **Settings → OAuth 2 → Redirect URIs** → add the shared redirect URI above.
3. **Permissions tab** → enable the scopes below, then Submit.
4. **Settings tab** → copy the App key (Client ID) and App secret (Client Secret) into the
   env vars below.

| Scope needed | OAuth scope string |
|---|---|
| Read file list | `files.metadata.read` |
| Create folders/files | `files.content.write` |

**Env vars:** `HOMEOPS_OAUTH_DROPBOX_CLIENT_ID`, `HOMEOPS_OAUTH_DROPBOX_CLIENT_SECRET`

**Verify:** Connections → Dropbox → Connect Dropbox → sign in → account shows Connected. Run
"List files" from the provider drawer.

**Sandbox twin:** yes — `dropbox.list` / `dropbox.createFolder` resolve fixed sandbox
fixtures.

---

## Notion — unlocks UC-9, UC-10

**Console:** [Notion — My integrations](https://www.notion.so/my-integrations)

1. **New integration** → choose **Public integration** (required for the OAuth flow
   FamiliOS uses — an Internal integration uses a fixed token instead and won't work here).
2. **OAuth Domain & URIs** → add the shared redirect URI above.
3. Copy the OAuth client ID and client secret into the env vars below.
4. Notion access is **page-scoped, not scope-based**: after connecting, each household
   member must explicitly share the pages/databases they want FamiliOS to reach with the
   integration (Share → Invite → the integration's name).

**Env vars:** `HOMEOPS_OAUTH_NOTION_CLIENT_ID`, `HOMEOPS_OAUTH_NOTION_CLIENT_SECRET`

**Verify:** Connections → Notion → Connect Notion → sign in → workspace shows Connected. Run
"Search pages" from the provider drawer (results depend on what was shared with the
integration).

**Sandbox twin: no.** Notion has no sandbox mock (`server/sandbox-connectors.mjs`
`SANDBOX_COVERAGE.notMocked.providers`) — UC-9 and UC-10's Notion half stay honestly
`not_connected` until this is really provisioned.

---

## Todoist — unlocks UC-9

**Console:** [Todoist App Console](https://developer.todoist.com/appconsole.html)

1. **Create a new app.**
2. Set the OAuth redirect URI to the shared redirect URI above.
3. Request the scope below.
4. Copy the Client ID and Client Secret into the env vars below.

| Scope needed | OAuth scope string |
|---|---|
| Read & write tasks | `data:read_write` |

**Env vars:** `HOMEOPS_OAUTH_TODOIST_CLIENT_ID`, `HOMEOPS_OAUTH_TODOIST_CLIENT_SECRET`

**Verify:** Connections → Todoist → Connect Todoist → sign in → account shows Connected. Run
"List tasks" from the provider drawer.

**Sandbox twin: no.** Same honest gap as Notion/TickTick — UC-9's Todoist half stays
`not_connected` until this is really provisioned.

---

## TickTick — unlocks UC-10

**Console:** [TickTick Developer Center](https://developer.ticktick.com/manage) (this URL
has moved before — search "TickTick developer" from your TickTick account if it 404s).

1. Sign in → register a new app.
2. Set the redirect URI to the shared redirect URI above.
3. Request the scopes below.
4. Copy the Client ID and Client Secret into the env vars below.

| Scope needed | OAuth scope string |
|---|---|
| Read tasks | `tasks:read` |
| Create tasks | `tasks:write` |

**Env vars:** `HOMEOPS_OAUTH_TICKTICK_CLIENT_ID`, `HOMEOPS_OAUTH_TICKTICK_CLIENT_SECRET`

**Verify:** Connections → TickTick → Connect TickTick → sign in → account shows Connected.
Run "List projects" from the provider drawer.

**Sandbox twin: no.** UC-10's TickTick half stays `not_connected` until this is really
provisioned.

---

## Amazon Alexa — unlocks UC-13

**Console:** [Login with Amazon Developer Console](https://developer.amazon.com/loginwithamazon/console/site/lwa/overview.html)
(navigation changes periodically — search "Login with Amazon" from developer.amazon.com if
this link moves).

1. **Login with Amazon → Create a New Security Profile.**
2. **Web Settings → Allowed Return URLs** → add the shared redirect URI above.
3. Copy the Client ID and Client Secret into the env vars below.
4. Also set `HOMEOPS_ALEXA_ENDPOINT` to your Alexa Skill-Messaging / event-gateway base URL
   — the OAuth token alone can't reach devices; `server/providers.mjs`'s
   `alexa.listDevices` / `alexa.announce` fail closed with this exact hint until it's set.

| Scope needed | OAuth scope string |
|---|---|
| Amazon profile (identity) | `profile` |
| Announce to & manage Alexa devices | `alexa::async_event:write` |

**Env vars:** `HOMEOPS_OAUTH_ALEXA_CLIENT_ID`, `HOMEOPS_OAUTH_ALEXA_CLIENT_SECRET`

**Verify:** Connections → Amazon Alexa → Connect Amazon Alexa → sign in → account shows
Connected. Run "List Alexa devices" from the provider drawer (needs
`HOMEOPS_ALEXA_ENDPOINT` set too).

**Sandbox twin:** yes — `alexa.listDevices` / `alexa.announce` resolve fixed sandbox
fixtures; the sandbox also fills a synthetic `HOMEOPS_ALEXA_ENDPOINT` if it's unset, only
while `HOMEOPS_CONNECTOR_SANDBOX=1`.

---

## Twilio (Text Messaging connector) — unlocks UC-14

Twilio isn't a first-party OAuth provider — it's the `sms` household connector
(`server/connectors.mjs`), configured with an Account SID / Auth Token / phone number
instead of an OAuth app.

**Console:** [Twilio Console](https://console.twilio.com)

1. Sign in → copy the **Account SID** and **Auth Token** from the dashboard home.
2. Buy or use an existing Twilio phone number (**Phone Numbers → Manage → Buy a number**)
   — this is the "From number".
3. **US traffic:** register an A2P 10DLC campaign and Messaging Service (required by US
   carriers, or sends fail with error 30034) — then copy the Messaging Service SID.
4. Enter the Account SID, Auth Token, From number, and (if applicable) Messaging Service
   SID in **Connections → Text Messaging**, or set the equivalent env vars below.
5. For two-way texting, point the number's inbound webhook at
   `POST <deployment>/api/webhooks/sms` — `server/sms.mjs` validates Twilio's request
   signature before responding.

| Field | Env var | Required |
|---|---|---|
| Account SID | `TWILIO_ACCOUNT_SID` | yes |
| Auth Token | `TWILIO_AUTH_TOKEN` | yes |
| From number | `TWILIO_FROM_NUMBER` | yes |
| Messaging Service SID (A2P 10DLC) | `TWILIO_MESSAGING_SERVICE_SID` | no |

**Verify:** Connections → Text Messaging → Run health check, or approve a "Send text" tool
run and confirm the message arrives on a real phone.

**Sandbox twin:** yes — until real Twilio credentials exist, `sms.send` runs against the
WP-006 sandbox twin and logs the would-be text to `sandbox_effects.json` instead of calling
Twilio, so UC-14 verifies green in sandbox mode. **A real SMS only ever goes out after real
credentials AND explicit user go-ahead** — external send authorization stays with the user
even once Twilio is configured.

---

## Custom HTTP connector — re-enabling a household-revoked connection

This one is different from everything above: it isn't gated on a deployment-level OAuth app
or provider credential at all — it's a per-household connector that an admin can disconnect
(revoke), and re-enabling it is a **resident decision**, not a deployment task. It isn't
part of the WP-012 gated-13 list and it has no sandbox twin (it already runs for real with
no secret beyond the base URL — there's nothing to simulate).

If a household's Custom HTTP connector shows `not_configured` after being revoked:

1. **Connections → Custom HTTP** → open the card.
2. Fill in **Base URL** (and, optionally, an API key header name + key).
3. **Save configuration.** There is no separate "Enable" button — saving the required
   fields is what flips readiness from `not_configured` back to `connected`
   (`server/connectors.mjs` `requiredSatisfied()` / `readinessOf()`).
4. The SSRF egress policy (`server/net.mjs`) still applies regardless of configuration —
   private/loopback/link-local target hosts are always blocked.

**Verify:** Connections → Custom HTTP → Run health check, or run the "GET request" tool
against a real path on your base URL.

---

## Provider → gated-UC quick reference

| Provider / connector | Unlocks | Sandbox twin |
|---|---|---|
| Google | UC-1, UC-2, UC-5, UC-7, UC-12 | yes |
| Microsoft 365 | UC-2, UC-3, UC-4, UC-5, UC-6, UC-7 | yes |
| Slack | UC-3 | yes |
| Dropbox | UC-8 | yes |
| Notion | UC-9, UC-10 | **no** |
| Todoist | UC-9 | **no** |
| TickTick | UC-10 | **no** |
| Amazon Alexa | UC-13 | yes |
| Twilio (sms connector) | UC-14 | yes |

That's all 13 gated use-cases (UC-1..UC-10, UC-12, UC-13, UC-14) named in
`audit/work-packages.md` WP-012. UC-11 (Todoist read-only listing) and UC-15 through UC-22
don't need deployment-level provisioning — they either have a native/no-credential path
already, or their connector runs for real with no secret.
