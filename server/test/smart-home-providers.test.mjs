// SMART HOME — Amazon Alexa is its own placeholder-credential provider; Google Home is a
// permission (the `smarthome`/SDM scope + tools) ON the base `google` connector, per the
// product decision to grant it alongside Gmail/Calendar. No server boot needed:
// listProviders() is a pure, secret-free view of PROVIDERS.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listProviders } from "../providers.mjs";

test("Amazon Alexa registers as a Smart Home provider with a valid shape", () => {
  const alexa = listProviders().find((x) => x.id === "amazon-alexa");
  assert.ok(alexa, "amazon-alexa is registered");
  assert.equal(alexa.category, "Smart Home");
  assert.equal(alexa.authType, "oauth2");
  assert.ok(Array.isArray(alexa.scopes) && alexa.scopes.length > 0, "alexa has scopes");
  assert.ok(Array.isArray(alexa.tools) && alexa.tools.length > 0, "alexa has tools");
  // Deployment env var NAMES are surfaced to the frontend (values never are).
  assert.ok(alexa.clientIdEnv === "HOMEOPS_OAUTH_ALEXA_CLIENT_ID", "alexa clientIdEnv name present");
  assert.ok(alexa.clientSecretEnv === "HOMEOPS_OAUTH_ALEXA_CLIENT_SECRET", "alexa clientSecretEnv name present");
  assert.ok(["configured", "not_configured_by_deployment"].includes(alexa.readiness), "alexa readiness is a valid state");
  for (const s of alexa.scopes) assert.ok(s.key && s.label && s.risk, "alexa scope has key/label/risk");
  for (const t of alexa.tools) { assert.ok(t.id && t.name && t.action, "alexa tool has id/name/action"); assert.ok(Array.isArray(t.scopes), "alexa tool carries scopes"); }
});

test("Alexa exposes its announce/list tools", () => {
  const alexa = listProviders().find((p) => p.id === "amazon-alexa");
  const ids = alexa.tools.map((t) => t.id);
  assert.ok(ids.includes("alexa.announce"), "alexa.announce present");
  assert.ok(ids.includes("alexa.listDevices"), "alexa.listDevices present");
});

test("Google Home is a permission ON the google connector (smarthome scope + SDM tools)", () => {
  const google = listProviders().find((p) => p.id === "google");
  assert.ok(google, "google connector is registered");
  // The Google Home capability is granted as a scope on the Google connector, not a separate provider.
  assert.equal(listProviders().find((p) => p.id === "google-home"), undefined, "no standalone google-home provider");
  assert.ok(google.scopes.some((s) => s.key === "smarthome"), "google connector offers the Google Home (smarthome) permission");
  const ids = google.tools.map((t) => t.id);
  assert.ok(ids.includes("smarthome.listDevices"), "smarthome.listDevices lives on the google connector");
  assert.ok(ids.includes("smarthome.setThermostat"), "smarthome.setThermostat lives on the google connector");
  // Those tools must be gated by the smarthome scope so they only light up once granted.
  for (const t of google.tools.filter((t) => t.id.startsWith("smarthome."))) {
    assert.ok(t.scopes.includes("smarthome"), `${t.id} is gated by the smarthome scope`);
  }
});
