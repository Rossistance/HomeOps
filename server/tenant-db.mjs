// FamiliOS tenant storage engine (ADR-001) — one SQLite database per household,
// through Node's built-in synchronous driver, behind the same synchronous
// surface store.mjs has always offered. Physical isolation: a household is one
// file under DATA_DIR/tenants/<householdId>/household.db (plus its audit.jsonl
// and file blobs beside it). Deleting a family = deleting a directory.
//
// Two backing shapes per ADR-001, decided by the data itself:
//   records(collection, id, doc)  — keyed collections (values embed id === key):
//                                   point reads/writes touch ONE row, not a 2MB parse.
//   kv(file, doc)                 — whole-doc files (settings, sessions, members,
//                                   arrays like memory/artifacts).
//
// Migration: the first open of a tenant whose db doesn't exist yet sweeps any
// legacy *.json files in the data root (single-tenant era) into the tenant db,
// preserving originals under .migrated/ — never deleted. Unparseable legacy
// files are left in place and quarantined, mirroring R0 semantics.
import fs from "node:fs";
import { join } from "node:path";

let DatabaseSync;
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  throw new Error(
    "FamiliOS needs Node >= 22.13 (node:sqlite) for the tenant store — see ADR-001. " +
    "Locally: `nvm use 25.8.2` (or install Node 24 LTS) and restart `npm run dev`.",
  );
}

// The keyedCollection invariant: a non-empty plain object whose every value is
// an object carrying id === its key. (members/jobs don't embed id — they stay kv.)
function isKeyedShape(value) {
  if (!value || Array.isArray(value) || typeof value !== "object") return false;
  const entries = Object.entries(value);
  if (entries.length === 0) return false;
  return entries.every(([k, v]) => v && typeof v === "object" && !Array.isArray(v) && v.id === k);
}

const collectionOf = (file) => file.replace(/\.json$/, "");

// Root files that are NOT tenant data and never migrate.
const ROOT_KEEP = new Set(["key", "win-root-cas.pem"]);

