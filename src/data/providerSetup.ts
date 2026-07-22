/**
 * FamiliOS — per-provider REAL-CREDENTIAL setup checklists (WP-012).
 *
 * This is the single source of truth for "how does an admin/deployer actually turn
 * this connector on" content shown in Connections (src/screens/Connections.tsx) and
 * mirrored in docs/connector-provisioning.md. It intentionally contains no code that
 * runs OAuth flows, no credential entry, and no external calls — Claude/FamiliOS never
 * provisions these apps on the household's behalf (DEC-016). It only documents the
 * REAL console paths, the REAL env var names the deployment must set (kept in lockstep
 * with server/providers.mjs clientIdEnv/clientSecretEnv and server/connectors.mjs
 * configSchema — server/test/provider-setup.test.mjs asserts alignment so this file
 * can't silently drift from the registries it describes), and which gated use-cases
 * (UC-1..10, UC-12..14 per audit/work-packages.md WP-012) each provider unlocks.
 *
 * Console URLs are the real, current landing pages for each provider's developer
 * console as of this writing. Provider consoles are redesigned periodically without
 * notice — entries with a `versionNote` call that out explicitly; treat every menu
 * path here as "may differ" from whatever you actually see.
 */

export interface UCRef {
  /** e.g. "UC-1" — matches tests/topgun/usecases/ucNN.spec.ts naming and audit/work-packages.md. */
  id: string;
  /** Short plain-English title, from the 22-use-case benchmark source list. */
  label: string;
}

export interface ScopeNeeded {
  /** Matches a `key` in the provider's `scopes` array in server/providers.mjs. */
  key: string;
  /** Human label, matches server/providers.mjs scopes[].label. */
  label: string;
  /** The real OAuth scope string an admin will see requested on the consent screen. */
  oauthScope: string;
}

export interface ProviderSetupGuide {
  /** Matches a PROVIDERS[].id in server/providers.mjs. */
  id: string;
  consoleName: string;
  consoleUrl: string;
  /** Set when the console's own navigation/branding is known to shift over time. */
  versionNote?: string;
  /** Ordered app-registration steps, ending with "paste these into the env vars below". */
  steps: string[];
  scopesNeeded: ScopeNeeded[];
  /** How the shared FamiliOS OAuth redirect URI is used at this specific console. */
  redirectUriNote: string;
  /** Deployment env var NAMES only — matches server/providers.mjs clientIdEnv/clientSecretEnv. */
  envVars: string[];
  unlocksUCs: UCRef[];
  /** How to prove it's actually working inside FamiliOS once configured. */
  verify: string;
  /** Honest sandbox-twin status — see server/sandbox-connectors.mjs SANDBOX_COVERAGE. */
  sandboxNote: string;
}

export interface ConnectorConfigFieldRef {
  /** Matches a configSchema[].key in server/connectors.mjs. */
  key: string;
  label: string;
  /** Matches configSchema[].env when the field is also settable via env var. */
  env?: string;
  required: boolean;
}

export interface ConnectorSetupGuide {
  /** Matches a CONNECTORS[].id in server/connectors.mjs. */
  id: string;
  consoleName: string;
  /** Empty string when there is no external console (e.g. the http re-enable path is in-app only). */
  consoleUrl: string;
  versionNote?: string;
  steps: string[];
  configFields: ConnectorConfigFieldRef[];
  unlocksUCs: UCRef[];
  verify: string;
  sandboxNote?: string;
}

// The single shared OAuth callback every provider app registers, one time — see
// server/index.mjs oauthRedirectUri() / server/oauth.mjs buildAuthUrl(). Multiplexed
// by an opaque `state` param, so one URI covers every provider; deployments only ever
// register this one path (not a per-provider callback).
export const SHARED_REDIRECT_PATH = "/api/oauth/callback";

const SANDBOXED_NOTE =
  "Until real credentials exist, this provider's tools run against the WP-006 sandbox twin " +
  "(set HOMEOPS_CONNECTOR_SANDBOX=1) — deterministic fixtures stand in for the live API, and a per-tenant " +
  "sandbox_effects.json record proves what WOULD have gone out. See server/test/README-sandbox.md.";
const NOT_SANDBOXED_NOTE =
  "This provider has NO sandbox twin (server/sandbox-connectors.mjs SANDBOX_COVERAGE.notMocked.providers) — " +
  "until real credentials exist, its gated use-case(s) stay honestly not_connected. There is no simulated pass " +
  "to fall back on here; real provisioning is the only way to turn these green.";

