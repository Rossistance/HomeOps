// Runs the HomeOps backend runtime and the Vite dev server together.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";

// Backend: spawn node directly (no shell) so a node path with spaces works.
// Pin the backend port to 8787 (do not inherit a PORT meant for the web server).
const backendPort = process.env.HOMEOPS_BACKEND_PORT || "8787";
const backend = spawn(process.execPath, [join(root, "server", "index.mjs")], { cwd: root, stdio: "inherit", env: { ...process.env, PORT: backendPort } });
backend.on("exit", (code) => console.log(`[backend] exited with ${code}`));

// Web: vite via npx (needs shell on Windows for npx.cmd resolution).
const web = spawn(isWin ? "npx.cmd" : "npx", ["vite"], { cwd: root, stdio: "inherit", shell: isWin });
web.on("exit", (code) => console.log(`[web] exited with ${code}`));

const shutdown = () => { try { backend.kill(); } catch {} try { web.kill(); } catch {} };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
