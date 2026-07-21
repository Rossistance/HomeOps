# The connector sandbox (WP-006 slice 3)

`server/sandbox-connectors.mjs` is a deterministic, in-process **transport** twin for
outbound connector calls, gated entirely on one environment variable:

```
HOMEOPS_CONNECTOR_SANDBOX=1
```

It exists so the next wave of 22-UC end-to-end specs can drive real send/label/create
flows (Gmail, Calendar, Slack, SMS, …) without provisioned OAuth credentials or a Twilio
account, and without ever opening a socket to a real host. This file is the honest,
line-by-line map of what that buys you and what it deliberately does not.

## The seam, in one paragraph

There are exactly two outbound transport chokepoints in this server: `apiForAccount()`
(`server/oauth.mjs`) — the bound `api()` every PROVIDERS tool and `notify.mjs`'s email
path calls — and `executeTool()` (`server/connectors.mjs`) for the credentialed `sms`
connector. When the flag is set, both are swapped for pure in-process mocks (see
`sandboxApiFor()` / `sandboxConnectorExecute()`), **after** every real consent gate has
already run: verified/opted-in contact checks, the per-agent allowlist, the household
kill switch, the server-side consumed-approval record, and connector/account readiness.
An unverified or unapproved send still refuses and records nothing — sandbox mode
replaces the wire, never the decision to send. Every would-be effect (a send, a label
change, a calendar create, an announcement) is written to a per-tenant
`sandbox_effects.json` collection plus a `sandbox.effect` audit event, so a spec can
assert exactly what content/recipient/channel WOULD have gone out. `server/net.mjs`
(the SSRF/egress guard) is untouched by design — the sandbox mocks never call
`safeFetch`/`assertSafeUrl` at all, so the real-mode allowlist is identical whether or
not the flag is set.

## What IS mocked

| Provider / connector | Tools covered | Records an effect |
|---|---|---|
| `google` (OAuth provider) | `gmail.search`, `gmail.send`, `gmail.listLabels`, `gmail.modifyLabels`, `calendar.list`, `calendar.create`, `drive.list`, `smarthome.listDevices`, `smarthome.setThermostat` | `gmail.send`, `gmail.modifyLabels`, `calendar.create`, `smarthome.setThermostat` |
| `microsoft` (365) | `outlook.search`, `outlook.send`, `mscal.list`, `mscal.create`, `onedrive.list` | `outlook.send`, `mscal.create` |
| `slack` | `slack.listChannels`, `slack.postMessage` | `slack.postMessage` |
| `dropbox` | `dropbox.list`, `dropbox.createFolder` | `dropbox.createFolder` |
| `amazon-alexa` | `alexa.listDevices`, `alexa.announce` | `alexa.announce` |
| `sms` (Twilio, credentialed connector) | `sms.send` | `sms.send` |

Identity resolution (`provider.identity()` / `identityFromToken`) and health checks
(`provider.health()`) also resolve through the mock with fixed, deterministic values —
see `IDENTITY` in `sandbox-connectors.mjs`. Google Home (SDM) and Alexa need an extra
env var beyond the OAuth token before their real tools will even attempt a call
(`HOMEOPS_SDM_PROJECT_ID`, `HOMEOPS_ALEXA_ENDPOINT`); the sandbox fills a synthetic,
obviously-fake value for **unset** vars only, and only while the flag is on — see
`SANDBOX_COVERAGE` (exported from `sandbox-connectors.mjs`) for the machine-readable
version of this table.

Any host/path the mock doesn't explicitly model (for a mocked provider) returns a real
HTTP 501 with `sandbox_unmocked:<host><path>` — never a fabricated 200. That is
intentional: an incomplete mock must fail loudly, not silently claim success.

## What is NOT mocked (honest, on purpose)

- **Providers:** `notion`, `todoist`, `ticktick` — these stay `not_connected` /
  `needs_auth` exactly as in real mode. A spec that needs one of these connected must
  either provision real credentials or accept the honest refusal.
