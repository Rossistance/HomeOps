import { defineConfig } from "@playwright/test";

// Top Gun iOS simulator lane (Appetize.io) — separate config on purpose:
// no local webServer is needed to drive a cloud-hosted simulator.
export default defineConfig({
  testDir: "./specs",
  outputDir: "../.artifacts/appetize/results",
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [
    ["list"],
    ["html", { outputFolder: "../.artifacts/appetize/report", open: "never" }],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
