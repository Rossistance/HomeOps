// FamiliOS — WP-007 standalone launcher for a real Supermemory sidecar.
//
// Used by the integration test (server/test/memory-provider-sidecar.test.mjs) to attempt
// a GENUINE boot rather than assuming success or mocking it. On the Windows host this was
// built on, this is EXPECTED to fail: `npx supermemory local install` shells out to WSL and
// there is no distro installed (see server/memory-provider.mjs's header comment for the
// full DEC-014 transcript). That failure is the point — this launcher reports WHY, in
// detail, so the test can skip with a real, specific reason instead of silently passing or
// faking success.
//
// Also runnable directly for manual probing: `node server/scripts/memory-sidecar-launcher.mjs`
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const isWin = process.platform === "win32";

export function sidecarBinaryPath() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  return join(home, ".local", "bin", isWin ? "supermemory-server.exe" : "supermemory-server");
}

function caEnv() {
  const caBundle = join(root, "server", ".data", "win-root-cas.pem");
  const extraCa = process.env.NODE_EXTRA_CA_CERTS || (existsSync(caBundle) ? caBundle : undefined);
  return extraCa ? { NODE_EXTRA_CA_CERTS: extraCa } : {};
}

/** Best-effort install. Returns {ok, reason?}. Never throws. */
export async function ensureInstalled({ timeoutMs = 90_000 } = {}) {
  if (existsSync(sidecarBinaryPath())) return { ok: true };
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(isWin ? "npx.cmd" : "npx", ["--yes", "supermemory", "local", "install"], {
        cwd: root, shell: isWin, env: { ...process.env, ...caEnv() },
      });
    } catch (e) {
      resolve({ ok: false, reason: `could not spawn npx: ${e?.message ?? e}` });
      return;
    }
    let out = "";
    child.stdout?.on("data", (d) => { out += d.toString(); });
    child.stderr?.on("data", (d) => { out += d.toString(); });
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* best effort */ }
      resolve({ ok: false, reason: `install timed out after ${timeoutMs}ms:\n${out.trim()}` });
    }, timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, reason: `spawn error: ${e?.message ?? e}` }); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0 && existsSync(sidecarBinaryPath())) resolve({ ok: true });
      else resolve({ ok: false, reason: `installer exited ${code}:\n${out.trim()}` });
    });
  });
}

/**
 * Boot a real sidecar. Returns {ok, proc, port} on success or {ok:false, reason} on
 * failure — the caller (test before()) is expected to skip-with-reason on failure, per
 * DEC-014, rather than paper over it.
 */
export async function startSidecar({ port = 6767, timeoutMs = 20_000 } = {}) {
  const installed = await ensureInstalled();
  if (!installed.ok) return { ok: false, reason: installed.reason };
  let child;
  try {
    child = spawn(isWin ? "npx.cmd" : "npx", ["--yes", "supermemory", "local", "start", "--port", String(port)], {
      cwd: root, shell: isWin, env: { ...process.env, ...caEnv() },
    });
  } catch (e) {
    return { ok: false, reason: `could not spawn sidecar: ${e?.message ?? e}` };
  }
  let out = "";
  child.stdout?.on("data", (d) => { out += d.toString(); });
  child.stderr?.on("data", (d) => { out += d.toString(); });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return { ok: false, reason: `sidecar exited early (code ${child.exitCode}):\n${out.trim()}` };
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v3/health`);
      if (r.ok) return { ok: true, proc: child, port };
    } catch { /* not up yet */ }
    await new Promise((res) => setTimeout(res, 300));
  }
  try { child.kill(); } catch { /* best effort */ }
  return { ok: false, reason: `sidecar did not report healthy within ${timeoutMs}ms:\n${out.trim()}` };
}

export function stopSidecar(proc) {
  try { proc?.kill(); } catch { /* best effort */ }
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("memory-sidecar-launcher.mjs");
if (isMain) {
  const r = await startSidecar({});
  if (r.ok) {
    console.log(`memory sidecar reported healthy on port ${r.port}`);
    stopSidecar(r.proc);
  } else {
    console.log(`memory sidecar could not start:\n${r.reason}`);
    process.exitCode = 1;
  }
}
