// FamiliOS connector platform — first-party provider registry + scope catalog +
// declarative tool manifests. No managed connector provider is used.
//
// Client credentials are read from deployment ENVIRONMENT VARIABLES only and are
// never serialized to any API response. Tool executors receive a bound `api()`
// that calls the real provider with the connected account's token (auto-refresh).
// Health/identity are real network calls — nothing here is seeded or simulated.

import { buildRawEmail } from "./mime.mjs";

const env = (name) => (name ? process.env[name] : undefined);
// WP-006: local env check (NOT an import of sandbox-connectors.mjs, which would pull
// in store.mjs and break the pure-registry tests that import providers.mjs with no
// data dir). Kept in lockstep with sandbox-connectors.mjs sandboxEnabled().
const sandboxOn = () => process.env.HOMEOPS_CONNECTOR_SANDBOX === "1";

/**
 * Each ProviderDef:
 *  - authType: "oauth2"
 *  - clientIdEnv / clientSecretEnv: deployment env var NAMES (values never leave the server)
 *  - tokenAuth: "body" | "basic"      (how client creds are presented at token exchange)
 *  - tokenStyle: "form" | "json"
 *  - scopes: catalog entries the consent screen lists
 *  - identityFromToken(raw) OR identity(api): resolve { externalAccountId, displayName }
 *  - health(api): real reachability check
 *  - tools: declarative manifests with run(api, input)
 * `api(url, opts)` resolves to { ok, status, json, text }.
 */
