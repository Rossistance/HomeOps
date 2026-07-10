// C0 tenancy spike — evidence for the ADR that gates C1.1 (tenant-scoped
// persistence). NOT production code; nothing imports this.
//
// What it does:
//   1. Copies the JSON collections from server/.data (or SPIKE_DATA_DIR) into a
//      scratch dir — the real store is never touched.
//   2. Migrates them into ONE SQLite database (the "database per household"
//      shape): keyed collections become rows, whole-doc files become kv, the
//      audit log becomes an append-only table.
//   3. Verifies migration fidelity: every record round-trips deep-equal.
//   4. Benchmarks the two hot paths against the current whole-file JSON store:
//      point-read of one record, and read-modify-write of one record.
//
// Engines, in preference order:
//   - node:sqlite (Node >= 22.5) — synchronous, zero-dependency. Preserves the
//     existing synchronous keyedCollection surface as-is.
//   - @libsql/client (file: URL)  — async; measures the same ops to show the
//     Turso-compatible path, but an async driver would force an async refactor
//     of every store call site.
//
// Usage: node server/spike/tenant-store-spike.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.SPIKE_DATA_DIR || path.join(here, "..", ".data");
const OUT = path.join(here, "out");
const ITER = Number(process.env.SPIKE_ITER || 200);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/* ---------- 1. Copy source data (read-only on the original) ---------- */
const dataDir = path.join(OUT, "data-copy");
fs.mkdirSync(dataDir);
const skip = (n) =>
  !n.endsWith(".json") && n !== "audit.jsonl" ||
  n.includes(".tmp") || n.includes(".corrupt");
let copied = 0;
for (const name of fs.readdirSync(SRC)) {
  if (skip(name)) continue;
  if (!fs.statSync(path.join(SRC, name)).isFile()) continue;
  fs.copyFileSync(path.join(SRC, name), path.join(dataDir, name));
  copied++;
}

/* ---------- 2. Engine selection ---------- */
let engineName = null;
let db = null; // normalized: { exec(sql), run(sql, params), get(sql, params), all(sql, params), isAsync }
try {
  const { DatabaseSync } = await import("node:sqlite");
  const raw = new DatabaseSync(path.join(OUT, "tenant-local.db"));
  db = {
    isAsync: false,
    exec: (sql) => raw.exec(sql),
    run: (sql, p = []) => raw.prepare(sql).run(...p),
    get: (sql, p = []) => raw.prepare(sql).get(...p),
    all: (sql, p = []) => raw.prepare(sql).all(...p),
  };
  engineName = `node:sqlite (${process.version})`;
} catch {
  const { createClient } = await import("@libsql/client");
  const raw = createClient({ url: `file:${path.join(OUT, "tenant-local.db").replace(/\\/g, "/")}` });
  db = {
    isAsync: true,
    exec: (sql) => raw.execute(sql),
    run: (sql, p = []) => raw.execute({ sql, args: p }),
    get: (sql, p = []) => raw.execute({ sql, args: p }).then((r) => r.rows[0]),
    all: (sql, p = []) => raw.execute({ sql, args: p }).then((r) => r.rows),
  };
  engineName = `@libsql/client (${process.version})`;
}
const A = async (v) => v; // awaiting a plain value is a no-op → same code path for both engines

// libsql's execute() is single-statement; run DDL one statement at a time so
// both engines take the same path.
try { await A(db.exec("PRAGMA journal_mode = WAL")); } catch { /* libsql local files manage journaling themselves */ }
await A(db.exec("CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (collection, id))"));
await A(db.exec("CREATE TABLE kv (file TEXT PRIMARY KEY, doc TEXT NOT NULL)"));
await A(db.exec("CREATE TABLE audit_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, line TEXT NOT NULL)"));

/* ---------- 3. Migrate ---------- */
// A file is a keyed collection iff it's a non-empty plain object whose every
// value is an object carrying id === its key (the keyedCollection invariant).
function isKeyed(parsed) {
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return false;
  const entries = Object.entries(parsed);
  if (entries.length === 0) return false;
  return entries.every(([k, v]) => v && typeof v === "object" && !Array.isArray(v) && v.id === k);
}

