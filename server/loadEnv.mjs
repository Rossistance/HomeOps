// Minimal .env loader (zero-dependency). Loads KEY=VALUE lines from homeops-ai/.env
// into process.env on startup so deployment/admin secrets (OAuth client IDs/secrets,
// allowed origins, public URL) can be set in one file instead of shell exports.
// Existing environment variables always win over the file.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const file of [join(root, ".env"), join(root, ".env.local")]) {
  try {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line || /^\s*#/.test(line)) continue;
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = val;
    }
  } catch { /* ignore malformed env file */ }
}
