# ADR-001: Tenant storage — SQLite database per household (node:sqlite)

**Status:** Accepted · 2026-07-10
**Gates:** C1.1 tenant-scoped persistence ([COMMERCIALIZATION_PLAN.md](../COMMERCIALIZATION_PLAN.md) §Phase 1)
**Evidence:** [server/spike/tenant-store-spike.mjs](../../server/spike/tenant-store-spike.mjs) (run it: `node server/spike/tenant-store-spike.mjs`)

## Context

Today every collection is a whole JSON file under one `DATA_DIR` — one implicit
tenant (`householdId: "local"`). Multi-tenancy needs per-household isolation,
and the accessor surface everything is built on (`keyedCollection`:
`all/get/put/patch/remove/list`, plus raw `readJSON/writeJSON`) is
**synchronous** — hundreds of call sites across engine, planner, router, and
connectors return store values directly.

## Options considered

1. **SQLite file per household** via Node's built-in `node:sqlite` (libSQL/Turso-compatible format)
2. **Postgres + row-level security**, one shared database
3. **Status quo per household** — a JSON-file directory per tenant

## Spike evidence (real household data, 35 files, 260 keyed records)

| Operation on the 2 MB `runs` collection | JSON file store | node:sqlite | libsql |
|---|---|---|---|
| Point read of one record | 5.9 ms | **0.031 ms** (~190×) | 0.053 ms |
| Read-modify-write of one record | 25.2 ms | **1.23 ms** (~20×) | 1.35 ms |

- **Migration fidelity:** all 260 records round-tripped deep-equal, 0 mismatches; 2,306 audit lines preserved.
- **Three real record shapes exist** and the C1.1 migrator must handle each:
  keyed with embedded `id` (runs, tasks, agents…), keyed **without** embedded
  `id` (members, jobs), and plain arrays (artifacts, memory, accounts).
- **Driver findings on the Windows dev box:** `better-sqlite3` fails to install
  (node-gyp, corp TLS blocks prebuilt download); `@libsql/client` installs
  clean but is **async-only** — adopting it on the hot path would force an
  async refactor of every store call site. `node:sqlite` (`DatabaseSync`) is
  synchronous, zero-dependency, and worked unmodified.

## Decision

**SQLite database per household through `node:sqlite`, swapped in behind the
existing synchronous `store.mjs` surface.** Nothing above `store.mjs` changes.

Why this beats Postgres+RLS here:

- **The sync surface is the whole ballgame.** `DatabaseSync` keeps C1.1 a
  store-internal swap; Postgres would turn it into an async rewrite of the
  entire server.
- **Physical isolation per family** (one file = one household) beats logical
  RLS isolation for the product's privacy story, per-household backup/export
  (R0.2 becomes `VACUUM INTO` per tenant), and Apple-style account deletion
  (delete the file).
- **Same mental model as today** — DATA_DIR of families → directory of
  household DB files — and the same embedded engine the desktop Private Mode
  (C3) reuses verbatim.
- **Turso door stays open.** The file format is libSQL-compatible; managed
  replication/embedded replicas via `@libsql/client` can be added later for
  multi-region or >1-dyno, as a background sync concern rather than a hot-path
  driver.

**Postgres+RLS is deferred, not rejected.** Revisit triggers: horizontal
scaling past one instance, cross-household analytics needs, or >~1k active
households on one disk.

## Consequences / C1.1 implementation notes

- **Node version pin required.** `node:sqlite` is flag-free from Node 23.4+
  (stable in 24 LTS); local dev has 22/25 via nvm; Render must be pinned
  (engines field + verify on a deploy) **before** the store swap lands.
- Schema per household DB: `records(collection, id, doc JSON, PRIMARY KEY(collection, id))`
  + `kv(file, doc)` for whole-doc files + `audit_log(seq, line)` append-only.
- Boot-time migration: existing JSON `DATA_DIR` → `tenant-local.db` as tenant
  #1, verified by the spike's round-trip check as a real test; JSON files
  retired to a `.migrated/` attic, never deleted.
- `withLock`/`withRunLock` stay (single process); WAL on. Corruption
  quarantine (R0.1) maps to `PRAGMA integrity_check` on open.
- Data-rev poll (`/api/rev`) becomes per-household.
