import { defineConfig, devices } from "@playwright/test";

// Top Gun web/PWA lane — primary runtime driver (see runtime-drivers.json).
// Boots the full local stack (backend :8787 + Vite :5173) unless one is already
// running. NOTE: the backend needs Node >= 22.13 (node:sqlite) — same as `npm run dev`.
const PORT = Number(process.env.TOPGUN_WEB_PORT || 5173);
const BASE = process.env.TOPGUN_WEB_BASEURL || `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./web",
  outputDir: "./.artifacts/web/results",
  // The backend is one shared stateful instance — serialize to stay deterministic.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "./.artifacts/web/report", open: "never" }],
  ],
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "web-chromium", use: { ...devices["Desktop Chrome"] } },
    // WebKit engine + iPhone profile: the closest iOS-Safari/PWA approximation
    // available on Windows. Web evidence only — never native-iOS evidence.
    { name: "web-webkit-iphone", use: { ...devices["iPhone 15"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: BASE,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
