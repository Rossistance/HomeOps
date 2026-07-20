// WebdriverIO remote-session factory for the Top Gun iOS device-cloud lane.
// Caps live in ../caps/<name>.ios.json with ${VAR} / ${VAR:-default} placeholders.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadTopgunEnv, substituteEnv } from "./env.mjs";

const CAPS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "caps");

const ENDPOINTS = {
  browserstack: { protocol: "https", hostname: "hub-cloud.browserstack.com", port: 443, path: "/wd/hub" },
  lambdatest: { protocol: "https", hostname: "mobile-hub.lambdatest.com", port: 443, path: "/wd/hub" },
};

export function capsName() {
  return (process.env.TOPGUN_CAPS || "browserstack").toLowerCase();
}

export function loadCaps(name = capsName()) {
  loadTopgunEnv();
  const file = path.join(CAPS_DIR, `${name}.ios.json`);
  if (!fs.existsSync(file)) throw new Error(`Unknown caps set "${name}" — expected ${file}`);
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  delete raw._usage;
  const missing = new Set();
  const caps = substituteEnv(raw, missing);
  return { caps, missing: [...missing], file };
}

export function endpointFor(name = capsName()) {
  if (ENDPOINTS[name]) return ENDPOINTS[name];
  const url = process.env.APPIUM_REMOTE_URL;
  if (!url) return null;
  const u = new URL(url);
  return {
    protocol: u.protocol.replace(":", ""),
    hostname: u.hostname,
    port: u.port ? Number(u.port) : u.protocol === "https:" ? 443 : 4723,
    path: u.pathname && u.pathname !== "/" ? u.pathname : "/",
  };
}

/** Probe (no session): is this lane runnable now, or blocked on user-side setup? */
export function probeLane(name = capsName()) {
  const endpoint = endpointFor(name);
  const missing = [];
  if (!endpoint) missing.push("APPIUM_REMOTE_URL");
  try {
    missing.push(...loadCaps(name).missing);
  } catch (err) {
    return { name, classification: "unavailable", missing, error: String(err?.message ?? err) };
  }
  return missing.length
    ? { name, classification: "blocked", missing, unblock: `Set ${missing.join(", ")} (tests/topgun/.env.topgun — see docs/SETUP-CLOUD.md)` }
    : { name, classification: "use now", missing: [] };
}

export async function createDriver(name = capsName()) {
  const probe = probeLane(name);
  if (probe.classification !== "use now") {
    throw new Error(`Lane "${name}" is ${probe.classification}: ${probe.unblock ?? probe.error}`);
  }
  const { remote } = await import("webdriverio");
  const { caps } = loadCaps(name);
  const driver = await remote({
    ...endpointFor(name),
    capabilities: caps,
    logLevel: "error",
    connectionRetryTimeout: 180_000,
    connectionRetryCount: 1,
  });
  return driver;
}

export function dashboardHint(name, sessionId) {
  if (name === "browserstack")
    return `https://app-automate.browserstack.com/dashboard/v2 (session ${sessionId})`;
  if (name === "lambdatest") return `https://appautomation.lambdatest.com/build (session ${sessionId})`;
  return `session ${sessionId} on ${process.env.APPIUM_REMOTE_URL ?? "the configured endpoint"}`;
}
