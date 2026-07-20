// WP-004 / ISS-006 — the flagship Weather tool must fail HONESTLY.
// A broken upstream (HTTP error, non-JSON body, or a body with no `current`
// readings) must surface as {ok:false, error:"provider_error"} — never as a
// hollow {location,fetchedAt} "success" whose readings were silently dropped
// by JSON undefined-stripping. Upstream fetch is stubbed for determinism.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

// Isolated store BEFORE the first ../store.mjs import (ISS-001 guard).
process.env.HOMEOPS_DATA_DIR ||= fs.mkdtempSync(join(os.tmpdir(), "homeops-weather-"));
const { executeTool } = await import("../connectors.mjs");

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

function stubFetch(response) {
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("api.open-meteo.com")) return response();
    return realFetch(url, init);
  };
}

test("upstream HTTP error → provider_error, never hollow success", async () => {
  stubFetch(async () => new Response(JSON.stringify({ reason: "Latitude must be in range of -90 to 90°." }), { status: 400 }));
  const r = await executeTool("weather.current", {});
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.error, "provider_error");
  assert.match(String(r.message), /400/);
});

test("upstream non-JSON body → provider_error", async () => {
  stubFetch(async () => new Response("<html>rate limited</html>", { status: 200, headers: { "content-type": "text/html" } }));
  const r = await executeTool("weather.current", {});
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.error, "provider_error");
});

test("upstream 200 with missing `current` readings → provider_error (the ISS-006 hollow case)", async () => {
  stubFetch(async () => new Response(JSON.stringify({ latitude: 40.71, longitude: -74.0 }), { status: 200 }));
  const r = await executeTool("weather.current", {});
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.error, "provider_error");
  assert.match(String(r.message), /no current conditions/i);
});

test("healthy upstream → real readings in the result", async () => {
  stubFetch(async () => new Response(JSON.stringify({ current: { temperature_2m: 21.4, wind_speed_10m: 8.2, weather_code: 2 } }), { status: 200 }));
  const r = await executeTool("weather.current", {});
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.result.temperatureC, 21.4);
  assert.equal(r.result.windKph, 8.2);
  assert.equal(r.result.weatherCode, 2);
});
