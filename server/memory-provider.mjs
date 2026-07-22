// FamiliOS AI — WP-007 memory-provider (DEC-014).
//
// ORIGINAL PLAN (EV-036): replace flat recency memory with retrieval-quality memory —
// hybrid search + profiles — running fully local via self-hosted Supermemory
// (`npx supermemory local`, port 6767, embedded local embeddings, containerTag scoping),
// zero cloud calls.
//
// DEC-014 FALLBACK — EXECUTED, NOT SIMULATED:
//   `npx supermemory local install` was actually run on this Windows host (see mission
//   notes for the exact transcript). On Git Bash it fails OS detection outright
//   ("unsupported OS: MINGW64_NT-10.0-26200"); run from native PowerShell instead, the
//   installer shells out to WSL and reports "Windows Subsystem for Linux has no installed
//   distributions" — Supermemory's self-hosted server has no native Windows binary path,
//   only a WSL one. Installing a WSL distro is a system-level change outside this work's
//   authority (and outside "opt-in, non-disruptive" scope), so the sidecar is genuinely
//   not installable here — this is the pre-agreed DEC-014 trigger, not a shortcut.
//
//   Per DEC-014, this module implements the SAME provider interface — add(), search(),
//   profile(), health() — over node:sqlite's built-in FTS5 (already a hard dependency;
//   see tenant-db.mjs), entirely in-process: no sidecar process, no network call, no WSL.
//   "Hybrid" here means lexical FTS5 (bm25) blended with a recency boost — there is no
//   local embedding model without the sidecar, so a vector component is honestly out of
//   scope, not faked.
//
//   The HTTP sidecar client below is kept as UNVERIFIED scaffolding for when/if a real
//   Supermemory sidecar becomes reachable (e.g. WSL gets installed later) — opt in via
//   HOMEOPS_MEMORY_SIDECAR=1. It has never been exercised against a live sidecar on this
//   host (there isn't one), so treat its wire format as a best-effort placeholder, not a
//   verified integration. The sqlite backend below is what is actually tested and running.
//
// Every call is fail-soft: callers get {degraded:true, ok:false} back, never a thrown
// exception — planner/write-path/route code can call this unconditionally.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

// Top-level await mirrors tenant-db.mjs's own guard: node:sqlite is a hard dependency of
// this codebase already (ADR-001), but the sqlite backend degrades gracefully rather than
// crashing the whole module if it's ever missing (older Node).
let DatabaseSync = null;
let sqliteImportError = null;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch (e) {
  sqliteImportError = e instanceof Error ? e : new Error(String(e));
}

const __dirname = dirname(fileURLToPath(import.meta.url));

// Same override convention as server/store.mjs (HOMEOPS_DATA_DIR) so the test harness's
// isolated temp dirs isolate the memory-provider's own sqlite file too.
function resolveDataDir() {
  return process.env.HOMEOPS_DATA_DIR ? process.env.HOMEOPS_DATA_DIR : join(__dirname, ".data");
}

const DEFAULT_TIMEOUT_MS = 1000;
const DEFAULT_CONTAINER = "default";

/** Sanitize free text into a forgiving (OR-of-prefixes) FTS5 MATCH expression. */
function ftsQuery(q) {
  const tokens = String(q ?? "").toLowerCase().match(/[a-z0-9]+/gi) ?? [];
  if (!tokens.length) return null;
  return tokens.slice(0, 16).map((t) => `"${t}"*`).join(" OR ");
}

/** Race a (possibly sync-wrapped) op against a hard deadline. Sync sqlite calls can't be
 *  preempted mid-flight, but this still bounds how long a caller ever waits, and is the
 *  real mechanism for the HTTP sidecar branch (AbortController-backed fetch). */
function withTimeout(fn, ms) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve({ ok: false, degraded: true, error: "timeout" });
    }, ms);
    (async () => {
      try {
        const r = await fn();
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(r);
      } catch (e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ ok: false, degraded: true, error: String(e?.message ?? e) });
      }
    })();
  });
}

/* ============================== sqlite (FTS5) backend ============================== */

