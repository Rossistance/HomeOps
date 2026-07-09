// Installs Playwright's Chromium after npm install so web.read can render
// JS-heavy pages in-process. Skipped when FAMILIOS_BROWSER=0 (or CI sets
// PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD). Failure is non-fatal by design — the
// server degrades to plain HTML fetching when no browser is present.
import { spawnSync } from "node:child_process";

if (process.env.FAMILIOS_BROWSER === "0" || process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD) {
  console.log("[familios] skipping Chromium install (disabled by env)");
  process.exit(0);
}

// PLAYWRIGHT_BROWSERS_PATH=0 stores the browser inside node_modules, which is
// what hosts like Render persist from build to runtime.
const env = { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? "0" };
const r = spawnSync("npx", ["playwright", "install", "chromium"], { stdio: "inherit", env, shell: process.platform === "win32" });
if (r.status !== 0) {
  console.warn("[familios] Chromium install failed — web.read will use plain HTML fetching. Run `npm run install-browser` to retry.");
}
process.exit(0);
