// FamiliOS backend test harness.
//
// Boots the REAL server (server/index.mjs) as a child process on an ephemeral port,
// pointed at an isolated temp data dir (HOMEOPS_DATA_DIR), so tests exercise the true
// request path — gate(), CSRF, session cookies, the store — without ever touching the
// real server/.data. Each test file calls startServer() in a before() and stopServer()
// in an after().
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = join(__dirname, "..", "index.mjs");
const ORIGIN = "http://localhost:5173";

// Belt-and-suspenders for ISS-001: make the TEST PROCESS itself incapable of
// resolving the live server/.data. If a test file (or anything it imports)
// pulls in ../store.mjs without choosing its own data dir first, it lands in
// this throwaway temp dir instead of the real store. startServer() still gives
// every spawned server its own separate mkdtemp dir below.
if (!process.env.HOMEOPS_DATA_DIR) {
  process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(join(os.tmpdir(), "homeops-test-proc-"));
}

/**
 * Start a fresh server instance. Returns a context object with helpers.
 * PORT=0 lets the OS assign a free port (no collisions, ever); the harness
 * learns the real port from the server's "listening on" line.
 * @param {object} [opts]
 * @param {boolean} [opts.prod] run with HOMEOPS_ENV=production
 * @param {Record<string,string>} [opts.env] extra env vars
 */
export async function startServer(opts = {}) {
  const dataDir = fs.mkdtempSync(join(os.tmpdir(), "homeops-test-"));
  const env = {
    ...process.env,
    PORT: "0",
    HOMEOPS_DATA_DIR: dataDir,
    HOMEOPS_ALLOWED_ORIGINS: ORIGIN,
    HOMEOPS_SECRET_KEY: "test-secret-key-test-secret-key-32",
    NODE_ENV: opts.prod ? "production" : "development",
    HOMEOPS_ENV: opts.prod ? "production" : "development",
    ...(opts.env || {}),
  };
  const child = spawn(process.execPath, [SERVER_ENTRY], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d.toString(); });
  let stdout = "";
  let port = 0;
  child.stdout.on("data", (d) => {
    stdout += d.toString();
    const m = stdout.match(/listening on http:\/\/localhost:(\d+)/);
    if (m) port = Number(m[1]);
  });

  // Learn the bound port before probing health.
  {
    const deadline = Date.now() + 15_000;
    while (!port) {
      if (child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode}):\n${stderr}`);
      if (Date.now() > deadline) throw new Error(`server never reported its port:\n${stdout}\n${stderr}`);
      await new Promise((res) => setTimeout(res, 50));
    }
  }
  const base = `http://localhost:${port}`;
  const ctx = {
    base, port, dataDir, child,
    /** Raw fetch against the server with the test Origin set. */
    async fetch(path, init = {}) {
      const headers = { Origin: ORIGIN, ...(init.headers || {}) };
      return fetch(base + path, { ...init, headers });
    },
  };

  // Wait for readiness via /api/health (origin-allowed, no session).
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early (code ${child.exitCode}):\n${stderr}`);
    try {
      const r = await fetch(base + "/api/health", { headers: { Origin: ORIGIN } });
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`server did not become ready in time:\n${stderr}`);
    await new Promise((res) => setTimeout(res, 100));
  }
  return ctx;
}

export async function stopServer(ctx) {
  if (!ctx || !ctx.child) return;
  await new Promise((res) => {
    ctx.child.once("exit", () => res());
    ctx.child.kill("SIGKILL");
    setTimeout(res, 1000);
  });
  try { fs.rmSync(ctx.dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
}

/**
 * Create a session for a seeded household member and return an authed client.
 * The actorId selects the member; role is resolved server-side from the registry.
 * @param {object} ctx server context from startServer()
 * @param {string} actorId e.g. "m-alex" (Owner), "m-noah" (Child View)
 * @param {object} [body] extra session body fields (e.g. role for bypass tests, pin)
 */
export async function makeSession(ctx, actorId, body = {}) {
  const res = await ctx.fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ actorId, actorName: actorId, ...body }),
  });
  const setCookie = res.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  const csrf = json?.session?.csrf;
  const role = json?.session?.role;
  // An authed request helper bound to this session's cookie + CSRF token.
  const client = {
    actorId, cookie, csrf, role, status: res.status, raw: json,
    async req(path, init = {}) {
      const headers = { ...(init.headers || {}) };
      if (cookie) headers.Cookie = cookie;
      if (csrf && init.method && init.method !== "GET") headers["x-homeops-csrf"] = csrf;
      if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
      const r = await ctx.fetch(path, { ...init, headers });
      let data = null;
      try { data = await r.json(); } catch { /* non-JSON */ }
      return { status: r.status, data, headers: r.headers };
    },
    /** Same auth, but the body comes back as text. For routes that aren't JSON — an SSE
     * stream parsed as JSON silently yields null, which reads as "the server sent nothing"
     * rather than "you asked the wrong way". */
    async text(path, init = {}) {
      const headers = { ...(init.headers || {}) };
      if (cookie) headers.Cookie = cookie;
      if (csrf && init.method && init.method !== "GET") headers["x-homeops-csrf"] = csrf;
      if (init.body && !headers["content-type"]) headers["content-type"] = "application/json";
      const r = await ctx.fetch(path, { ...init, headers });
      return { status: r.status, text: await r.text(), headers: r.headers };
    },
  };
  return client;
}

/* ---- Direct store seeding (C1.1: the store is a per-tenant SQLite db) ----
 * Tests used to seed by dropping JSON files into ctx.dataDir; the tenant db
 * only sweeps root files once, at first boot, so runtime seeding goes through
 * the same engine the server uses (SQLite WAL is safely multi-process). */
import { createEngine } from "../tenant-db.mjs";
export function readStoreDoc(ctx, file, fallback, tenant = "local") {
  const eng = createEngine(ctx.dataDir);
  try { return eng.getDoc(tenant, file, fallback); } finally { eng.closeAll(); }
}
/** Seed a row-backed record (runs, events, …) the way the server's own put* functions do.
 * writeStoreDoc can't reach these: records live in the engine's row table, not in a doc. */
export function writeStoreRecord(ctx, coll, id, doc, tenant = "local") {
  const eng = createEngine(ctx.dataDir);
  try { eng.putRecord(tenant, coll, id, doc); } finally { eng.closeAll(); }
}
export function writeStoreDoc(ctx, file, value, tenant = "local") {
  const eng = createEngine(ctx.dataDir);
  try { eng.putDoc(tenant, file, value); } finally { eng.closeAll(); }
}

export { ORIGIN };
export const newId = () => crypto.randomBytes(6).toString("hex");
