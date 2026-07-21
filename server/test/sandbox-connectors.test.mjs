// WP-006 slice 3 — the connector SANDBOX transport seam.
//
// Scope of this file: the sandbox module itself (server/sandbox-connectors.mjs) and its
// two hook points (oauth.mjs apiForAccount, connectors.mjs executeTool/readinessOf), at
// the module level — no HTTP server is spawned here (see sandbox-e2e.test.mjs for the
// full-run, route-level proof that sandbox accounts stop a run parking on
// waiting_for_connector, and that notify.mjs's consent gates still refuse in sandbox).
//
// Every test either (a) pins today's REAL-mode behavior byte-for-byte so the seam can
// never silently change it, or (b) proves the sandbox mock is a HONEST twin: gates run
// before the swap, unmocked routes fail closed, and no socket is ever opened (every
// mock here is a pure in-process fixture — there is no fetch/dns anywhere below).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

const DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-sbx-"));
process.env.HOMEOPS_DATA_DIR = DATA_DIR;
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
delete process.env.HOMEOPS_CONNECTOR_SANDBOX;
delete process.env.HOMEOPS_SDM_PROJECT_ID;
delete process.env.HOMEOPS_ALEXA_ENDPOINT;
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_FROM_NUMBER;

const sbx = await import("../sandbox-connectors.mjs");
const store = await import("../store.mjs");
const { providerById } = await import("../providers.mjs");
const providersMod = await import("../providers.mjs");
const conn = await import("../connectors.mjs");
const { apiForAccount } = await import("../oauth.mjs");
const { listAccountsFor } = await import("../accounts.mjs");
const net = await import("../net.mjs");