function createSqliteBackend({ dataDir }) {
  const dir = join(dataDir, "supermemory");
  const dbPath = join(dir, "local-memory.sqlite");
  let db = null;
  let openError = null;

  function ensureOpen() {
    if (db) return db;
    if (openError) throw openError;
    try {
      if (!DatabaseSync) throw sqliteImportError ?? new Error("node:sqlite unavailable");
      fs.mkdirSync(dir, { recursive: true });
      db = new DatabaseSync(dbPath);
      db.exec("PRAGMA journal_mode = WAL");
      db.exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS memories USING fts5(id UNINDEXED, container_tag UNINDEXED, text, scope UNINDEXED, type UNINDEXED, source_actor_id UNINDEXED, created_at UNINDEXED)",
      );
      return db;
    } catch (e) {
      openError = e instanceof Error ? e : new Error(String(e));
      throw openError;
    }
  }

  async function add(text, { containerTag = DEFAULT_CONTAINER, scope, type, sourceActorId, id } = {}) {
    try {
      const memText = String(text ?? "").trim();
      if (!memText) return { ok: false, degraded: false, error: "empty_text", backend: "sqlite-fts5" };
      const database = ensureOpen();
      if (id) {
        const existing = database.prepare("SELECT rowid FROM memories WHERE id = ? AND container_tag = ?").get(id, containerTag);
        if (existing) return { ok: true, degraded: false, id, deduped: true, backend: "sqlite-fts5" };
      }
      const recId = id ?? `sm_${crypto.randomBytes(8).toString("hex")}`;
      database
        .prepare("INSERT INTO memories (id, container_tag, text, scope, type, source_actor_id, created_at) VALUES (?,?,?,?,?,?,?)")
        .run(recId, String(containerTag), memText, scope ?? null, type ?? null, sourceActorId ?? null, Date.now());
      return { ok: true, degraded: false, id: recId, backend: "sqlite-fts5" };
    } catch (e) {
      return { ok: false, degraded: true, error: String(e?.message ?? e), backend: "sqlite-fts5" };
    }
  }

  async function search(query, { containerTag = DEFAULT_CONTAINER, limit = 10 } = {}) {
    const t0 = Date.now();
    try {
      const database = ensureOpen();
      const q = String(query ?? "").trim();
      const cap = Math.max(1, Math.min(50, Number(limit) || 10));
      let rows;
      if (!q) {
        rows = database
          .prepare("SELECT id, text, scope, type, source_actor_id as sourceActorId, created_at as createdAt FROM memories WHERE container_tag = ? ORDER BY created_at DESC LIMIT ?")
          .all(String(containerTag), cap);
      } else {
        const match = ftsQuery(q);
        if (!match) {
          rows = [];
        } else {
          // Hybrid rank: bm25() lexical rank blended with a recency boost (newer wins
          // ties) — the closest honest approximation of "hybrid" without an embedding
          // model. bm25() is more negative for a better match, so subtract a small
          // recency term (larger age -> larger positive penalty).
          const now = Date.now();
          const raw = database
            .prepare(
              "SELECT id, text, scope, type, source_actor_id as sourceActorId, created_at as createdAt, bm25(memories) as rank FROM memories WHERE container_tag = ? AND memories MATCH ? ORDER BY rank LIMIT ?",
            )
            .all(String(containerTag), match, cap * 3);
          rows = raw
            .map((r) => ({ ...r, _hybrid: r.rank + (now - r.createdAt) / (1000 * 60 * 60 * 24 * 365) }))
            .sort((a, b) => a._hybrid - b._hybrid)
            .slice(0, cap)
            .map(({ _hybrid, rank, ...r }) => r);
        }
      }
      return { ok: true, degraded: false, results: rows, latencyMs: Date.now() - t0, backend: "sqlite-fts5" };
    } catch (e) {
      return { ok: false, degraded: true, error: String(e?.message ?? e), results: [], latencyMs: Date.now() - t0, backend: "sqlite-fts5" };
    }
  }

  async function profile({ containerTag = DEFAULT_CONTAINER } = {}) {
    try {
      const database = ensureOpen();
      const rows = database
        .prepare("SELECT text, scope, type, source_actor_id as sourceActorId, created_at as createdAt FROM memories WHERE container_tag = ? ORDER BY created_at DESC LIMIT 200")
        .all(String(containerTag));
      const byType = {};
      const byScope = {};
      for (const r of rows) {
        const ty = r.type || "Fact";
        const sc = r.scope || "family";
        byType[ty] = (byType[ty] || 0) + 1;
        byScope[sc] = (byScope[sc] || 0) + 1;
      }
      return {
        ok: true,
        degraded: false,
        containerTag,
        totalMemories: rows.length,
        byType,
        byScope,
        highlights: rows.slice(0, 5).map((r) => ({ text: r.text, scope: r.scope, type: r.type, sourceActorId: r.sourceActorId, createdAt: r.createdAt })),
        backend: "sqlite-fts5",
      };
    } catch (e) {
      return { ok: false, degraded: true, error: String(e?.message ?? e), containerTag, backend: "sqlite-fts5" };
    }
  }

  async function health() {
    const t0 = Date.now();
    try {
      const database = ensureOpen();
      database.prepare("SELECT count(*) as n FROM memories").get();
      return { ok: true, degraded: false, backend: "sqlite-fts5", dbPath, latencyMs: Date.now() - t0 };
    } catch (e) {
      return { ok: false, degraded: true, backend: "sqlite-fts5", error: String(e?.message ?? e), latencyMs: Date.now() - t0 };
    }
  }

  return { add, search, profile, health, backend: "sqlite-fts5", dbPath };
}

