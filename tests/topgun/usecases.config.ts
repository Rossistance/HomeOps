import { defineConfig, devices } from "@playwright/test";

// Top Gun 22-use-case executable benchmark (WP-006 s4–s6) — one spec per UC under
// ./usecases, driven through the REAL web UI against the REAL local backend.
//
// Lanes (see .top-gun run-20260721-054151 verification-matrix and
// server/test/README-sandbox.md):
//   - ACTIVE lane (9 UCs): every tool runs for real in the default local env.
//   - GATED lane (13 UCs): the external credential is user-owned (OAuth apps,
//     device APIs, Twilio). Those specs run against the connector sandbox —
//     start the backend with HOMEOPS_CONNECTOR_SANDBOX=1 — and each one names
//     its real-credential blocker in a test annotation. With the sandbox OFF
//     they SKIP with the same printed blocker; they never fake a green.
//
// The backend is one shared stateful instance — serialized, like the web lane.
// Every spec creates its own DISPOSABLE household (helpers.signUpDisposableHousehold)
// and deletes it in teardown; the resident family tenant is never touched.
const PORT = Number(process.env.TOPGUN_WEB_PORT || 5173);
const BASE = process.env.TOPGUN_WEB_BASEURL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./usecases",
  outputDir: "./.artifacts/usecases/results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // A UC spec can legitimately span several runs + an approval round-trip.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "./.artifacts/usecases/report", open: "never" }],
    // Per-UC pass/latency JSON — the benchmark artifact the soak (s7) histograms.
    ["json", { outputFile: "./.artifacts/usecases/results.json" }],
  ],
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "web-chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "web-webkit-iphone", use: { ...devices["iPhone 15"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
