#!/usr/bin/env node
// Upload a device .ipa to BrowserStack App Automate and record the bs:// id.
//   node tests/topgun/appium/upload-browserstack.mjs path\to\FamiliOS.ipa
// Requires BROWSERSTACK_USERNAME + BROWSERSTACK_ACCESS_KEY (tests/topgun/.env.topgun).
import fs from "node:fs";
import path from "node:path";
import { TOPGUN_ROOT, loadTopgunEnv } from "./lib/env.mjs";

loadTopgunEnv();
const ipa = process.argv[2];
const user = process.env.BROWSERSTACK_USERNAME;
const key = process.env.BROWSERSTACK_ACCESS_KEY;

if (!ipa || !fs.existsSync(ipa)) {
  console.error("Usage: node tests/topgun/appium/upload-browserstack.mjs <path-to-.ipa>");
  console.error("Build one with: cd apps/mobile && eas build -p ios --profile preview");
  process.exit(1);
}
if (!user || !key) {
  console.error("BLOCKED: set BROWSERSTACK_USERNAME and BROWSERSTACK_ACCESS_KEY first (see docs/SETUP-CLOUD.md).");
  process.exit(2);
}

const form = new FormData();
form.append("file", new Blob([fs.readFileSync(ipa)]), path.basename(ipa));

const res = await fetch("https://api-cloud.browserstack.com/app-automate/upload", {
  method: "POST",
  headers: { Authorization: `Basic ${Buffer.from(`${user}:${key}`).toString("base64")}` },
  body: form,
});
const body = await res.json().catch(() => ({}));
if (!res.ok || !body.app_url) {
  console.error(`Upload failed (${res.status}):`, body);
  process.exit(1);
}

console.log(`Uploaded. BROWSERSTACK_APP_ID=${body.app_url}`);
const envFile = path.join(TOPGUN_ROOT, ".env.topgun");
if (fs.existsSync(envFile)) {
  const text = fs.readFileSync(envFile, "utf8");
  const updated = /^BROWSERSTACK_APP_ID=.*$/m.test(text)
    ? text.replace(/^BROWSERSTACK_APP_ID=.*$/m, `BROWSERSTACK_APP_ID=${body.app_url}`)
    : `${text.trimEnd()}\nBROWSERSTACK_APP_ID=${body.app_url}\n`;
  fs.writeFileSync(envFile, updated);
  console.log(`Recorded in ${envFile}`);
} else {
  console.log(`Add it to tests/topgun/.env.topgun as BROWSERSTACK_APP_ID=${body.app_url}`);
}