export const PROVIDER_SETUP_GUIDES: Record<string, ProviderSetupGuide> = {
  google: {
    id: "google",
    consoleName: "Google Cloud Console",
    consoleUrl: "https://console.cloud.google.com/apis/credentials",
    versionNote: "Google Cloud Console's menu layout changes periodically — treat exact click paths as approximate.",
    steps: [
      "Create or select a project in the Google Cloud Console.",
      "APIs & Services → Library → enable: Gmail API, Google Calendar API, Google Drive API, and (for smart-home only) Smart Device Management API.",
      "APIs & Services → OAuth consent screen → configure it (External or Internal) and add the scopes listed below. Add test users if the app stays in Testing mode.",
      "APIs & Services → Credentials → Create Credentials → OAuth client ID → Application type: Web application.",
      "Add the FamiliOS redirect URI (shown above) as an Authorized redirect URI.",
      "Copy the Client ID and Client Secret into the deployment env vars below.",
      "Smart-home only (unlocks UC-12): also register a Device Access project at the Device Access Console (console.nest.google.com/device-access — one-time registration fee) and set HOMEOPS_SDM_PROJECT_ID to that project id.",
    ],
    scopesNeeded: [
      { key: "openid", label: "Basic identity", oauthScope: "openid" },
      { key: "email", label: "See your email address", oauthScope: "https://www.googleapis.com/auth/userinfo.email" },
      { key: "gmail.read", label: "Read Gmail", oauthScope: "https://www.googleapis.com/auth/gmail.readonly" },
      { key: "gmail.send", label: "Send email", oauthScope: "https://www.googleapis.com/auth/gmail.send" },
      { key: "gmail.modify", label: "Organize inbox (labels, archive)", oauthScope: "https://www.googleapis.com/auth/gmail.modify" },
      { key: "calendar", label: "Manage calendar events", oauthScope: "https://www.googleapis.com/auth/calendar.events" },
      { key: "drive", label: "Read Google Drive", oauthScope: "https://www.googleapis.com/auth/drive.readonly" },
      { key: "smarthome", label: "Google Home devices (Nest thermostats, cameras)", oauthScope: "https://www.googleapis.com/auth/sdm.service" },
    ],
    redirectUriNote: "Paste the redirect URI shown above (the FamiliOS deployment's single OAuth callback) as an Authorized redirect URI on the OAuth client.",
    envVars: ["HOMEOPS_OAUTH_GOOGLE_CLIENT_ID", "HOMEOPS_OAUTH_GOOGLE_CLIENT_SECRET"],
    unlocksUCs: [
      { id: "UC-1", label: "School Correspondence Organizer" },
      { id: "UC-2", label: "Emergency Work-to-Home Forwarder" },
      { id: "UC-5", label: "Cross-Calendar Conflict Sync" },
      { id: "UC-7", label: "Secure Document Cloud Sync" },
      { id: "UC-12", label: "Smart Climate Night-Mode" },
    ],
    verify: "Connections → Google → Connect Google → sign in → the account shows Connected. Run \"Search inbox\" or \"List events\" from the provider drawer to confirm a live Gmail/Calendar call.",
    sandboxNote: SANDBOXED_NOTE,
  },

  microsoft: {
    id: "microsoft",
    consoleName: "Microsoft Entra admin center — App registrations",
    consoleUrl: "https://entra.microsoft.com/",
    versionNote: "Microsoft has renamed this console before (Azure AD → Microsoft Entra ID) and may again — search \"App registrations\" from entra.microsoft.com or portal.azure.com if this link moves.",
    steps: [
      "Identity → Applications → App registrations → New registration.",
      "Add a redirect URI of type \"Web\" set to the FamiliOS redirect URI shown above.",
      "Certificates & secrets → New client secret — copy the VALUE immediately, it is shown once.",
      "API permissions → Add a permission → Microsoft Graph → Delegated permissions → add the scopes listed below. Grant admin consent if your tenant requires it.",
      "Overview page → copy the Application (client) ID and the client secret value into the env vars below.",
    ],
    scopesNeeded: [
      { key: "offline", label: "Stay connected", oauthScope: "offline_access" },
      { key: "mail.read", label: "Read Outlook mail", oauthScope: "Mail.Read" },
      { key: "mail.send", label: "Send Outlook mail", oauthScope: "Mail.Send" },
      { key: "calendar", label: "Manage calendar", oauthScope: "Calendars.ReadWrite" },
      { key: "files", label: "Read OneDrive", oauthScope: "Files.Read" },
    ],
    redirectUriNote: "Register the redirect URI shown above as a Web platform redirect URI on the app registration.",
    envVars: ["HOMEOPS_OAUTH_MICROSOFT_CLIENT_ID", "HOMEOPS_OAUTH_MICROSOFT_CLIENT_SECRET"],
    unlocksUCs: [
      { id: "UC-2", label: "Emergency Work-to-Home Forwarder" },
      { id: "UC-3", label: "Urgent Slack Escalation" },
      { id: "UC-4", label: "Grandparent Weekly Digest" },
      { id: "UC-5", label: "Cross-Calendar Conflict Sync" },
      { id: "UC-6", label: "Corporate Hold Generator" },
      { id: "UC-7", label: "Secure Document Cloud Sync" },
    ],
    verify: "Connections → Microsoft 365 → Connect Microsoft 365 → sign in → the account shows Connected. Run \"Search mail\" or \"List events\" from the provider drawer to confirm a live Graph call.",
    sandboxNote: SANDBOXED_NOTE,
  },

  slack: {
    id: "slack",
    consoleName: "api.slack.com/apps",
    consoleUrl: "https://api.slack.com/apps",
    steps: [
      "Create New App → From scratch → name it and pick the workspace.",
      "OAuth & Permissions → Redirect URLs → add the FamiliOS redirect URI shown above.",
      "OAuth & Permissions → Scopes → Bot Token Scopes → add the scopes listed below.",
      "Basic Information → App Credentials → copy the Client ID and Client Secret into the env vars below.",
      "Distribute App (or install directly to the workspace) so members can complete FamiliOS's own per-user OAuth connect.",
    ],
    scopesNeeded: [
      { key: "channels", label: "List channels", oauthScope: "channels:read" },
      { key: "chat", label: "Post messages", oauthScope: "chat:write" },
      { key: "users", label: "Read members", oauthScope: "users:read" },
    ],
    redirectUriNote: "Add the redirect URI shown above under OAuth & Permissions → Redirect URLs.",
    envVars: ["HOMEOPS_OAUTH_SLACK_CLIENT_ID", "HOMEOPS_OAUTH_SLACK_CLIENT_SECRET"],
    unlocksUCs: [{ id: "UC-3", label: "Urgent Slack Escalation" }],
    verify: "Connections → Slack → Connect Slack → sign in → the workspace shows Connected. Run \"List channels\" from the provider drawer to confirm a live call.",
    sandboxNote: SANDBOXED_NOTE,
  },

  dropbox: {
    id: "dropbox",
    consoleName: "Dropbox App Console",
    consoleUrl: "https://www.dropbox.com/developers/apps",
    steps: [
      "Create app → Scoped access → choose Full Dropbox or App folder access → name the app.",
      "Settings tab → OAuth 2 → Redirect URIs → add the FamiliOS redirect URI shown above.",
      "Permissions tab → enable the scopes listed below, then Submit.",
      "Settings tab → copy the App key (Client ID) and App secret (Client Secret) into the env vars below.",
    ],
    scopesNeeded: [
      { key: "read", label: "Read file list", oauthScope: "files.metadata.read" },
      { key: "write", label: "Create folders/files", oauthScope: "files.content.write" },
    ],
    redirectUriNote: "Add the redirect URI shown above under Settings → OAuth 2 → Redirect URIs.",
    envVars: ["HOMEOPS_OAUTH_DROPBOX_CLIENT_ID", "HOMEOPS_OAUTH_DROPBOX_CLIENT_SECRET"],
    unlocksUCs: [{ id: "UC-8", label: "Secure Archive Builder" }],
    verify: "Connections → Dropbox → Connect Dropbox → sign in → the account shows Connected. Run \"List files\" from the provider drawer to confirm a live call.",
    sandboxNote: SANDBOXED_NOTE,
  },

  notion: {
    id: "notion",
    consoleName: "Notion — My integrations",
    consoleUrl: "https://www.notion.so/my-integrations",
    steps: [
      "New integration → choose \"Public integration\" (required for the OAuth flow FamiliOS uses — an Internal integration uses a fixed token instead and won't work here).",
      "OAuth Domain & URIs → add the FamiliOS redirect URI shown above.",
      "Copy the OAuth client ID and client secret into the env vars below.",
      "Notion access is page-scoped, not scope-based: after connecting, each household member must explicitly share the pages/databases they want FamiliOS to reach with the integration (Share → Invite → the integration's name).",
    ],
    scopesNeeded: [{ key: "content", label: "Read & write shared pages", oauthScope: "(page-level share, not an OAuth scope string)" }],
    redirectUriNote: "Add the redirect URI shown above under OAuth Domain & URIs.",
    envVars: ["HOMEOPS_OAUTH_NOTION_CLIENT_ID", "HOMEOPS_OAUTH_NOTION_CLIENT_SECRET"],
    unlocksUCs: [
      { id: "UC-9", label: "Database-to-Checklist Pipeline" },
      { id: "UC-10", label: "Vacation Project Onboarding" },
    ],
    verify: "Connections → Notion → Connect Notion → sign in → the workspace shows Connected. Run \"Search pages\" from the provider drawer to confirm a live call (results depend on which pages were shared with the integration).",
    sandboxNote: NOT_SANDBOXED_NOTE,
  },

  todoist: {
    id: "todoist",
    consoleName: "Todoist App Console",
    consoleUrl: "https://developer.todoist.com/appconsole.html",
    steps: [
      "Create a new app.",
      "Set the OAuth redirect URI to the FamiliOS redirect URI shown above.",
      "Request the scope listed below.",
      "Copy the Client ID and Client Secret into the env vars below.",
    ],
    scopesNeeded: [{ key: "rw", label: "Read & write tasks", oauthScope: "data:read_write" }],
    redirectUriNote: "Set the OAuth redirect URI to the value shown above.",
    envVars: ["HOMEOPS_OAUTH_TODOIST_CLIENT_ID", "HOMEOPS_OAUTH_TODOIST_CLIENT_SECRET"],
    unlocksUCs: [{ id: "UC-9", label: "Database-to-Checklist Pipeline" }],
    verify: "Connections → Todoist → Connect Todoist → sign in → the account shows Connected. Run \"List tasks\" from the provider drawer to confirm a live call.",
    sandboxNote: NOT_SANDBOXED_NOTE,
  },

  ticktick: {
    id: "ticktick",
    consoleName: "TickTick Developer Center",
    consoleUrl: "https://developer.ticktick.com/manage",
    versionNote: "TickTick's developer console URL/name has moved before — search \"TickTick developer\" from your TickTick account if this link 404s.",
    steps: [
      "Sign in with your TickTick account → register a new app.",
      "Set the redirect URI to the FamiliOS redirect URI shown above.",
      "Request the scopes listed below.",
      "Copy the Client ID and Client Secret into the env vars below.",
    ],
    scopesNeeded: [
      { key: "read", label: "Read tasks", oauthScope: "tasks:read" },
      { key: "write", label: "Create tasks", oauthScope: "tasks:write" },
    ],
    redirectUriNote: "Set the redirect URI to the value shown above.",
    envVars: ["HOMEOPS_OAUTH_TICKTICK_CLIENT_ID", "HOMEOPS_OAUTH_TICKTICK_CLIENT_SECRET"],
    unlocksUCs: [{ id: "UC-10", label: "Vacation Project Onboarding" }],
    verify: "Connections → TickTick → Connect TickTick → sign in → the account shows Connected. Run \"List projects\" from the provider drawer to confirm a live call.",
    sandboxNote: NOT_SANDBOXED_NOTE,
  },

  "amazon-alexa": {
    id: "amazon-alexa",
    consoleName: "Login with Amazon Developer Console",
    consoleUrl: "https://developer.amazon.com/loginwithamazon/console/site/lwa/overview.html",
    versionNote: "Amazon's developer console navigation changes periodically — search \"Login with Amazon\" from developer.amazon.com if this link moves.",
    steps: [
      "Login with Amazon → Create a New Security Profile.",
      "Web Settings → Allowed Return URLs → add the FamiliOS redirect URI shown above.",
      "Copy the Client ID and Client Secret into the env vars below.",
      "Also set HOMEOPS_ALEXA_ENDPOINT to your Alexa Skill-Messaging / event-gateway base URL — the OAuth token alone can't reach devices; server/providers.mjs's alexa.listDevices / alexa.announce fail closed with this exact hint until it's set.",
    ],
    scopesNeeded: [
      { key: "profile", label: "Amazon profile (identity)", oauthScope: "profile" },
      { key: "alexa", label: "Announce to & manage Alexa devices", oauthScope: "alexa::async_event:write" },
    ],
    redirectUriNote: "Add the redirect URI shown above under Web Settings → Allowed Return URLs.",
    envVars: ["HOMEOPS_OAUTH_ALEXA_CLIENT_ID", "HOMEOPS_OAUTH_ALEXA_CLIENT_SECRET"],
    unlocksUCs: [{ id: "UC-13", label: "Smart Speaker Dinner Bell" }],
    verify: "Connections → Amazon Alexa → Connect Amazon Alexa → sign in → the account shows Connected. Run \"List Alexa devices\" from the provider drawer to confirm a live call (needs HOMEOPS_ALEXA_ENDPOINT set too).",
    sandboxNote: SANDBOXED_NOTE,
  },
};

