#!/usr/bin/env node
// Upload/refresh the FamiliOS SIMULATOR build on Appetize.io.
//   node tests/topgun/appetize/upload-appetize.mjs path\to\build.tar.gz
// Requires APPETIZE_API_TOKEN. Reuses APPETIZE_PUBLIC_KEY when set (updates the same
// app slot so session configs and saved links stay valid); first upload creates one.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TOPGUN_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envFile = path.join(TOPGUN_ROOT, ".env.topgun");
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (v !== "" && process.env[k] === undefined) process.env[k] = v;
  }
}

const build = process.argv[2];
const token = process.env.APPETIZE_API_TOKEN;
const existing = process.env.APPETIZE_PUBLIC_KEY;

if (!build || !fs.existsSync(build)) {
  console.error("Usage: node tests/topgun/appetize/upload-appetize.mjs <simulator build .tar.gz|.zip>");
  console.error("Build one with: cd apps/mobile && eas build -p ios --profile simulator");
  process.exit(1);
}
if (!token) {
  console.error("BLOCKED: set APPETIZE_API_TOKEN first (Appetize account page → API token).");
  process.exit(2);
}

const form = new FormData();
form.append("file", new Blob([fs.readFileSync(build)]), path.basename(build));
form.append("platform", "ios");

const url = existing ? `https://api.appetize.io/v1/apps/${existing}` : "https://api.appetize.io/v1/apps";
const res = await fetch(url, { method: "POST", headers: { "X-API-KEY": token }, body: form });
const body = await res.json().catch(() => ({}));
if (!res.ok || !body.publicKey) {
  console.error(`Upload failed (${res.status}):`, body);
  process.exit(1);
}

console.log(`Uploaded. APPETIZE_PUBLIC_KEY=${body.publicKey}`);
console.log(`App page: ${body.appURL ?? `https://appetize.io/app/${body.publicKey}`}`);
if (fs.existsSync(envFile)) {
  const text = fs.readFileSync(envFile, "utf8");
  const updated = /^APPETIZE_PUBLIC_KEY=.*$/m.test(text)
    ? text.replace(/^APPETIZE_PUBLIC_KEY=.*$/m, `APPETIZE_PUBLIC_KEY=${body.publicKey}`)
    : `${text.trimEnd()}\nAPPETIZE_PUBLIC_KEY=${body.publicKey}\n`;
  fs.writeFileSync(envFile, updated);
  console.log(`Recorded in ${envFile}`);
}