const report = { engine: engineName, filesCopied: copied, keyed: {}, kv: [], auditLines: 0, verify: { records: 0, mismatches: [] } };
for (const name of fs.readdirSync(dataDir)) {
  const text = fs.readFileSync(path.join(dataDir, name), "utf8");
  if (name === "audit.jsonl") {
    const lines = text.split("\n").filter(Boolean);
    for (const line of lines) await A(db.run("INSERT INTO audit_log (line) VALUES (?)", [line]));
    report.auditLines = lines.length;
    continue;
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { report.kv.push(`${name} (UNPARSEABLE — left as file)`); continue; }
  const collection = name.replace(/\.json$/, "");
  if (isKeyed(parsed)) {
    for (const [id, doc] of Object.entries(parsed)) {
      await A(db.run("INSERT INTO records (collection, id, doc) VALUES (?, ?, ?)", [collection, id, JSON.stringify(doc)]));
    }
    report.keyed[collection] = Object.keys(parsed).length;
  } else {
    await A(db.run("INSERT INTO kv (file, doc) VALUES (?, ?)", [name, text]));
    report.kv.push(name);
  }
}

/* ---------- 4. Verify fidelity ---------- */
const canon = (v) => JSON.stringify(v, Object.keys(v).length ? undefined : undefined); // exact JSON of the parsed doc
for (const [collection, count] of Object.entries(report.keyed)) {
  const src = JSON.parse(fs.readFileSync(path.join(dataDir, `${collection}.json`), "utf8"));
  const rows = await A(db.all("SELECT id, doc FROM records WHERE collection = ?", [collection]));
  if (rows.length !== count) report.verify.mismatches.push(`${collection}: row count ${rows.length} != ${count}`);
  for (const row of rows) {
    const a = JSON.stringify(JSON.parse(row.doc));
    const b = JSON.stringify(src[row.id]);
    if (a !== b) report.verify.mismatches.push(`${collection}/${row.id}`);
    report.verify.records++;
  }
}

/* ---------- 5. Benchmarks ---------- */
// Target: the biggest real collection (runs) — the worst case for whole-file JSON.
const benchTarget = Object.entries(report.keyed).sort((x, y) => {
  const size = (c) => fs.statSync(path.join(dataDir, `${c}.json`)).size;
  return size(y[0]) - size(x[0]);
})[0]?.[0];
report.bench = { collection: benchTarget, iterations: ITER };
if (benchTarget) {
  const file = path.join(dataDir, `${benchTarget}.json`);
  const ids = Object.keys(JSON.parse(fs.readFileSync(file, "utf8")));
  const pick = () => ids[Math.floor(Math.random() * ids.length)];
  const fileKB = Math.round(fs.statSync(file).size / 1024);
  report.bench.fileKB = fileKB;

  const time = async (fn) => {
    const t0 = process.hrtime.bigint();
    for (let i = 0; i < ITER; i++) await A(fn(pick()));
    return Number(process.hrtime.bigint() - t0) / 1e6 / ITER; // ms/op
  };

  // Current JSON store semantics (store.mjs readJSON/writeJSON, verbatim).
  const jsonRead = (id) => JSON.parse(fs.readFileSync(file, "utf8"))[id];
  const jsonWrite = (id) => {
    const all = JSON.parse(fs.readFileSync(file, "utf8"));
    all[id] = { ...all[id], updatedAt: new Date().toISOString() };
    const tmp = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
    fs.renameSync(tmp, file);
  };
  const sqlRead = (id) => db.get("SELECT doc FROM records WHERE collection = ? AND id = ?", [benchTarget, id]);
  const sqlWrite = async (id) => {
    const row = await A(db.get("SELECT doc FROM records WHERE collection = ? AND id = ?", [benchTarget, id]));
    const doc = JSON.parse(row.doc);
    doc.updatedAt = new Date().toISOString();
    await A(db.run("UPDATE records SET doc = ? WHERE collection = ? AND id = ?", [JSON.stringify(doc), benchTarget, id]));
  };

  report.bench.msPerOp = {
    json_point_read: +(await time(jsonRead)).toFixed(3),
    sqlite_point_read: +(await time(sqlRead)).toFixed(3),
    json_read_modify_write: +(await time(jsonWrite)).toFixed(3),
    sqlite_read_modify_write: +(await time(sqlWrite)).toFixed(3),
  };
}

/* ---------- 6. Report ---------- */
fs.writeFileSync(path.join(OUT, "spike-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
