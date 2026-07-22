// WP-012 — connector provisioning for the gated 13 use-cases.
//
// src/data/providerSetup.ts is the single source of truth for the setup checklists shown
// in Connections (src/screens/Connections.tsx) and mirrored in
// docs/connector-provisioning.md. This suite is the alignment proof: it parses the REAL
// registries (server/providers.mjs PROVIDERS, server/connectors.mjs CONNECTORS) and the
// REAL checklist data side by side, so the docs/UI can never silently drift from the env
// vars / scopes / config fields the code actually checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

const DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-ai-"));
process.env.HOMEOPS_DATA_DIR = DATA_DIR;
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";

const { PROVIDERS, listProviders } = await import("../providers.mjs");
const { CONNECTORS, listConnectors } = await import("../connectors.mjs");
// providerSetup.ts is plain, erasable TypeScript (interfaces + const object literals) —
// Node's native type-stripping (this repo's engines range supports it) imports it
// directly, no build step, so this test can never drift from a stale compiled copy.
const { PROVIDER_SETUP_GUIDES, CONNECTOR_SETUP_GUIDES } = await import("../../src/data/providerSetup.ts");

// The exact 13 gated UCs named in audit/work-packages.md WP-012 ("UC-1..10, 12, 13, 14").
const GATED_UCS = ["UC-1", "UC-2", "UC-3", "UC-4", "UC-5", "UC-6", "UC-7", "UC-8", "UC-9", "UC-10", "UC-12", "UC-13", "UC-14"];

test("every PROVIDERS entry has a providerSetup guide with envVars matching clientIdEnv/clientSecretEnv", () => {
  for (const p of PROVIDERS) {
    const guide = PROVIDER_SETUP_GUIDES[p.id];
    assert.ok(guide, `missing providerSetup guide for provider "${p.id}"`);
    assert.equal(guide.id, p.id);
    assert.deepEqual(
      [...guide.envVars].sort(),
      [p.clientIdEnv, p.clientSecretEnv].sort(),
      `envVars for "${p.id}" must exactly match server/providers.mjs clientIdEnv/clientSecretEnv`,
    );
  }
});

test("providerSetup has no orphaned guide for an id that isn't in PROVIDERS", () => {
  const ids = new Set(PROVIDERS.map((p) => p.id));
  for (const id of Object.keys(PROVIDER_SETUP_GUIDES)) {
    assert.ok(ids.has(id), `providerSetup guide "${id}" does not match any server/providers.mjs PROVIDERS id`);
  }
});

test("every scopesNeeded entry in a provider guide is a real, unaltered scope from server/providers.mjs", () => {
  for (const p of PROVIDERS) {
    const guide = PROVIDER_SETUP_GUIDES[p.id];
    const real = new Map(p.scopes.map((s) => [s.key, s]));
    assert.ok(guide.scopesNeeded.length > 0, `guide "${p.id}" cites no scopes`);
    for (const s of guide.scopesNeeded) {
      const match = real.get(s.key);
      assert.ok(match, `guide "${p.id}" cites unknown scope key "${s.key}"`);
      assert.equal(s.label, match.label, `guide "${p.id}" scope "${s.key}" label has drifted from providers.mjs`);
    }
  }
});

test("every unlocksUCs id looks like a real UC reference (UC-<n>)", () => {
  for (const [id, guide] of Object.entries(PROVIDER_SETUP_GUIDES)) {
    assert.ok(guide.unlocksUCs.length > 0, `provider guide "${id}" unlocks no UCs`);
    for (const u of guide.unlocksUCs) assert.match(u.id, /^UC-\d+$/, `bad UC id "${u.id}" in guide "${id}"`);
  }
  for (const [id, guide] of Object.entries(CONNECTOR_SETUP_GUIDES)) {
    for (const u of guide.unlocksUCs) assert.match(u.id, /^UC-\d+$/, `bad UC id "${u.id}" in connector guide "${id}"`);
  }
});

test("the gated 13 UCs (WP-012) are covered by exactly the provider + sms guides — no more, no less", () => {
  const covered = new Set();
  for (const guide of Object.values(PROVIDER_SETUP_GUIDES)) for (const u of guide.unlocksUCs) covered.add(u.id);
  for (const u of CONNECTOR_SETUP_GUIDES.sms.unlocksUCs) covered.add(u.id);
  assert.deepEqual([...covered].sort(), [...GATED_UCS].sort());
});

test("sms connector guide config fields align 1:1 with connectors.mjs sms configSchema (keys + env names)", () => {
  const sms = CONNECTORS.find((c) => c.id === "sms");
  const guide = CONNECTOR_SETUP_GUIDES.sms;
  assert.deepEqual(guide.configFields.map((f) => f.key).sort(), sms.configSchema.map((f) => f.key).sort());
  assert.deepEqual(
    guide.configFields.filter((f) => f.env).map((f) => f.env).sort(),
    sms.configSchema.filter((f) => f.env).map((f) => f.env).sort(),
  );
  // required-ness matches too, so the checklist never tells an admin a field is optional
  // when the server actually refuses to report "connected" without it (readinessOf/
  // requiredSatisfied in connectors.mjs).
  for (const f of guide.configFields) {
    const real = sms.configSchema.find((x) => x.key === f.key);
    assert.equal(!!f.required, !!real.required, `sms field "${f.key}" required-ness drifted`);
  }
});

test("http connector guide config fields align 1:1 with connectors.mjs http configSchema keys", () => {
  const http = CONNECTORS.find((c) => c.id === "http");
  const guide = CONNECTOR_SETUP_GUIDES.http;
  assert.deepEqual(guide.configFields.map((f) => f.key).sort(), http.configSchema.map((f) => f.key).sort());
});

test("publicProvider() carries the honest setupGuide marker for every provider", () => {
  for (const p of listProviders()) {
    assert.equal(p.setupGuide, true, `provider "${p.id}" is missing setupGuide:true`);
  }
});

test("publicConnector() carries setupGuide only for connectors that actually have a checklist (sms, http)", () => {
  for (const c of listConnectors()) {
    const expected = c.id === "sms" || c.id === "http";
    assert.equal(c.setupGuide, expected, `connector "${c.id}" setupGuide marker mismatch (expected ${expected})`);
  }
  // and both of those really do have a guide to back the marker up — no dangling flag.
  assert.ok(CONNECTOR_SETUP_GUIDES.sms);
  assert.ok(CONNECTOR_SETUP_GUIDES.http);
});
