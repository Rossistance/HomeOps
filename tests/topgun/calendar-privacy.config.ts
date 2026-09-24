import { defineConfig, devices } from "@playwright/test";

// Calendar privacy (ADR-005) — a light web check on its OWN stack, never the shared one:
//   backend  scripts/seed-calendar-demo.mjs --serve  → a fresh temp HOMEOPS_DATA_DIR, seeded
//            with the demo household (Alex, Gpop, Beannie, Sam, Noah), on CAL_API_PORT
//   web      Vite on CAL_WEB_PORT, /api proxied to that backend
// reuseExistingServer is off on purpose: the spec's assertions are about the seed, so it must
// never run against a household someone has been using. Screenshots go to Playwright's own
// outputDir (tests/topgun/.artifacts/…, ignored by git) — nothing committed is rewritten.
// Run: npm run test:calendar-privacy
const API_PORT = Number(process.env.CAL_API_PORT || 8797);
const WEB_PORT = Number(process.env.CAL_WEB_PORT || 5197);
const WEB = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: "./calendar",
  outputDir: "./.artifacts/calendar/results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: WEB,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "web-chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `node scripts/seed-calendar-demo.mjs --serve --port ${API_PORT}`,
      cwd: "../..",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "ignore",
      env: { HOMEOPS_ALLOWED_ORIGINS: `${WEB},http://127.0.0.1:${WEB_PORT}` },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      cwd: "../..",
      url: WEB,
      reuseExistingServer: false,
      timeout: 120_000,
      env: { HOMEOPS_BACKEND: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