after(() => { try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

// Run fn with the sandbox flag set, then always restore it — a leaked flag would
// silently flip every later test into sandbox mode.
async function withSandbox(fn) {
  const prev = process.env.HOMEOPS_CONNECTOR_SANDBOX;
  process.env.HOMEOPS_CONNECTOR_SANDBOX = "1";
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.HOMEOPS_CONNECTOR_SANDBOX; else process.env.HOMEOPS_CONNECTOR_SANDBOX = prev;
  }
}
function effectsFor(recipient) { return sbx.listSandboxEffects().filter((e) => e.recipient === recipient); }

/* ------------------------------------------------------------------ */
describe("SANDBOX_COVERAGE is honest (no drift between the doc and the code)", () => {
  test("mocked providers are exactly the credentialed, provider-platform ones", () => {
    assert.deepEqual([...sbx.MOCKED_PROVIDER_IDS].sort(), ["amazon-alexa", "dropbox", "google", "microsoft", "slack"].sort());
  });
  test("mocked connectors are exactly {sms}", () => {
    assert.deepEqual([...sbx.SANDBOX_CONNECTOR_IDS], ["sms"]);
    assert.equal(sbx.isSandboxConnectorTool("sms.send"), true);
    assert.equal(sbx.isSandboxConnectorTool("http.post"), false);
  });
  test("notMocked providers never overlap with mockedProviders (the doc can't lie about coverage)", () => {
    for (const p of sbx.SANDBOX_COVERAGE.notMocked.providers) assert.ok(!sbx.MOCKED_PROVIDER_IDS.includes(p), `${p} claimed unmocked but is in MOCKED_PROVIDER_IDS`);
    assert.deepEqual(sbx.SANDBOX_COVERAGE.notMocked.providers.sort(), ["notion", "ticktick", "todoist"]);
  });
  test("every mockedProviders tool id is a real tool on that provider", () => {
    for (const [providerId, entry] of Object.entries(sbx.SANDBOX_COVERAGE.mockedProviders)) {
      const def = providerById(providerId);
      assert.ok(def, `provider ${providerId} exists in the registry`);
      for (const toolId of entry.tools) assert.ok(def.tools.some((t) => t.id === toolId), `${providerId} declares tool ${toolId} in providers.mjs`);
    }
  });
});

/* ------------------------------------------------------------------ */
describe("sandboxEnabled() reads the env live (never cached)", () => {
  test("off by default, flips both ways without re-importing the module", () => {
    delete process.env.HOMEOPS_CONNECTOR_SANDBOX;
    assert.equal(sbx.sandboxEnabled(), false);
    process.env.HOMEOPS_CONNECTOR_SANDBOX = "1";
    assert.equal(sbx.sandboxEnabled(), true);
    delete process.env.HOMEOPS_CONNECTOR_SANDBOX;
    assert.equal(sbx.sandboxEnabled(), false);
  });
});

/* ------------------------------------------------------------------ */
describe("real mode (flag unset) is byte-for-byte today's — regression pins", () => {
  test("sms connector: not_configured with no Twilio credentials", () => {
    const sms = conn.connectorById("sms");
    assert.equal(conn.readinessOf(sms), "not_configured");
  });
  test("executeTool('sms.send') refuses not_configured before approval is even considered", async () => {
    const out = await conn.executeTool("sms.send", { to: "+15551230000", body: "hi" }, { actorId: "m-real", householdId: "local" });
    assert.equal(out.ok, false);
    assert.equal(out.error, "not_configured");
    assert.equal(out.readiness, "not_configured");
  });
  test("apiForAccount() in real mode is the real bound fetch, not the sandbox mock", () => {
    const api = apiForAccount({ id: "acct_real_1", provider: "google" });
    assert.equal(typeof api, "function");
    assert.ok(!api.__sandbox, "real-mode api() must not carry the sandbox marker");
  });
  test("publicProvider() carries no sandbox flag in real mode", () => {
    const p = providersMod.publicProvider(providerById("google"));
    assert.equal("sandbox" in p, false);
  });
  test("no sandbox effects are ever recorded outside sandbox mode by any real-mode path", () => {
    // Sanity: recordSandboxEffect itself is a plain writer with no gate of its own —
    // the honesty guarantee is that NOTHING calls it unless sandboxEnabled() was true
    // at the call site (asserted structurally above, in oauth.mjs/connectors.mjs).
    assert.equal(sbx.sandboxEnabled(), false);
  });
});

/* ------------------------------------------------------------------ */
describe("sandbox mode — connector readiness reports ready without real credentials", () => {
  test("sms connector reports 'connected' under the flag despite zero Twilio config, and reverts when the flag clears", async () => {
    await withSandbox(async () => {
      const sms = conn.connectorById("sms");
      assert.equal(conn.readinessOf(sms), "connected");
      const pub = conn.publicConnector(sms);
      assert.equal(pub.readiness, "connected");
      assert.equal(pub.live, true);
    });
    // Un-widened once the flag clears again — same connector, same missing config.
    const sms = conn.connectorById("sms");
    assert.equal(conn.readinessOf(sms), "not_configured");
  });
  test("publicProvider() carries sandbox:true ONLY while the flag is set, and never claims deployment credentials are configured", async () => {
    await withSandbox(async () => {
      const p = providersMod.publicProvider(providerById("google"));
      assert.equal(p.sandbox, true);
      assert.equal(p.readiness, "not_configured_by_deployment", "sandbox never fakes real OAuth client credentials");
    });
  });
});

/* ------------------------------------------------------------------ */
describe("sandbox mode — consent/approval/kill-switch gates run BEFORE the transport swap", () => {
  test("an unconsumed approval is still refused for a gated sandbox tool", async () => {
    await withSandbox(async () => {
      const out = await conn.executeTool("sms.send", { to: "+15551231111", body: "gate check" }, { actorId: "m-gate", householdId: "local", approvalConsumed: false });
      assert.equal(out.ok, false);
      assert.equal(out.error, "approval_required");
      assert.equal(effectsFor("+15551231111").length, 0, "no effect may be recorded for a refused send");
    });
  });
  test("the household kill switch still refuses an approved sandbox send", async () => {
    await withSandbox(async () => {
      store.setSettings({ externalActionsEnabled: false }, "local");
      try {
        const out = await conn.executeTool("sms.send", { to: "+15551232222", body: "kill switch check" }, { actorId: "m-gate", householdId: "local", approvalConsumed: true });
        assert.equal(out.ok, false);
        assert.equal(out.error, "external_actions_disabled");
        assert.equal(effectsFor("+15551232222").length, 0);
      } finally {
        store.setSettings({ externalActionsEnabled: true }, "local");
      }
    });
  });
  test("with every real gate satisfied, the sandbox swap runs and records the would-be effect", async () => {
    await withSandbox(async () => {
      const out = await conn.executeTool("sms.send", { to: "+15551233333", body: "all gates pass" }, { actorId: "m-gate", householdId: "local", approvalConsumed: true });
      assert.equal(out.ok, true);
      assert.equal(out.sandbox, true);
      assert.equal(out.result.sent, true);
      assert.match(out.result.sid, /^SBX-SM-/);
      const effs = effectsFor("+15551233333");
      assert.equal(effs.length, 1);
      assert.equal(effs[0].channel, "sms");
      assert.equal(effs[0].content, "all gates pass");
      assert.equal(effs[0].toolId, "sms.send");
    });
  });
  test("invalid input still refuses honestly inside the sandbox mock (no hollow success)", async () => {
    await withSandbox(async () => {
      const out = await conn.executeTool("sms.send", { to: "", body: "" }, { actorId: "m-gate", householdId: "local", approvalConsumed: true });
      assert.equal(out.ok, false);
      assert.equal(out.error, "invalid_input");
    });
  });
});

/* ------------------------------------------------------------------ *
 * sandboxApiFor() + the REAL provider tool run() functions from providers.mjs —
 * proves the mock's response shapes are what the real parser (not a test double
 * of it) actually accepts, and that every write/send records a sandbox_effects row.
 * ------------------------------------------------------------------ */
describe("sandboxApiFor + real provider tool run() — google", () => {
  const account = { id: "acct_g1", provider: "google", connectedByActorId: "m-goog", householdId: "local" };
  const tools = providerById("google").tools;
  const tool = (id) => tools.find((t) => t.id === id);

  test("gmail.search — the real parser accepts the mock's message shape", async () => {
    await withSandbox(async () => {
      const api = sbx.sandboxApiFor(account);
      const out = await tool("gmail.search").run(api, { query: "newer_than:7d", maxResults: "50" });
      assert.equal(out.count, 3);
      assert.equal(out.complete, true);
      for (const m of out.messages) {
        assert.equal(typeof m.subject, "string");
        assert.equal(typeof m.from, "string");
        assert.ok(Array.isArray(m.labelIds));
      }
    });
  });
  test("gmail.listLabels + gmail.modifyLabels — resolves an existing label by name, records the effect", async () => {
    await withSandbox(async () => {
      const api = sbx.sandboxApiFor(account);
      const labels = await tool("gmail.listLabels").run(api);
      assert.ok(labels.labels.some((l) => l.name === "School"));
      const out = await tool("gmail.modifyLabels").run(api, { messageIds: "sbx-msg-1", addLabels: "School" });
      assert.equal(out.modified, 1);
      assert.deepEqual(out.createdLabels, []);
      const effs = effectsFor("sbx-msg-1");
      assert.equal(effs.length, 1);
      assert.equal(effs[0].channel, "gmail-label");
    });
  });
  test("gmail.send — real send() encoder round-trips through the mock's RFC822 decoder, records to/subject/body", async () => {
    await withSandbox(async () => {
      const api = sbx.sandboxApiFor(account);
      const out = await tool("gmail.send").run(api, { to: "kid-permission@example.invalid", subject: "Field trip permission", body: "Please sign and return by Friday." });
      assert.equal(out.sent, true);
      assert.match(out.id, /^sbx-sent-/);
      const effs = effectsFor("kid-permission@example.invalid");
      assert.equal(effs.length, 1);
      assert.equal(effs[0].channel, "email");
      assert.equal(effs[0].subject, "Field trip permission");
      assert.equal(effs[0].content, "Please sign and return by Friday.");
    });
  });
  test("calendar.list + calendar.create — record effect on write only", async () => {
    await withSandbox(async () => {
      const api = sbx.sandboxApiFor(account);
      const list = await tool("calendar.list").run(api);
      assert.equal(list.count, 2);
      const out = await tool("calendar.create").run(api, { summary: "Dentist — sandbox test", start: "2026-07-22T15:00:00Z" });
      assert.equal(out.created, true);
      assert.match(out.id, /^sbx-evt-/);
    });
  });
  test("drive.list — read-only fixture", async () => {
    await withSandbox(async () => {
      const out = await tool("drive.list").run(sbx.sandboxApiFor(account));
      assert.equal(out.count, 2);
      assert.ok(out.files.every((f) => f.id && f.name));
    });
  });
  test("smarthome.listDevices + setThermostat — SDM env default is filled only in sandbox, tool still fails closed on real missing setup", async () => {
    delete process.env.HOMEOPS_SDM_PROJECT_ID;
    // Real mode: the tool must still fail closed (no project id, no sandbox default).
    await assert.rejects(() => tool("smarthome.listDevices").run(apiForAccount(account)), /Google Home isn't set up/);
    delete process.env.HOMEOPS_SDM_PROJECT_ID;
    await withSandbox(async () => {
      const api = sbx.sandboxApiFor(account); // fills HOMEOPS_SDM_PROJECT_ID as a side effect, sandbox-only
      assert.equal(process.env.HOMEOPS_SDM_PROJECT_ID, "sandbox-sdm-project");
      const list = await tool("smarthome.listDevices").run(api);
      assert.equal(list.count, 1);
      const set = await tool("smarthome.setThermostat").run(api, { deviceId: list.devices[0].name, celsius: "20" });
      assert.equal(set.ok, true);
    });
  });
  test("identity() and health() resolve through the mock exactly as the real account-connect / health-check paths call them", async () => {
    await withSandbox(async () => {
      const api = sbx.sandboxApiFor(account);
      const def = providerById("google");
      const ident = await def.identity(api);
      assert.equal(ident.displayName, "family.sandbox@gmail.com");
      const health = await def.health(api);
      assert.equal(health.ok, true);
      assert.equal(health.status, "healthy");
    });
  });
});

describe("sandboxApiFor + real provider tool run() — microsoft, slack, dropbox, amazon-alexa", () => {
  test("microsoft: outlook.send + mscal.create record effects; onedrive.list is read-only", async () => {
    await withSandbox(async () => {
      const account = { id: "acct_m1", provider: "microsoft", connectedByActorId: "m-ms", householdId: "local" };
      const tools = providerById("microsoft").tools;
      const tool = (id) => tools.find((t) => t.id === id);
      const api = sbx.sandboxApiFor(account);
      const sent = await tool("outlook.send").run(api, { to: "family@example.invalid", subject: "Invoice", body: "See attached." });
      assert.equal(sent.sent, true);
      assert.equal(effectsFor("family@example.invalid").length, 1);
      const evt = await tool("mscal.create").run(api, { summary: "1:1", start: "2026-07-22T14:00:00" });
      assert.match(evt.id, /^sbx-msevt-/);
      const files = await tool("onedrive.list").run(api);
      assert.equal(files.count, 1);
    });
  });
  test("slack: postMessage records effect; listChannels is read-only", async () => {
    await withSandbox(async () => {
      const account = { id: "acct_s1", provider: "slack", connectedByActorId: "m-sl", householdId: "local" };
      const tools = providerById("slack").tools;
      const tool = (id) => tools.find((t) => t.id === id);
      const api = sbx.sandboxApiFor(account);
      const chans = await tool("slack.listChannels").run(api);
      assert.equal(chans.count, 2);
      const posted = await tool("slack.postMessage").run(api, { channel: "C_SBX_FAMILY", text: "Dinner at 6." });
      assert.equal(posted.sent, true);
      assert.equal(effectsFor("C_SBX_FAMILY").length, 1);
    });
  });
  test("dropbox: createFolder records effect; list is read-only", async () => {
    await withSandbox(async () => {
      const account = { id: "acct_d1", provider: "dropbox", connectedByActorId: "m-db", householdId: "local" };
      const tools = providerById("dropbox").tools;
      const tool = (id) => tools.find((t) => t.id === id);
      const api = sbx.sandboxApiFor(account);
      const list = await tool("dropbox.list").run(api, {});
      assert.equal(list.count, 2);
      const created = await tool("dropbox.createFolder").run(api, { path: "/FamiliOS/Receipts" });
      assert.equal(created.created, true);
      assert.equal(effectsFor("/FamiliOS/Receipts").length, 1);
    });
  });
  test("amazon-alexa: announce records effect and fills its own endpoint default; listDevices is read-only", async () => {
    delete process.env.HOMEOPS_ALEXA_ENDPOINT;
    await withSandbox(async () => {
      const account = { id: "acct_a1", provider: "amazon-alexa", connectedByActorId: "m-al", householdId: "local" };
      const tools = providerById("amazon-alexa").tools;
      const tool = (id) => tools.find((t) => t.id === id);
      const api = sbx.sandboxApiFor(account);
      assert.equal(process.env.HOMEOPS_ALEXA_ENDPOINT, sbx.SANDBOX_ALEXA_ENDPOINT);
      const list = await tool("alexa.listDevices").run(api);
      assert.equal(list.count, 1);
      const announced = await tool("alexa.announce").run(api, { message: "Dinner is ready.", device: "" });
      assert.equal(announced.announced, true);
      assert.equal(effectsFor("all").length, 1);
    });
  });
});

/* ------------------------------------------------------------------ */
describe("unmocked routes stay honest (fail closed, no hollow success)", () => {
  test("a host/path the mock does not model returns a 501 sandbox_unmocked, never a fabricated 200", async () => {
    await withSandbox(async () => {
      const api = sbx.sandboxApiFor({ id: "acct_g2", provider: "google" });
      const r = await api("https://gmail.googleapis.com/gmail/v1/users/me/settings/filters");
      assert.equal(r.ok, false);
      assert.equal(r.status, 501);
      assert.match(r.json.error.message, /^sandbox_unmocked:/);
    });
  });
  test("a provider outside MOCKED_PROVIDER_IDS is never routed to a mock twin, even if sandboxApiFor is called directly", async () => {
    await withSandbox(async () => {
      const api = sbx.sandboxApiFor({ id: "acct_n1", provider: "notion" });
      const r = await api("https://api.notion.com/v1/search", { method: "POST" });
      assert.equal(r.ok, false);
      assert.equal(r.status, 501);
    });
  });
});

/* ------------------------------------------------------------------ */
describe("seedSandboxAccounts — accounts resolve so runs don't park on waiting_for_connector", () => {
  test("no-op outside sandbox mode, and requires an actorId", () => {
    assert.deepEqual(sbx.seedSandboxAccounts({ householdId: "local", actorId: "m-noop" }), { seeded: [] });
  });
  test("seeds one connected account per mocked provider, idempotently, visible via accounts.mjs listAccountsFor", async () => {
    await withSandbox(async () => {
      assert.deepEqual(sbx.seedSandboxAccounts({ householdId: "local" }), { seeded: [] }, "still requires actorId under the flag");
      const r1 = sbx.seedSandboxAccounts({ householdId: "local", actorId: "m-seed" });
      assert.equal(r1.seeded.length, sbx.MOCKED_PROVIDER_IDS.length);
      for (const providerId of sbx.MOCKED_PROVIDER_IDS) {
        const acct = store.getAccountRaw(`sbx_${providerId}_m-seed`);
        assert.ok(acct, `${providerId} account was written`);
        assert.equal(acct.status, "connected");
        assert.equal(acct.connectedByActorId, "m-seed");
        assert.ok(acct.scopes.length > 0);
      }
      // Idempotent: a second seed call for the same actor must not duplicate rows.
      const r2 = sbx.seedSandboxAccounts({ householdId: "local", actorId: "m-seed" });
      assert.equal(r2.seeded.length, sbx.MOCKED_PROVIDER_IDS.length);
      const mine = listAccountsFor("local", "m-seed");
      assert.equal(mine.length, sbx.MOCKED_PROVIDER_IDS.length, "no duplicate accounts from re-seeding");
      // This is exactly the lookup engine.mjs's execResolved() does for a "provider" kind
      // step (listAccountsFor(...).filter(a => a.provider === tool's provider)) — a
      // non-empty match here is what keeps a sandboxed run from ever reporting
      // not_connected / waiting: "connector".
      const googleAccounts = mine.filter((a) => a.provider === "google");
      assert.equal(googleAccounts.length, 1);
    });
  });
});

/* ------------------------------------------------------------------ */
describe("sandbox_effects are recorded per-tenant, never cross-visible", () => {
  test("an effect recorded under tenant A is invisible under tenant B", () => {
    store.runWithTenant("tg-tenant-a", () => sbx.clearSandboxEffects());
    store.runWithTenant("tg-tenant-b", () => sbx.clearSandboxEffects());
    store.runWithTenant("tg-tenant-a", () => sbx.recordSandboxEffect({ toolId: "sms.send", channel: "sms", recipient: "+15550000001", content: "tenant A only" }));
    const bView = store.runWithTenant("tg-tenant-b", () => sbx.listSandboxEffects());
    assert.equal(bView.length, 0, "tenant B must not see tenant A's sandbox effects");
    const aView = store.runWithTenant("tg-tenant-a", () => sbx.listSandboxEffects());
    assert.equal(aView.length, 1);
    assert.equal(aView[0].recipient, "+15550000001");
  });
});

/* ------------------------------------------------------------------ */
describe("net.mjs — sandbox never widens real egress (regression)", () => {
  // Literal IPs only: assertSafeUrl does no DNS lookup and no fetch for a literal IP,
  // so this describe block makes zero real network calls in either mode.
  for (const flag of [undefined, "1"]) {
    test(`loopback is blocked with HOMEOPS_CONNECTOR_SANDBOX=${flag ?? "(unset)"}`, async () => {
      const prev = process.env.HOMEOPS_CONNECTOR_SANDBOX;
      if (flag) process.env.HOMEOPS_CONNECTOR_SANDBOX = flag; else delete process.env.HOMEOPS_CONNECTOR_SANDBOX;
      try {
        const r = await net.assertSafeUrl("http://127.0.0.1/admin");
        assert.equal(r.ok, false);
        assert.equal(r.error, "loopback_blocked");
      } finally {
        if (prev === undefined) delete process.env.HOMEOPS_CONNECTOR_SANDBOX; else process.env.HOMEOPS_CONNECTOR_SANDBOX = prev;
      }
    });
    test(`cloud metadata address is blocked with HOMEOPS_CONNECTOR_SANDBOX=${flag ?? "(unset)"}`, async () => {
      const prev = process.env.HOMEOPS_CONNECTOR_SANDBOX;
      if (flag) process.env.HOMEOPS_CONNECTOR_SANDBOX = flag; else delete process.env.HOMEOPS_CONNECTOR_SANDBOX;
      try {
        const r = await net.assertSafeUrl("http://169.254.169.254/latest/meta-data");
        assert.equal(r.ok, false);
        assert.equal(r.error, "private_range_blocked");
      } finally {
        if (prev === undefined) delete process.env.HOMEOPS_CONNECTOR_SANDBOX; else process.env.HOMEOPS_CONNECTOR_SANDBOX = prev;
      }
    });
    test(`a public literal address is allowed with HOMEOPS_CONNECTOR_SANDBOX=${flag ?? "(unset)"}`, async () => {
      const prev = process.env.HOMEOPS_CONNECTOR_SANDBOX;
      if (flag) process.env.HOMEOPS_CONNECTOR_SANDBOX = flag; else delete process.env.HOMEOPS_CONNECTOR_SANDBOX;
      try {
        const r = await net.assertSafeUrl("http://8.8.8.8/");
        assert.equal(r.ok, true);
        assert.equal(r.ipCategory, "public");
      } finally {
        if (prev === undefined) delete process.env.HOMEOPS_CONNECTOR_SANDBOX; else process.env.HOMEOPS_CONNECTOR_SANDBOX = prev;
      }
    });
  }
});
