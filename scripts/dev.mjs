// Runs the HomeOps backend runtime and the Vite dev server together.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import fs from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";

// Corporate networks often TLS-intercept outbound HTTPS, which breaks Node's fetch
// (UNABLE_TO_GET_ISSUER_CERT_LOCALLY) for every cloud AI provider / connector call.
// If a Windows root-CA bundle has been exported (see server/.data/win-root-cas.pem),
// hand it to the backend via NODE_EXTRA_CA_CERTS (additive; an existing env wins).
const caBundle = join(root, "server", ".data", "win-root-cas.pem");
const extraCa = process.env.NODE_EXTRA_CA_CERTS || (fs.existsSync(caBundle) ? caBundle : undefined);
if (extraCa && !process.env.NODE_EXTRA_CA_CERTS) console.log(`[backend] using CA bundle: ${extraCa}`);

// Backend: spawn node directly (no shell) so a node path with spaces works.
// Pin the backend port to 8787 (do not inherit a PORT meant for the web server).
const backendPort = process.env.HOMEOPS_BACKEND_PORT || "8787";
const backend = spawn(process.execPath, [join(root, "server", "index.mjs")], {
  cwd: root, stdio: "inherit",
  env: { ...process.env, PORT: backendPort, ...(extraCa ? { NODE_EXTRA_CA_CERTS: extraCa } : {}) },
});
backend.on("exit", (code) => console.log(`[backend] exited with ${code}`));

// Web: vite via npx (needs shell on Windows for npx.cmd resolution).
const web = spawn(isWin ? "npx.cmd" : "npx", ["vite"], { cwd: root, stdio: "inherit", shell: isWin });
web.on("exit", (code) => console.log(`[web] exited with ${code}`));

// Browser Automation runtime: opt-in by installation. If server/browser-runtime has its
// deps installed (npm install + npm run setup there), spawn it alongside so the Browser
// connector is actually connected instead of "Runtime not connected". Not installed → skip
// silently (the connector stays honestly unavailable).
let browserRt = null;
const rtDir = join(root, "server", "browser-runtime");
if (fs.existsSync(join(rtDir, "node_modules", "playwright"))) {
  browserRt = spawn(process.execPath, [join(rtDir, "index.mjs")], {
    cwd: rtDir, stdio: "inherit",
    env: { ...process.env, ...(extraCa ? { NODE_EXTRA_CA_CERTS: extraCa } : {}) },
  });
  browserRt.on("exit", (code) => console.log(`[browser-runtime] exited with ${code}`));
}

const shutdown = () => { try { backend.kill(); } catch {} try { web.kill(); } catch {} try { browserRt?.kill(); } catch {} };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