/* ============================ HTTP sidecar backend (UNVERIFIED) ============================ *
 * Never confirmed against a live Supermemory server on this host (DEC-014 above) — kept as
 * documented, fail-soft scaffolding for a future upgrade path. Opt in with
 * HOMEOPS_MEMORY_SIDECAR=1 (+ HOMEOPS_MEMORY_SIDECAR_URL, default http://127.0.0.1:6767).
 * If the sidecar isn't actually there, every call below fails fast (connection refused)
 * and degrades exactly like any other outage — it never lies about being connected. */
function createSidecarBackend({ url, timeoutMs }) {
  async function callJSON(path, { method = "GET", body } = {}) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const r = await fetch(`${url}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!r.ok) throw new Error(`sidecar_http_${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  const add = (text, { containerTag = DEFAULT_CONTAINER, scope, type, sourceActorId, id } = {}) =>
    withTimeout(async () => {
      const data = await callJSON("/v3/memories", { method: "POST", body: { content: String(text ?? ""), containerTag, id, metadata: { scope, type, sourceActorId } } });
      return { ok: true, degraded: false, id: data?.id ?? id ?? null, backend: "supermemory-sidecar" };
    }, timeoutMs);

  const search = (query, { containerTag = DEFAULT_CONTAINER, limit = 10 } = {}) =>
    withTimeout(async () => {
      const t0 = Date.now();
      const data = await callJSON("/v3/search", { method: "POST", body: { q: String(query ?? ""), containerTag, limit } });
      const results = Array.isArray(data?.results)
        ? data.results.map((r) => ({ id: r.id, text: r.content ?? r.text, scope: r.metadata?.scope, type: r.metadata?.type, sourceActorId: r.metadata?.sourceActorId, createdAt: r.createdAt }))
        : [];
      return { ok: true, degraded: false, results, latencyMs: Date.now() - t0, backend: "supermemory-sidecar" };
    }, timeoutMs);

  const profile = ({ containerTag = DEFAULT_CONTAINER } = {}) =>
    withTimeout(async () => {
      const data = await callJSON(`/v3/profile?containerTag=${encodeURIComponent(containerTag)}`);
      return { ok: true, degraded: false, containerTag, ...data, backend: "supermemory-sidecar" };
    }, timeoutMs);

  const health = () =>
    withTimeout(async () => {
      const t0 = Date.now();
      await callJSON("/v3/health");
      return { ok: true, degraded: false, backend: "supermemory-sidecar", latencyMs: Date.now() - t0 };
    }, timeoutMs);

  return { add, search, profile, health, backend: "supermemory-sidecar", url };
}

/* ================================== public factory ================================== */

/**
 * Create a memory provider — the stable interface WP-007 slices s3/s4/s5 depend on,
 * regardless of which backend actually answers.
 * @param {object} [opts]
 * @param {string} [opts.dataDir] override for the sqlite backend's data root (tests)
 * @param {boolean} [opts.sidecarEnabled] force the HTTP sidecar branch on/off (tests)
 * @param {string} [opts.sidecarUrl] sidecar base URL override
 * @param {number} [opts.timeoutMs] per-call timeout (≤1000ms per spec)
 */
export function createMemoryProvider(opts = {}) {
  const timeoutMs = Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const sidecarEnabled = opts.sidecarEnabled ?? process.env.HOMEOPS_MEMORY_SIDECAR === "1";
  const sidecarUrl = opts.sidecarUrl ?? process.env.HOMEOPS_MEMORY_SIDECAR_URL ?? "http://127.0.0.1:6767";
  const dataDir = opts.dataDir ?? resolveDataDir();

  const sqlite = createSqliteBackend({ dataDir });
  const sidecar = sidecarEnabled ? createSidecarBackend({ url: sidecarUrl, timeoutMs }) : null;

  // Active backend selection is per-call for search/profile/add/health: try the opted-in
  // sidecar first (if enabled) and fall back to the always-available sqlite backend on any
  // failure — never throw into a caller, never report a fake success.
  async function withFallback(method, args) {
    if (sidecar) {
      const r = await withTimeout(() => sidecar[method](...args), timeoutMs);
      if (r?.ok) return r;
      // sidecar unreachable/degraded — honest local fallback, not a silent success.
    }
    return withTimeout(() => sqlite[method](...args), timeoutMs);
  }

  return {
    backend: sidecar ? "supermemory-sidecar+sqlite-fts5-fallback" : "sqlite-fts5",
    add: (text, options) => withFallback("add", [text, options]),
    search: (query, options) => withFallback("search", [query, options]),
    profile: (options) => withFallback("profile", [options]),
    health: () => withFallback("health", [{}]),
    /** Direct handle to the sqlite backend (migration script, tests) — bypasses the
     *  sidecar branch entirely since the sqlite store is the durable source of truth. */
    _sqlite: sqlite,
  };
}

/** Default singleton the server (planner.mjs, internal-functions.mjs, index.mjs) uses —
 *  same DATA_DIR-resolution convention as store.mjs so test isolation carries through. */
export const memoryProvider = createMemoryProvider();