export const CONNECTOR_SETUP_GUIDES: Record<string, ConnectorSetupGuide> = {
  sms: {
    id: "sms",
    consoleName: "Twilio Console",
    consoleUrl: "https://console.twilio.com",
    steps: [
      "Sign in to the Twilio Console → copy the Account SID and Auth Token from the dashboard home.",
      "Buy or use an existing Twilio phone number (Phone Numbers → Manage → Buy a number) — this is the \"From number\".",
      "US traffic: register an A2P 10DLC campaign and Messaging Service (required by US carriers, or sends fail with error 30034) — then copy the Messaging Service SID.",
      "Enter the Account SID, Auth Token, From number, and (if applicable) Messaging Service SID in Connections → Text Messaging, or set the equivalent env vars below.",
      "For two-way texting, point the number's inbound webhook at POST {deployment}/api/webhooks/sms — server/sms.mjs validates Twilio's request signature before responding.",
    ],
    configFields: [
      { key: "accountSid", label: "Account SID", env: "TWILIO_ACCOUNT_SID", required: true },
      { key: "authToken", label: "Auth Token", env: "TWILIO_AUTH_TOKEN", required: true },
      { key: "fromNumber", label: "From number", env: "TWILIO_FROM_NUMBER", required: true },
      { key: "messagingServiceSid", label: "Messaging Service SID (A2P 10DLC)", env: "TWILIO_MESSAGING_SERVICE_SID", required: false },
    ],
    unlocksUCs: [{ id: "UC-14", label: "Morning Status Text" }],
    verify: "Connections → Text Messaging → Run health check, or approve a \"Send text\" tool run and confirm the message arrives on a real phone.",
    sandboxNote:
      "Until real Twilio credentials exist, sms.send runs against the WP-006 sandbox twin (HOMEOPS_CONNECTOR_SANDBOX=1) and " +
      "logs the would-be text to sandbox_effects.json instead of calling Twilio — UC-14 verifies green in sandbox mode. A real " +
      "SMS only ever goes out after real credentials AND explicit user go-ahead (external send authorization stays with the user).",
  },
  http: {
    id: "http",
    consoleName: "FamiliOS Connections (no external console — this is a household-owned setting, not a deployment credential)",
    consoleUrl: "",
    steps: [
      "This household's Custom HTTP connector was disconnected (revoked) by a household admin — re-enabling it is a resident decision, not something a deployment does automatically.",
      "To re-enable: Connections → Custom HTTP → open the card → fill in Base URL (and, optionally, an API key header name + key) → Save configuration.",
      "There is no separate \"Enable\" button — saving the required fields is what flips readiness from not_configured back to connected (server/connectors.mjs requiredSatisfied() / readinessOf()).",
      "The SSRF egress policy (server/net.mjs) still applies regardless — private/loopback/link-local target hosts are always blocked, configured or not.",
    ],
    configFields: [
      { key: "baseUrl", label: "Base URL", required: true },
      { key: "apiKeyHeader", label: "API key header name", required: false },
      { key: "apiKey", label: "API key", required: false },
    ],
    unlocksUCs: [{ id: "UC-15", label: "Family Dashboard API Bridge" }],
    verify: "Connections → Custom HTTP → Run health check, or run the \"GET request\" tool against a real path on your base URL.",
    // http already runs for real with no secret required beyond the base URL — it was never
    // part of the WP-006 sandbox twin (see SANDBOX_COVERAGE.notMocked.connectors) because
    // there's nothing to simulate: an unconfigured http connector fails honestly today.
  },
};