export const PROVIDERS = [
  {
    id: "google",
    name: "Google",
    category: "Email, Calendar & Drive",
    authType: "oauth2",
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    usePKCE: true, scopeSeparator: " ", refresh: "rotating",
    tokenAuth: "body", tokenStyle: "form",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
    clientIdEnv: "HOMEOPS_OAUTH_GOOGLE_CLIENT_ID",
    clientSecretEnv: "HOMEOPS_OAUTH_GOOGLE_CLIENT_SECRET",
    scopes: [
      // Identity scopes — enable no tools; they let the connect flow resolve the REAL
      // account email so Connections shows "alex@…" instead of the literal "Google account".
      { key: "openid", oauthScope: "openid", label: "Basic identity", risk: "Low", enablesTools: [] },
      { key: "email", oauthScope: "https://www.googleapis.com/auth/userinfo.email", label: "See your email address", risk: "Low", enablesTools: [] },
      { key: "gmail.read", oauthScope: "https://www.googleapis.com/auth/gmail.readonly", label: "Read Gmail", risk: "Sensitive", enablesTools: ["gmail.search"] },
      { key: "gmail.send", oauthScope: "https://www.googleapis.com/auth/gmail.send", label: "Send email", risk: "High", enablesTools: ["gmail.send"] },
      { key: "gmail.modify", oauthScope: "https://www.googleapis.com/auth/gmail.modify", label: "Organize inbox (labels, archive)", risk: "High", enablesTools: ["gmail.listLabels", "gmail.modifyLabels"] },
      { key: "calendar", oauthScope: "https://www.googleapis.com/auth/calendar.events", label: "Manage calendar events", risk: "Medium", enablesTools: ["calendar.list", "calendar.create"] },
      { key: "drive", oauthScope: "https://www.googleapis.com/auth/drive.readonly", label: "Read Google Drive", risk: "Medium", enablesTools: ["drive.list"] },
      // Google Home / Nest (SDM) lives here as a permission ON the Google connector, so you grant
      // it alongside Gmail/Calendar/Drive. Actual device calls still need a Device Access project
      // id (HOMEOPS_SDM_PROJECT_ID) — the tools fail closed with a setup hint until it's set.
      { key: "smarthome", oauthScope: "https://www.googleapis.com/auth/sdm.service", label: "Google Home devices (Nest thermostats, cameras)", risk: "High", enablesTools: ["smarthome.listDevices", "smarthome.setThermostat"] },
    ],
    identity: async (api) => {
      // userinfo needs the email/openid scopes; accounts connected before those existed
      // (or with them declined) fall back to the Gmail profile, then the honest literal.
      const r = await api("https://www.googleapis.com/oauth2/v2/userinfo");
      let email = r.json?.email ?? null;
      let externalId = r.json?.id ?? null;
      if (!email) {
        const p = await api("https://gmail.googleapis.com/gmail/v1/users/me/profile");
        email = p.json?.emailAddress ?? null;
      }
      return { externalAccountId: externalId ?? email ?? "google", displayName: email ?? "Google account" };
    },
    health: async (api) => { const r = await api("https://gmail.googleapis.com/gmail/v1/users/me/profile"); return { ok: r.ok, status: r.ok ? "healthy" : "error", detail: r.json?.emailAddress }; },
    tools: [
      { id: "gmail.search", name: "Search inbox", action: "Read", risk: "Sensitive", requiresApproval: false, delivers: false, scopes: ["gmail.read"], inputs: [{ key: "query", label: "Search query", type: "text", default: "newer_than:7d" }, { key: "maxResults", label: "Max results (≤250, paginates automatically)", type: "text", default: "50" }],
        run: async (api, input) => {
          const query = input.query || "newer_than:7d";
          const q = encodeURIComponent(query);
          const max = Math.min(Math.max(parseInt(input.maxResults, 10) || 50, 1), 250);
          // Paginate the id list until `max` or the query is exhausted (one run covers
          // everything, not just the first page).
          const ids = [];
          let pageToken = null;
          let totalMatched = 0;
          while (ids.length < max) {
            const page = Math.min(max - ids.length, 100);
            const r = await api(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${page}&q=${q}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
            if (!r.ok) throw new Error(r.json?.error?.message ?? "Gmail search failed");
            totalMatched = r.json.resultSizeEstimate ?? totalMatched;
            for (const m of r.json.messages ?? []) ids.push(m.id);
            pageToken = r.json.nextPageToken ?? null;
            if (!pageToken || (r.json.messages ?? []).length === 0) break;
          }
          // Metadata fetched CONCURRENTLY in chunks, and kept compact (trimmed subject/
          // from/snippet, category labels only) so a downstream reasoning step can hold
          // the ENTIRE result set in context — completeness beats verbosity here.
          const messages = [];
          for (let i = 0; i < ids.length; i += 25) {
            const chunk = ids.slice(i, i + 25);
            const metas = await Promise.all(chunk.map((id) =>
              api(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`).catch(() => null)));
            for (let j = 0; j < chunk.length; j++) {
              const mj = metas[j]?.json;
              if (!mj) continue;
              const hdr = (n) => mj.payload?.headers?.find((h) => h.name === n)?.value;
              const labels = (mj.labelIds ?? []).filter((l) => l === "INBOX" || l === "UNREAD" || l.startsWith("CATEGORY_"));
              messages.push({ id: chunk[j], subject: String(hdr("Subject") ?? "").slice(0, 90), from: String(hdr("From") ?? "").slice(0, 60), snippet: String(mj.snippet ?? "").slice(0, 90), labelIds: labels });
            }
          }
          return { query, count: messages.length, totalMatched, complete: !pageToken, messages };
        } },
      { id: "gmail.listLabels", name: "List Gmail labels", action: "Read", risk: "Low", requiresApproval: false, delivers: false, scopes: ["gmail.modify"], inputs: [],
        run: async (api) => {
          const r = await api("https://gmail.googleapis.com/gmail/v1/users/me/labels");
          if (!r.ok) throw new Error(r.json?.error?.message ?? "Couldn't list labels — reconnect Google with the new inbox-organize permission.");
          return { count: (r.json.labels ?? []).length, labels: (r.json.labels ?? []).map((l) => ({ id: l.id, name: l.name, type: l.type })) };
        } },
      { id: "gmail.modifyLabels", name: "Label / move messages", action: "Write", risk: "High", requiresApproval: true, delivers: false, scopes: ["gmail.modify"],
        inputs: [
          { key: "messageIds", label: "Message IDs (comma-separated, from Search inbox)", type: "text", required: true },
          { key: "addLabels", label: "Add labels (names or IDs, comma-separated — e.g. Social or CATEGORY_SOCIAL)", type: "text" },
          { key: "removeLabels", label: "Remove labels (e.g. INBOX to archive, UNREAD to mark read)", type: "text" },
        ],
        run: async (api, input) => {
          const ids = String(input.messageIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
          if (ids.length === 0) throw new Error("Provide at least one message ID (use Search inbox first).");
          if (ids.length > 500) throw new Error("Too many messages at once — cap is 500 per call.");
          const wantAdd = String(input.addLabels ?? "").split(",").map((s) => s.trim()).filter(Boolean);
          const wantRemove = String(input.removeLabels ?? "").split(",").map((s) => s.trim()).filter(Boolean);
          if (wantAdd.length === 0 && wantRemove.length === 0) throw new Error("Provide addLabels and/or removeLabels.");
          // Resolve label names → IDs (case-insensitive); auto-create missing USER labels
          // on the add side only (never invent system labels on remove).
          const lr = await api("https://gmail.googleapis.com/gmail/v1/users/me/labels");
          if (!lr.ok) throw new Error(lr.json?.error?.message ?? "Couldn't read labels — reconnect Google with the new inbox-organize permission.");
          const known = lr.json.labels ?? [];
          const findId = (nameOrId) => known.find((l) => l.id === nameOrId || l.name.toLowerCase() === nameOrId.toLowerCase())?.id ?? null;
          const addLabelIds = [];
          const createdLabels = [];
          for (const want of wantAdd) {
            let id = findId(want);
            if (!id) {
              const cr = await api("https://gmail.googleapis.com/gmail/v1/users/me/labels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: want, labelListVisibility: "labelShow", messageListVisibility: "show" }) });
              if (!cr.ok) throw new Error(cr.json?.error?.message ?? `Couldn't create label "${want}".`);
              id = cr.json.id; createdLabels.push(want);
            }
            addLabelIds.push(id);
          }
          // Removing a label that doesn't exist is a semantic no-op (e.g. "CATEGORY_PRIMARY"
          // isn't a real Gmail label — Primary is the absence of other categories, and adding
          // a category label recategorizes automatically). Skip-and-report, never fail the batch.
          const removeLabelIds = [];
          const skippedRemove = [];
          for (const want of wantRemove) {
            const id = findId(want);
            if (id) removeLabelIds.push(id); else skippedRemove.push(want);
          }
          if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
            return { modified: 0, added: [], removed: [], createdLabels, skippedRemove, note: "Nothing to change — no resolvable labels." };
          }
          const r = await api("https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ ids, ...(addLabelIds.length ? { addLabelIds } : {}), ...(removeLabelIds.length ? { removeLabelIds } : {}) }),
          });
          if (!r.ok && r.status !== 204) throw new Error(r.json?.error?.message ?? "Gmail batch modify failed");
          const removedApplied = wantRemove.filter((w) => !skippedRemove.includes(w));
          return { modified: ids.length, added: wantAdd, removed: removedApplied, createdLabels, ...(skippedRemove.length ? { skippedRemove, note: `Skipped non-existent label(s) on remove: ${skippedRemove.join(", ")} (no-op).` } : {}) };
        } },
      { id: "gmail.send", name: "Send email", action: "Send", risk: "High", requiresApproval: true, delivers: true, scopes: ["gmail.send"], inputs: [{ key: "to", label: "To", type: "text", required: true }, { key: "subject", label: "Subject", type: "text", required: true }, { key: "body", label: "Message", type: "textarea" }],
        run: async (api, input) => {
          // Validation fires BEFORE any Google call (e.code lets callers report the
          // honest `invalid_input` instead of a generic provider_error).
          if (!input.to || !input.subject) throw Object.assign(new Error("Provide `to` and `subject`."), { code: "invalid_input" });
          if (!String(input.body ?? "").trim()) throw Object.assign(new Error("Refusing to send an email with an empty body — compose the message body first."), { code: "invalid_input" });
          const raw = buildRawEmail({ to: input.to, subject: input.subject, text: input.body ?? "" });
          const r = await api("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ raw }) });
          if (!r.ok) throw new Error(r.json?.error?.message ?? "Gmail send failed");
          return { sent: true, id: r.json.id, to: input.to };
        } },
      { id: "calendar.list", name: "List events", action: "Read", risk: "Low", requiresApproval: false, delivers: false, scopes: ["calendar"], inputs: [],
        run: async (api) => { const r = await api(`https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=10&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(new Date().toISOString())}`); return { count: (r.json.items ?? []).length, events: (r.json.items ?? []).map((e) => ({ summary: e.summary, start: e.start?.dateTime ?? e.start?.date, location: e.location })) }; } },
      { id: "calendar.create", name: "Create event", action: "Write", risk: "Medium", requiresApproval: true, delivers: false, scopes: ["calendar"], inputs: [{ key: "summary", label: "Title", type: "text", required: true }, { key: "start", label: "Start (ISO)", type: "text", required: true }, { key: "location", label: "Location", type: "text" }],
        run: async (api, input) => {
          if (!input.summary || !input.start) throw new Error("Provide `summary` and `start`.");
          const end = new Date(new Date(input.start).getTime() + 3600000).toISOString();
          const r = await api("https://www.googleapis.com/calendar/v3/calendars/primary/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ summary: input.summary, start: { dateTime: input.start }, end: { dateTime: end }, location: input.location }) });
          if (!r.ok) throw new Error(r.json?.error?.message ?? "Calendar create failed");
          return { created: true, id: r.json.id, htmlLink: r.json.htmlLink };
        } },
      { id: "drive.list", name: "List recent files", action: "Read", risk: "Medium", requiresApproval: false, delivers: false, scopes: ["drive"], inputs: [],
        run: async (api) => { const r = await api("https://www.googleapis.com/drive/v3/files?pageSize=10&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime)"); return { count: (r.json.files ?? []).length, files: (r.json.files ?? []).map((f) => ({ id: f.id, name: f.name, type: f.mimeType, modified: f.modifiedTime })) }; } },
      // Google Home / Nest (SDM). Needs a Device Access project id (HOMEOPS_SDM_PROJECT_ID);
      // fails closed with a setup hint until it's set — never fakes success.
      { id: "smarthome.listDevices", name: "List Google Home devices", action: "Read", risk: "Low", requiresApproval: false, delivers: false, scopes: ["smarthome"], inputs: [],
        run: async (api) => {
          const projectId = env("HOMEOPS_SDM_PROJECT_ID");
          if (!projectId) throw new Error("Google Home isn't set up yet — set HOMEOPS_SDM_PROJECT_ID to your Device Access project id (from the SDM Device Access console).");
          const r = await api(`https://smartdevicemanagement.googleapis.com/v1/enterprises/${projectId}/devices`);
          if (!r.ok) throw new Error(r.json?.error?.message ?? "Couldn't list Google Home devices.");
          return { count: (r.json?.devices ?? []).length, devices: (r.json?.devices ?? []).map((d) => ({ name: d.name, type: d.type, room: d.parentRelations?.[0]?.displayName ?? null })) };
        } },
      { id: "smarthome.setThermostat", name: "Set thermostat", action: "Write", risk: "Medium", requiresApproval: true, delivers: false, scopes: ["smarthome"],
        inputs: [{ key: "deviceId", label: "Device id (from List devices)", type: "text", required: true }, { key: "celsius", label: "Heat setpoint °C", type: "text", required: true }],
        run: async (api, input) => {
          const projectId = env("HOMEOPS_SDM_PROJECT_ID");
          if (!projectId) throw new Error("Google Home isn't set up yet — set HOMEOPS_SDM_PROJECT_ID to your Device Access project id (from the SDM Device Access console).");
          if (!input.deviceId) throw new Error("Provide a `deviceId` (use List devices first).");
          const celsius = Number(input.celsius);
          if (!Number.isFinite(celsius)) throw new Error("Provide a numeric `celsius` heat setpoint.");
          const command = { command: "sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat", params: { heatCelsius: celsius } };
          const r = await api(`https://smartdevicemanagement.googleapis.com/v1/enterprises/${projectId}/devices/${encodeURIComponent(input.deviceId)}:executeCommand`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(command) });
          if (!r.ok) throw new Error(r.json?.error?.message ?? "Thermostat command failed");
          return { ok: true, deviceId: input.deviceId, heatCelsius: celsius };
        } },
    ],
  },

  {
    id: "microsoft",
    name: "Microsoft 365",
    category: "Outlook, Calendar & OneDrive",
    authType: "oauth2",
    authUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    usePKCE: true, scopeSeparator: " ", refresh: "rotating",
    tokenAuth: "body", tokenStyle: "form",
    clientIdEnv: "HOMEOPS_OAUTH_MICROSOFT_CLIENT_ID",
    clientSecretEnv: "HOMEOPS_OAUTH_MICROSOFT_CLIENT_SECRET",
    scopes: [
      { key: "offline", oauthScope: "offline_access", label: "Stay connected", risk: "Low", enablesTools: [] },
      { key: "mail.read", oauthScope: "Mail.Read", label: "Read Outlook mail", risk: "Sensitive", enablesTools: ["outlook.search"] },
      { key: "mail.send", oauthScope: "Mail.Send", label: "Send Outlook mail", risk: "High", enablesTools: ["outlook.send"] },
      { key: "calendar", oauthScope: "Calendars.ReadWrite", label: "Manage calendar", risk: "Medium", enablesTools: ["mscal.list", "mscal.create"] },
      { key: "files", oauthScope: "Files.Read", label: "Read OneDrive", risk: "Medium", enablesTools: ["onedrive.list"] },
    ],
    identity: async (api) => { const r = await api("https://graph.microsoft.com/v1.0/me"); return { externalAccountId: r.json?.id, displayName: r.json?.userPrincipalName ?? r.json?.mail ?? "Microsoft account" }; },
    health: async (api) => { const r = await api("https://graph.microsoft.com/v1.0/me"); return { ok: r.ok, status: r.ok ? "healthy" : "error" }; },
    tools: [
      { id: "outlook.search", name: "Search mail", action: "Read", risk: "Sensitive", requiresApproval: false, delivers: false, scopes: ["mail.read"], inputs: [],
        run: async (api) => { const r = await api("https://graph.microsoft.com/v1.0/me/messages?$top=5&$select=subject,from,bodyPreview"); return { count: (r.json.value ?? []).length, messages: (r.json.value ?? []).map((m) => ({ subject: m.subject, from: m.from?.emailAddress?.address, snippet: m.bodyPreview })) }; } },
      { id: "outlook.send", name: "Send mail", action: "Send", risk: "High", requiresApproval: true, delivers: true, scopes: ["mail.send"], inputs: [{ key: "to", label: "To", type: "text", required: true }, { key: "subject", label: "Subject", type: "text", required: true }, { key: "body", label: "Message", type: "textarea" }],
        run: async (api, input) => { if (!input.to || !input.subject) throw new Error("Provide `to` and `subject`."); const r = await api("https://graph.microsoft.com/v1.0/me/sendMail", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: { subject: input.subject, body: { contentType: "Text", content: input.body ?? "" }, toRecipients: [{ emailAddress: { address: input.to } }] } }) }); if (!r.ok) throw new Error(r.json?.error?.message ?? "Send failed"); return { sent: true, to: input.to }; } },
      { id: "mscal.list", name: "List events", action: "Read", risk: "Low", requiresApproval: false, delivers: false, scopes: ["calendar"], inputs: [],
        run: async (api) => { const r = await api("https://graph.microsoft.com/v1.0/me/events?$top=10&$select=subject,start,location"); return { count: (r.json.value ?? []).length, events: (r.json.value ?? []).map((e) => ({ summary: e.subject, start: e.start?.dateTime, location: e.location?.displayName })) }; } },
      { id: "mscal.create", name: "Create event", action: "Write", risk: "Medium", requiresApproval: true, delivers: false, scopes: ["calendar"], inputs: [{ key: "summary", label: "Title", type: "text", required: true }, { key: "start", label: "Start (ISO)", type: "text", required: true }],
        run: async (api, input) => { if (!input.summary || !input.start) throw new Error("Provide `summary` and `start`."); const end = new Date(new Date(input.start).getTime() + 3600000).toISOString(); const r = await api("https://graph.microsoft.com/v1.0/me/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject: input.summary, start: { dateTime: input.start, timeZone: "UTC" }, end: { dateTime: end, timeZone: "UTC" } }) }); if (!r.ok) throw new Error(r.json?.error?.message ?? "Create failed"); return { created: true, id: r.json.id }; } },
      { id: "onedrive.list", name: "List OneDrive files", action: "Read", risk: "Medium", requiresApproval: false, delivers: false, scopes: ["files"], inputs: [],
        run: async (api) => { const r = await api("https://graph.microsoft.com/v1.0/me/drive/root/children?$top=10&$select=name,size,lastModifiedDateTime"); return { count: (r.json.value ?? []).length, files: (r.json.value ?? []).map((f) => ({ name: f.name, size: f.size, modified: f.lastModifiedDateTime })) }; } },
    ],
  },

  {
    id: "slack",
    name: "Slack",
    category: "Messaging",
    authType: "oauth2",
    authUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    usePKCE: false, scopeSeparator: ",", refresh: "none",
    tokenAuth: "body", tokenStyle: "form",
    clientIdEnv: "HOMEOPS_OAUTH_SLACK_CLIENT_ID",
    clientSecretEnv: "HOMEOPS_OAUTH_SLACK_CLIENT_SECRET",
    scopes: [
      { key: "channels", oauthScope: "channels:read", label: "List channels", risk: "Low", enablesTools: ["slack.listChannels"] },
      { key: "chat", oauthScope: "chat:write", label: "Post messages", risk: "High", enablesTools: ["slack.postMessage"] },
      { key: "users", oauthScope: "users:read", label: "Read members", risk: "Low", enablesTools: [] },
    ],
    identityFromToken: (raw) => ({ externalAccountId: raw.team?.id ?? raw.bot_user_id, displayName: raw.team?.name ? `${raw.team.name} (Slack)` : "Slack workspace" }),
    health: async (api) => { const r = await api("https://slack.com/api/auth.test", { method: "POST" }); return { ok: !!r.json?.ok, status: r.json?.ok ? "healthy" : "error", detail: r.json?.team }; },
    tools: [
      { id: "slack.listChannels", name: "List channels", action: "Read", risk: "Low", requiresApproval: false, delivers: false, scopes: ["channels"], inputs: [],
        run: async (api) => { const r = await api("https://slack.com/api/conversations.list?limit=20&types=public_channel"); if (!r.json?.ok) throw new Error(r.json?.error ?? "Slack error"); return { count: (r.json.channels ?? []).length, channels: (r.json.channels ?? []).map((c) => ({ id: c.id, name: c.name })) }; } },
      { id: "slack.postMessage", name: "Post message", action: "Send", risk: "High", requiresApproval: true, delivers: true, scopes: ["chat"], inputs: [{ key: "channel", label: "Channel ID", type: "text", required: true }, { key: "text", label: "Message", type: "textarea", required: true }],
        run: async (api, input) => { if (!input.channel || !input.text) throw new Error("Provide `channel` and `text`."); const r = await api("https://slack.com/api/chat.postMessage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: input.channel, text: input.text }) }); if (!r.json?.ok) throw new Error(r.json?.error ?? "Slack post failed"); return { sent: true, ts: r.json.ts, channel: input.channel }; } },
    ],
  },

  {
    id: "dropbox",
    name: "Dropbox",
    category: "Documents & Storage",
    authType: "oauth2",
    authUrl: "https://www.dropbox.com/oauth2/authorize",
    tokenUrl: "https://api.dropboxapi.com/oauth2/token",
    usePKCE: true, scopeSeparator: " ", refresh: "rotating",
    tokenAuth: "body", tokenStyle: "form",
    extraAuthParams: { token_access_type: "offline" },
    clientIdEnv: "HOMEOPS_OAUTH_DROPBOX_CLIENT_ID",
    clientSecretEnv: "HOMEOPS_OAUTH_DROPBOX_CLIENT_SECRET",
    scopes: [
      { key: "read", oauthScope: "files.metadata.read", label: "Read file list", risk: "Medium", enablesTools: ["dropbox.list"] },
      { key: "write", oauthScope: "files.content.write", label: "Create folders/files", risk: "High", enablesTools: ["dropbox.createFolder"] },
    ],
    identity: async (api) => { const r = await api("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: { "content-type": "application/json" }, body: "null" }); return { externalAccountId: r.json?.account_id, displayName: r.json?.email ?? r.json?.name?.display_name ?? "Dropbox account" }; },
    health: async (api) => { const r = await api("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: { "content-type": "application/json" }, body: "null" }); return { ok: r.ok, status: r.ok ? "healthy" : "error" }; },
    tools: [
      { id: "dropbox.list", name: "List files", action: "Read", risk: "Medium", requiresApproval: false, delivers: false, scopes: ["read"], inputs: [{ key: "path", label: "Folder path", type: "text", default: "" }],
        run: async (api, input) => { const r = await api("https://api.dropboxapi.com/2/files/list_folder", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: input.path || "" }) }); if (!r.ok) throw new Error(r.json?.error_summary ?? "Dropbox error"); return { count: (r.json.entries ?? []).length, entries: (r.json.entries ?? []).map((e) => ({ name: e.name, type: e[".tag"] })) }; } },
      { id: "dropbox.createFolder", name: "Create folder", action: "Write", risk: "High", requiresApproval: true, delivers: false, scopes: ["write"], inputs: [{ key: "path", label: "Folder path", type: "text", required: true, placeholder: "/FamiliOS/Receipts" }],
        run: async (api, input) => { if (!input.path) throw new Error("Provide a folder `path`."); const r = await api("https://api.dropboxapi.com/2/files/create_folder_v2", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path: input.path }) }); if (!r.ok) throw new Error(r.json?.error_summary ?? "Create failed"); return { created: true, path: r.json.metadata?.path_display }; } },
    ],
  },

  {
    id: "notion",
    name: "Notion",
    category: "Notes & Docs",
    authType: "oauth2",
    authUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    usePKCE: false, scopeSeparator: " ", refresh: "none",
    tokenAuth: "basic", tokenStyle: "json",
    extraAuthParams: { owner: "user" },
    extraHeaders: { "Notion-Version": "2022-06-28" },
    clientIdEnv: "HOMEOPS_OAUTH_NOTION_CLIENT_ID",
    clientSecretEnv: "HOMEOPS_OAUTH_NOTION_CLIENT_SECRET",
    scopes: [
      { key: "content", oauthScope: "", label: "Read & write shared pages", risk: "Medium", enablesTools: ["notion.search", "notion.createPage"] },
    ],
    identityFromToken: (raw) => ({ externalAccountId: raw.workspace_id ?? raw.bot_id, displayName: raw.workspace_name ? `${raw.workspace_name} (Notion)` : "Notion workspace" }),
    health: async (api) => { const r = await api("https://api.notion.com/v1/users/me"); return { ok: r.ok, status: r.ok ? "healthy" : "error" }; },
    tools: [
      { id: "notion.search", name: "Search pages", action: "Read", risk: "Medium", requiresApproval: false, delivers: false, scopes: ["content"], inputs: [{ key: "query", label: "Query", type: "text" }],
        run: async (api, input) => { const r = await api("https://api.notion.com/v1/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: input.query || "", page_size: 10 }) }); if (!r.ok) throw new Error(r.json?.message ?? "Notion error"); return { count: (r.json.results ?? []).length, results: (r.json.results ?? []).map((p) => ({ id: p.id, type: p.object, title: p.properties ? Object.values(p.properties).map((v) => v.title?.[0]?.plain_text).find(Boolean) : undefined })) }; } },
      { id: "notion.createPage", name: "Create page", action: "Write", risk: "Medium", requiresApproval: true, delivers: false, scopes: ["content"], inputs: [{ key: "parentPageId", label: "Parent page ID", type: "text", required: true }, { key: "title", label: "Title", type: "text", required: true }],
        run: async (api, input) => { if (!input.parentPageId || !input.title) throw new Error("Provide `parentPageId` and `title`."); const r = await api("https://api.notion.com/v1/pages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parent: { page_id: input.parentPageId }, properties: { title: { title: [{ text: { content: input.title } }] } } }) }); if (!r.ok) throw new Error(r.json?.message ?? "Create failed"); return { created: true, id: r.json.id, url: r.json.url }; } },
    ],
  },

  {
    id: "todoist",
    name: "Todoist",
    category: "Tasks",
    authType: "oauth2",
    authUrl: "https://todoist.com/oauth/authorize",
    tokenUrl: "https://todoist.com/oauth/access_token",
    usePKCE: false, scopeSeparator: ",", refresh: "none",
    tokenAuth: "body", tokenStyle: "form",
    clientIdEnv: "HOMEOPS_OAUTH_TODOIST_CLIENT_ID",
    clientSecretEnv: "HOMEOPS_OAUTH_TODOIST_CLIENT_SECRET",
    scopes: [
      { key: "rw", oauthScope: "data:read_write", label: "Read & write tasks", risk: "Medium", enablesTools: ["todoist.listTasks", "todoist.createTask"] },
    ],
    identity: async (api) => { const r = await api("https://api.todoist.com/rest/v2/projects"); return { externalAccountId: "todoist", displayName: r.ok ? "Todoist account" : "Todoist" }; },
    health: async (api) => { const r = await api("https://api.todoist.com/rest/v2/projects"); return { ok: r.ok, status: r.ok ? "healthy" : "error" }; },
    tools: [
      { id: "todoist.listTasks", name: "List tasks", action: "Read", risk: "Low", requiresApproval: false, delivers: false, scopes: ["rw"], inputs: [],
        run: async (api) => { const r = await api("https://api.todoist.com/rest/v2/tasks"); if (!r.ok) throw new Error("Todoist error"); return { count: (r.json ?? []).length, tasks: (r.json ?? []).slice(0, 15).map((t) => ({ id: t.id, content: t.content, due: t.due?.date })) }; } },
      { id: "todoist.createTask", name: "Create task", action: "Write", risk: "Medium", requiresApproval: true, delivers: false, scopes: ["rw"], inputs: [{ key: "content", label: "Task", type: "text", required: true }, { key: "due_string", label: "Due (natural language)", type: "text" }],
        run: async (api, input) => { if (!input.content) throw new Error("Provide task `content`."); const r = await api("https://api.todoist.com/rest/v2/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: input.content, due_string: input.due_string || undefined }) }); if (!r.ok) throw new Error("Create failed"); return { created: true, id: r.json.id, content: r.json.content }; } },
    ],
  },

  {
    id: "ticktick",
    name: "TickTick",
    category: "Tasks",
    authType: "oauth2",
    authUrl: "https://ticktick.com/oauth/authorize",
    tokenUrl: "https://ticktick.com/oauth/token",
    usePKCE: false, scopeSeparator: " ", refresh: "none",
    tokenAuth: "basic", tokenStyle: "form", includeScopeInToken: true,
    clientIdEnv: "HOMEOPS_OAUTH_TICKTICK_CLIENT_ID",
    clientSecretEnv: "HOMEOPS_OAUTH_TICKTICK_CLIENT_SECRET",
    scopes: [
      { key: "read", oauthScope: "tasks:read", label: "Read tasks", risk: "Low", enablesTools: ["ticktick.listProjects"] },
      { key: "write", oauthScope: "tasks:write", label: "Create tasks", risk: "Medium", enablesTools: ["ticktick.createTask"] },
    ],
    identity: async (api) => { const r = await api("https://api.ticktick.com/open/v1/project"); return { externalAccountId: "ticktick", displayName: r.ok ? "TickTick account" : "TickTick" }; },
    health: async (api) => { const r = await api("https://api.ticktick.com/open/v1/project"); return { ok: r.ok, status: r.ok ? "healthy" : "error" }; },
    tools: [
      { id: "ticktick.listProjects", name: "List projects", action: "Read", risk: "Low", requiresApproval: false, delivers: false, scopes: ["read"], inputs: [],
        run: async (api) => { const r = await api("https://api.ticktick.com/open/v1/project"); if (!r.ok) throw new Error("TickTick error"); return { count: (r.json ?? []).length, projects: (r.json ?? []).map((p) => ({ id: p.id, name: p.name })) }; } },
      { id: "ticktick.createTask", name: "Create task", action: "Write", risk: "Medium", requiresApproval: true, delivers: false, scopes: ["write"], inputs: [{ key: "title", label: "Task", type: "text", required: true }, { key: "projectId", label: "Project ID", type: "text" }],
        run: async (api, input) => { if (!input.title) throw new Error("Provide task `title`."); const r = await api("https://api.ticktick.com/open/v1/task", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: input.title, projectId: input.projectId || undefined }) }); if (!r.ok) throw new Error("Create failed"); return { created: true, id: r.json.id, title: r.json.title }; } },
    ],
  },

  // ---- Smart Home ------------------------------------------------------------
  // Amazon Alexa is its own isolated provider (its own Login-with-Amazon OAuth client).
  // Google Home is NOT here — it's a permission (the `smarthome`/SDM scope + tools) ON the
  // `google` provider above, so you grant it alongside Gmail/Calendar. Either way, the device
  // APIs need MORE than the OAuth token — Alexa a Skill-Messaging / event-gateway endpoint,
  // Google Home a Device Access *project id* — so every tool fails CLOSED with a clear
  // "needs setup" error when that piece isn't configured, and never fakes success.
  {
    id: "amazon-alexa",
    name: "Amazon Alexa",
    category: "Smart Home",
    authType: "oauth2",
    authUrl: "https://www.amazon.com/ap/oa",
    tokenUrl: "https://api.amazon.com/auth/o2/token",
    usePKCE: true, scopeSeparator: " ", refresh: "rotating",
    tokenAuth: "body", tokenStyle: "form",
    clientIdEnv: "HOMEOPS_OAUTH_ALEXA_CLIENT_ID",
    clientSecretEnv: "HOMEOPS_OAUTH_ALEXA_CLIENT_SECRET",
    scopes: [
      { key: "profile", oauthScope: "profile", label: "Amazon profile (identity)", risk: "Low", enablesTools: [] },
      { key: "alexa", oauthScope: "alexa::async_event:write", label: "Announce to & manage Alexa devices", risk: "Medium", enablesTools: ["alexa.announce", "alexa.listDevices"] },
    ],
    // Login with Amazon profile endpoint → { user_id, name, email }.
    identity: async (api) => { const r = await api("https://api.amazon.com/user/profile"); return { externalAccountId: r.json?.user_id, displayName: r.json?.name ?? r.json?.email ?? "Amazon account" }; },
    health: async (api) => { const r = await api("https://api.amazon.com/user/profile"); return { ok: r.ok, status: r.ok ? "healthy" : "error", detail: r.json?.email }; },
    tools: [
      { id: "alexa.listDevices", name: "List Alexa devices", action: "Read", risk: "Low", requiresApproval: false, delivers: false, scopes: ["alexa"], inputs: [],
        run: async (api) => {
          const base = env("HOMEOPS_ALEXA_ENDPOINT");
          if (!base) throw new Error("Alexa isn't set up yet — set HOMEOPS_ALEXA_ENDPOINT to your Alexa Skill-Messaging / event-gateway base URL to reach devices.");
          const r = await api(`${base.replace(/\/$/, "")}/v1/devices`);
          if (!r.ok) throw new Error(r.json?.error?.message ?? r.text ?? "Couldn't list Alexa devices.");
          return { count: (r.json?.devices ?? []).length, devices: (r.json?.devices ?? []).map((d) => ({ id: d.deviceSerialNumber ?? d.id, name: d.accountName ?? d.name, type: d.deviceType ?? d.type })) };
        } },
      { id: "alexa.announce", name: "Announce on Alexa", action: "Send", risk: "Medium", requiresApproval: true, delivers: true, scopes: ["alexa"],
        inputs: [{ key: "message", label: "Announcement", type: "textarea", required: true }, { key: "device", label: "Target device id (blank = all)", type: "text" }],
        run: async (api, input) => {
          const base = env("HOMEOPS_ALEXA_ENDPOINT");
          if (!base) throw new Error("Alexa isn't set up yet — set HOMEOPS_ALEXA_ENDPOINT to your Alexa Skill-Messaging / event-gateway base URL to send announcements.");
          if (!input.message) throw new Error("Provide a `message` to announce.");
          const r = await api(`${base.replace(/\/$/, "")}/v1/announcements`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: String(input.message), target: input.device || "all" }) });
          if (!r.ok) throw new Error(r.json?.error?.message ?? r.text ?? "Alexa announcement failed");
          return { announced: true, target: input.device || "all" };
        } },
    ],
  },

];

export function providerById(id) {
  return PROVIDERS.find((p) => p.id === id);
}
export function toolDef(provider, toolId) {
  return providerById(provider)?.tools.find((t) => t.id === toolId);
}
export function findToolGlobal(toolId) {
  for (const p of PROVIDERS) { const t = p.tools.find((x) => x.id === toolId); if (t) return { provider: p, tool: t }; }
  return null;
}

// Are this provider's deployment credentials present in the environment?
export function providerConfigured(p) {
  return !!(env(p.clientIdEnv) && env(p.clientSecretEnv));
}
export function clientCreds(p) {
  return { clientId: env(p.clientIdEnv), clientSecret: env(p.clientSecretEnv) };
}

// WP-012: every first-party provider now has a real-credential setup checklist
// (src/data/providerSetup.ts PROVIDER_SETUP_GUIDES, keyed by this same id) — this is
// the smallest honest seam so a not-configured provider's public payload can point at
// "there IS a named unblock path" without duplicating checklist content server-side.
// server/test/provider-setup.test.mjs asserts every PROVIDERS id has a matching guide,
// so this stays true by construction rather than by hand-maintained parity.
export function providerHasSetupGuide(_p) {
  return true;
}

// Public, secret-free provider view for the frontend.
export function publicProvider(p) {
  return {
    id: p.id, name: p.name, category: p.category, authType: p.authType,
    readiness: providerConfigured(p) ? "configured" : "not_configured_by_deployment",
    clientIdEnv: p.clientIdEnv, clientSecretEnv: p.clientSecretEnv, // names only, not values
    scopes: p.scopes.map((s) => ({ key: s.key, label: s.label, risk: s.risk })),
    tools: p.tools.map((t) => ({ id: t.id, name: t.name, action: t.action, risk: t.risk, requiresApproval: t.requiresApproval, scopes: t.scopes, inputs: t.inputs ?? [] })),
    // WP-012: names a real setup checklist exists for this provider (see above) — lets
    // the next-wave 22-UC suite print "blocker: <provider> OAuth app not provisioned;
    // checklist available" instead of a bare not_configured with no unblock path.
    setupGuide: providerHasSetupGuide(p),
    // WP-006: annotate ONLY when the flag is set (real mode = byte-for-byte today's
    // shape). A truthful signal that provider calls are being served by the sandbox
    // twin — it does NOT claim deployment credentials are configured.
    ...(sandboxOn() ? { sandbox: true } : {}),
  };
}
export function listProviders() {
  return PROVIDERS.map(publicProvider);
}