export function createEngine(dataDir) {
  const tenantsDir = join(dataDir, "tenants");
  const handles = new Map();      // tenantId -> DatabaseSync
  const quarantine = new Map();   // tenantId -> [{ file, error, at, copy? }]

  const qlist = (t) => quarantine.get(t) ?? [];
  function addQuarantine(t, entry) {
    const list = qlist(t);
    if (!list.some((q) => q.file === entry.file)) {
      list.push({ at: new Date().toISOString(), ...entry });
      quarantine.set(t, list);
    }
  }

  function tenantDir(t) {
    const d = join(tenantsDir, t);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }

  function open(t) {
    if (handles.has(t)) return handles.get(t);
    if (qlist(t).some((q) => q.file === "household.db")) return null; // stays quarantined
    const dbPath = join(tenantDir(t), "household.db");
    const fresh = !fs.existsSync(dbPath);
    let db;
    try {
      db = new DatabaseSync(dbPath);
      db.exec("PRAGMA journal_mode = WAL");
      const check = db.prepare("PRAGMA integrity_check").get();
      if (String(check?.integrity_check ?? "").toLowerCase() !== "ok") {
        throw new Error(`integrity_check: ${JSON.stringify(check)}`);
      }
      db.exec("CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, doc TEXT NOT NULL, PRIMARY KEY (collection, id))");
      db.exec("CREATE TABLE IF NOT EXISTS kv (file TEXT PRIMARY KEY, doc TEXT NOT NULL)");
    } catch (e) {
      // A tenant db that won't open or fails integrity is preserved as-is and the
      // tenant is quarantined: reads degrade to fallbacks, writes refuse loudly —
      // exactly the R0 "never clobber what we can't read" contract.
      try { db?.close(); } catch { /* already broken */ }
      addQuarantine(t, { file: "household.db", error: String(e?.message ?? e) });
      return null;
    }
    handles.set(t, db);
    if (fresh) migrateLegacyInto(t, db);
    return db;
  }

  /* ---- Legacy single-tenant migration (data root -> tenant db) ---- */
  function migrateLegacyInto(t, db) {
    if (t !== "local") return; // only the original household has legacy root data
    const names = fs.existsSync(dataDir) ? fs.readdirSync(dataDir) : [];
    const legacyJson = names.filter((n) =>
      n.endsWith(".json") && !n.includes(".tmp") && !n.includes(".corrupt") && !ROOT_KEEP.has(n) &&
      fs.statSync(join(dataDir, n)).isFile());
    const migratedDir = join(dataDir, ".migrated");

    for (const name of legacyJson) {
      const p = join(dataDir, name);
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(p, "utf8"));
      } catch (e) {
        addQuarantine(t, { file: name, error: `legacy parse failed: ${String(e?.message ?? e)}` });
        continue; // left in place, never destroyed
      }
      writeDoc(t, db, name, parsed);
      fs.mkdirSync(migratedDir, { recursive: true });
      fs.renameSync(p, join(migratedDir, name));
    }
    // Audit log + file blobs live beside the tenant db now.
    const legacyAudit = join(dataDir, "audit.jsonl");
    if (fs.existsSync(legacyAudit)) fs.renameSync(legacyAudit, join(tenantDir(t), "audit.jsonl"));
    const legacyFiles = join(dataDir, "files");
    if (fs.existsSync(legacyFiles) && !fs.existsSync(join(tenantDir(t), "files"))) {
      fs.renameSync(legacyFiles, join(tenantDir(t), "files"));
    }
  }

  /* ---- Internals shared by doc and record paths ---- */
  function requireDb(t, forWrite) {
    const db = open(t);
    if (!db) {
      if (forWrite) {
        throw new Error(`tenant_quarantined: household "${t}" storage failed to open cleanly; ` +
          "restore from a backup and acknowledge before writing.");
      }
      return null;
    }
    return db;
  }
  function requireFileWritable(t, file) {
    if (qlist(t).some((q) => q.file === file)) {
      throw new Error(`store_quarantined: ${file} is quarantined; restore and acknowledge before writing.`);
    }
  }
  const rowBacked = (db, coll) =>
    !!db.prepare("SELECT 1 AS x FROM records WHERE collection = ? LIMIT 1").get(coll);
  const kvRow = (db, file) =>
    db.prepare("SELECT doc FROM kv WHERE file = ?").get(file);

  // SAVEPOINT rather than BEGIN so callers (importTenant) can wrap many
  // writeDoc calls in one outer transaction — savepoints nest, BEGIN doesn't.
  function writeDoc(t, db, file, value) {
    const coll = collectionOf(file);
    const keyed = isKeyedShape(value);
    db.exec("SAVEPOINT writedoc");
    try {
      if (keyed || rowBacked(db, coll)) {
        db.prepare("DELETE FROM records WHERE collection = ?").run(coll);
        db.prepare("DELETE FROM kv WHERE file = ?").run(file);
        if (keyed) {
          const ins = db.prepare("INSERT INTO records (collection, id, doc) VALUES (?, ?, ?)");
          for (const [id, doc] of Object.entries(value)) ins.run(coll, id, JSON.stringify(doc));
        } else if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
          // {} on a row-backed collection = clear it; nothing to insert.
        } else {
          db.prepare("INSERT OR REPLACE INTO kv (file, doc) VALUES (?, ?)").run(file, JSON.stringify(value));
        }
      } else {
        db.prepare("INSERT OR REPLACE INTO kv (file, doc) VALUES (?, ?)").run(file, JSON.stringify(value));
      }
      db.exec("RELEASE writedoc");
    } catch (e) {
      try { db.exec("ROLLBACK TO writedoc"); db.exec("RELEASE writedoc"); } catch { /* not in txn */ }
      throw e;
    }
  }

  // Promote a kv-backed keyed doc to rows (only ever needed if record ops are
  // used against a file that arrived as a whole doc).
  function promote(t, db, coll) {
    const row = kvRow(db, `${coll}.json`);
    if (!row) return;
    let parsed;
    try { parsed = JSON.parse(row.doc); } catch { return; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    db.exec("SAVEPOINT promote");
    try {
      const ins = db.prepare("INSERT OR REPLACE INTO records (collection, id, doc) VALUES (?, ?, ?)");
      for (const [id, doc] of Object.entries(parsed)) ins.run(coll, id, JSON.stringify(doc));
      db.prepare("DELETE FROM kv WHERE file = ?").run(`${coll}.json`);
      db.exec("RELEASE promote");
    } catch (e) {
      try { db.exec("ROLLBACK TO promote"); db.exec("RELEASE promote"); } catch { /* not in txn */ }
      throw e;
    }
  }

  return {
    /* ---- documents (whole-file semantics, the readJSON/writeJSON substrate) ---- */
    getDoc(t, file, fallback) {
      const db = requireDb(t, false);
      if (!db) return fallback;
      const coll = collectionOf(file);
      if (rowBacked(db, coll)) {
        const out = {};
        for (const r of db.prepare("SELECT id, doc FROM records WHERE collection = ?").all(coll)) {
          out[r.id] = JSON.parse(r.doc);
        }
        return out;
      }
      const row = kvRow(db, file);
      if (!row) return fallback;
      try { return JSON.parse(row.doc); } catch (e) {
        addQuarantine(t, { file, error: String(e?.message ?? e) });
        return fallback;
      }
    },
    putDoc(t, file, value) {
      const db = requireDb(t, true);
      requireFileWritable(t, file);
      writeDoc(t, db, file, value);
    },

    /* ---- records (single-row fast paths for keyed collections) ---- */
    getRecord(t, coll, id) {
      const db = requireDb(t, false);
      if (!db) return null;
      const row = db.prepare("SELECT doc FROM records WHERE collection = ? AND id = ?").get(coll, id);
      if (row) return JSON.parse(row.doc);
      const kv = kvRow(db, `${coll}.json`);
      if (kv) { try { return JSON.parse(kv.doc)?.[id] ?? null; } catch { return null; } }
      return null;
    },
    putRecord(t, coll, id, doc) {
      const db = requireDb(t, true);
      requireFileWritable(t, `${coll}.json`);
      promote(t, db, coll);
      db.prepare("INSERT OR REPLACE INTO records (collection, id, doc) VALUES (?, ?, ?)").run(coll, id, JSON.stringify(doc));
      return doc;
    },
    deleteRecord(t, coll, id) {
      const db = requireDb(t, true);
      requireFileWritable(t, `${coll}.json`);
      promote(t, db, coll);
      return db.prepare("DELETE FROM records WHERE collection = ? AND id = ?").run(coll, id).changes > 0;
    },
    /** All records of a row-backed collection as {id: doc}, or null if this
     * collection isn't row-backed (callers then use getDoc). */
    allRecords(t, coll) {
      const db = requireDb(t, false);
      if (!db || !rowBacked(db, coll)) return null;
      const out = {};
      for (const r of db.prepare("SELECT id, doc FROM records WHERE collection = ?").all(coll)) {
        out[r.id] = JSON.parse(r.doc);
      }
      return out;
    },

    /* ---- whole-tenant export/import (backups: human-readable JSON bundles) ---- */
    /** Every collection/doc of a tenant as { "<file>.json": <parsed value> } —
     * the exact shape of the legacy file store, so backups stay readable and
     * restorable across format eras. */
    exportTenant(t) {
      const db = requireDb(t, false);
      if (!db) return null;
      const files = {};
      const colls = db.prepare("SELECT DISTINCT collection AS c FROM records").all().map((r) => r.c);
      for (const coll of colls) {
        const out = {};
        for (const r of db.prepare("SELECT id, doc FROM records WHERE collection = ?").all(coll)) out[r.id] = JSON.parse(r.doc);
        files[`${coll}.json`] = out;
      }
      for (const r of db.prepare("SELECT file, doc FROM kv").all()) {
        files[r.file] = JSON.parse(r.doc);
      }
      return files;
    },
    /** Replace a tenant's entire contents from an export bundle, atomically —
     * verify everything first, then swap inside one transaction. */
    importTenant(t, files) {
      const db = requireDb(t, true);
      db.exec("BEGIN");
      try {
        db.exec("DELETE FROM records");
        db.exec("DELETE FROM kv");
        for (const [file, value] of Object.entries(files)) writeDoc(t, db, file, value);
        db.exec("COMMIT");
      } catch (e) {
        try { db.exec("ROLLBACK"); } catch { /* not in txn */ }
        throw e;
      }
    },

    /* ---- tenant lifecycle & health ---- */
    openTenant(t) { open(t); },
    tenantIds() {
      if (!fs.existsSync(tenantsDir)) return [];
      return fs.readdirSync(tenantsDir).filter((n) => fs.existsSync(join(tenantsDir, n, "household.db")));
    },
    tenantPath(t, ...segments) { return join(tenantDir(t), ...segments); },
    quarantined(t) { return qlist(t); },
    acknowledge(t, file) {
      const list = qlist(t).filter((q) => q.file !== file);
      const had = list.length !== qlist(t).length;
      quarantine.set(t, list);
      return had;
    },
    closeAll() {
      for (const db of handles.values()) { try { db.close(); } catch { /* closing */ } }
      handles.clear();
    },
  };
}