- **No-credential connectors:** `weather`, `rss`, `http`, `web`, `browser`, `webhook`,
  `files-local` — these already run for real without any secret (weather hits a public
  API, `rss`/`http`/`web` fetch whatever URL the household configured, `webhook` is a
  live receiver, `files-local` is client-side). There is nothing to sandbox: mocking
  them would hide real, low-risk behavior instead of standing in for a credential the
  spec author doesn't have.

## What the flag does NOT do (and why specs sometimes still see `not_connected`)

- **It does not create accounts by itself.** `seedSandboxAccounts({ householdId,
  actorId })` writes one deterministic, `status: "connected"` account per mocked
  provider for that actor — but nothing calls it automatically yet. Wiring that into
  server boot (or session creation) is a **handoff to `server/index.mjs`**, which this
  slice does not own. Until that lands, a spec must seed the account itself — either by
  calling `seedSandboxAccounts()` directly (in-process tests) or by writing the account
  row into `accounts.json` the way `server/test/accounts.test.mjs` already does
  (harness-level tests; see `server/test/sandbox-e2e.test.mjs` for the pattern). An
  actor with no seeded account still gets a real `not_connected` /
  `waiting_for_connector`, sandbox flag or not — that is correct, not a bug.
- **It does not touch OAuth-client "configured" readiness.** `GET /api/providers`
  reports `sandbox: true` on every provider, but `readiness` (`configured` vs.
  `not_configured_by_deployment`) still reflects whatever `HOMEOPS_OAUTH_*_CLIENT_ID`
  /`_SECRET` are actually set in the environment. Sandbox mode never claims a
  deployment has real OAuth credentials it doesn't have.
- **It does not relax any consent gate.** The verified/opted-in/allowlist checks in
  `homeops.notify_contact`, the server-side consumed-approval record, and the
  household kill switch all run at their normal place in the call chain — sandbox
  mode only replaces what happens *after* all of them say yes. See
  `server/test/sandbox-connectors.test.mjs` ("gates run BEFORE the transport swap")
  and `server/test/sandbox-e2e.test.mjs` ("does not relax homeops.notify_contact's
  consent gates") for the pinned proof.
- **It does not widen real egress.** `server/net.mjs`'s SSRF allowlist has no sandbox
  branch at all — a non-allowlisted host is refused identically whether the flag is
  set or not (the mocks never call into `net.mjs` in the first place).

## Where to look

- `server/sandbox-connectors.mjs` — the module itself; read the header comment first.
- `server/oauth.mjs` (`apiForAccount`) / `server/connectors.mjs`
  (`readinessOf`, `executeTool`) — the two hook points, each with a `WP-006 SANDBOX`
  comment marking exactly where the swap happens.
- `server/providers.mjs` (`publicProvider`) — the `sandbox: true` UI/API annotation.
- `server/test/sandbox-connectors.test.mjs` — module-level tests: coverage-map honesty,
  gate ordering, every mocked provider's real `tool.run()` against the mock, per-tenant
  effect isolation, and the `net.mjs` real-mode regression pins.
- `server/test/sandbox-e2e.test.mjs` — the same guarantees proven through the real
  spawned server: run-level park avoidance once an account is seeded, and the
  `homeops.notify_contact` consent-gate proof end to end.

## Quick recipe for a new 22-UC spec

1. Start the server (or the test harness) with `HOMEOPS_CONNECTOR_SANDBOX=1`.
2. Seed whichever mocked provider accounts the scenario needs, for the acting actor —
   today, that means writing `accounts.json` directly (see
   `seedSandboxGoogleAccount()` in `sandbox-e2e.test.mjs`) until the boot-wiring handoff
   lands.
3. Drive the scenario exactly as you would in real mode — approvals, triggers, runs.
4. Assert on the *decision* (`ok`/`delivered`/`step.status`) as usual, and on the
   *content* of the would-be effect by reading `sandbox_effects.json` for the tenant
   (`recipient`, `channel`, `subject`, `content`) instead of mocking a transport
   yourself.
5. If the scenario needs `notion` / `todoist` / `ticktick`, or a connector outside the
   table above: it isn't sandboxed. Either provision real credentials for that one
   connector or scope the spec to skip it — do not add an ad hoc mock outside this
   module, or the "no mocks except through this one seam" property this slice exists to
   provide is gone.
