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
// Vite/Rolldown intermittently dies with a native access violation (0xC0000005 =
// exit 3221225477) on Windows under heavy dev churn. A dead web server silently
// breaks every browser session and test run against :5173, so crash exits are
// respawned (bounded; a clean Ctrl-C shutdown is not).
let web = null;
let webRestarts = 0;
let shuttingDown = false;
function spawnWeb() {
  web = spawn(isWin ? "npx.cmd" : "npx", ["vite"], { cwd: root, stdio: "inherit", shell: isWin });
  web.on("exit", (code) => {
    console.log(`[web] exited with ${code}`);
    if (shuttingDown || code === 0) return;
    if (webRestarts >= 5) { console.error("[web] crashed too many times — giving up (restart dev manually)"); return; }
    webRestarts += 1;
    console.log(`[web] respawning after crash (attempt ${webRestarts}/5)…`);
    setTimeout(spawnWeb, 1000);
  });
}
spawnWeb();

// Browser Automation runtime: opt-in by installation. If server/browser-runtime has its
// deps installed (npm install + npm run setup there), spawn it alongside so the Browser
// connector is actually connected instead of "Runtime not connected". Not installed → skip
// silently (the connector stays honestly unavailable).
let browserRt = null;
const rtDir = join(root, "server", "browser-runtime");
if (fs.existsSync(join(rtDir, "node_modules", "playwright"))) {
  /* Pin the runtime's port for the same reason the backend's is pinned above — and it bit
   * harder here. index.mjs reads `BROWSER_RUNTIME_PORT || PORT || 9223`, and this spawn passed
   * the whole environment through, so any PORT meant for the WEB server was inherited by the
   * runtime. Launch it under PORT=5173 and the runtime and Vite race for that port: whichever
   * binds first wins, and when the runtime won, http://localhost:5173 served its JSON health
   * body instead of the app. Same symptom either way — "the app didn't load" — with a
   * different cause each run, which is the worst kind of dev bug to chase. */
  const rtPort = process.env.BROWSER_RUNTIME_PORT || "9223";
  browserRt = spawn(process.execPath, [join(rtDir, "index.mjs")], {
    cwd: rtDir, stdio: "inherit",
    env: { ...process.env, PORT: rtPort, BROWSER_RUNTIME_PORT: rtPort, ...(extraCa ? { NODE_EXTRA_CA_CERTS: extraCa } : {}) },
  });
  browserRt.on("exit", (code) => console.log(`[browser-runtime] exited with ${code}`));
}

// Memory sidecar (WP-007, DEC-014): opt-in, mirroring the browser-runtime pattern above.
// On THIS host `npx supermemory local install` requires WSL (none installed here — see
// server/memory-provider.mjs's header for the exact transcript), so nothing spawns by
// default; the server already falls back to its in-process sqlite-FTS5 backend with zero
// configuration. If a real sidecar IS installed (its launcher reports a real binary path)
// AND the operator explicitly opts in via HOMEOPS_MEMORY_SIDECAR=1, start it alongside dev
// so /api/health's memoryProvider field reflects an actually-connected sidecar.
let memorySidecar = null;
if (process.env.HOMEOPS_MEMORY_SIDECAR === "1") {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const candidates = [join(home, ".local", "bin", "supermemory-server"), join(home, ".local", "bin", "supermemory-server.exe")];
  if (home && candidates.some((p) => fs.existsSync(p))) {
    const sidecarPort = process.env.HOMEOPS_MEMORY_SIDECAR_PORT || "6767";
    memorySidecar = spawn(isWin ? "npx.cmd" : "npx", ["--yes", "supermemory", "local", "start", "--port", sidecarPort], {
      cwd: root, stdio: "inherit", shell: isWin,
      env: { ...process.env, ...(extraCa ? { NODE_EXTRA_CA_CERTS: extraCa } : {}) },
    });
    memorySidecar.on("exit", (code) => console.log(`[memory-sidecar] exited with ${code}`));
  } else {
    console.log("[memory-sidecar] HOMEOPS_MEMORY_SIDECAR=1 but no installed binary found (run `npx supermemory local install`, needs WSL on Windows) — using the sqlite-FTS5 fallback instead.");
  }
}

const shutdown = () => { shuttingDown = true; try { backend.kill(); } catch {} try { web?.kill(); } catch {} try { browserRt?.kill(); } catch {} try { memorySidecar?.kill(); } catch {} };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
