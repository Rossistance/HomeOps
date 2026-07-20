// Loads tests/topgun/.env.topgun into process.env (existing env always wins).
// Tiny by design — no dotenv dependency; Node's --env-file can't be used here
// because the appium runner spawns child processes that must inherit the vars.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const TOPGUN_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadTopgunEnv() {
  const file = path.join(TOPGUN_ROOT, ".env.topgun");
  if (!fs.existsSync(file)) return { loaded: false, file };
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (value !== "" && process.env[key] === undefined) process.env[key] = value;
  }
  return { loaded: true, file };
}

/** Replace ${VAR} and ${VAR:-default} tokens in every string of a JSON-ish object. */
export function substituteEnv(node, missing = new Set()) {
  if (typeof node === "string") {
    return node.replace(/\$\{([A-Z0-9_]+)(?::-([^}]*))?\}/g, (_, name, fallback) => {
      const v = process.env[name];
      if (v !== undefined && v !== "") return v;
      if (fallback !== undefined) return fallback;
      missing.add(name);
      return "";
    });
  }
  if (Array.isArray(node)) return node.map((n) => substituteEnv(n, missing));
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, substituteEnv(v, missing)]));
  }
  return node;
}
