// FamiliOS — household data backups. Nightly gzipped bundle PER HOUSEHOLD, exported from
// that household's tenant database back into the human-readable JSON shape, 30-day
// retention, and readable only by that household's Owner. Weekly the Owner gets a
// "backup ready" notification.
//
// SECURITY — why this file is shaped this way (2026-07-30). It used to write ONE bundle
// containing EVERY tenant into a shared `backups/` directory, and the routes that list,
// download, and restore it were gated at `minRole: "Owner"`. Every family that signs up is
// the Owner of its own household, so any registered stranger could enumerate the bundles,
// download one, and read every other family's complete data — then restore it and
// overwrite every tenant. The per-tenant databases underneath were correctly isolated and
// well tested; this one path reached around all of it.
//
// The rule now: a household-facing call NEVER sees outside its own tenant. Snapshots live
// in `backups/<householdId>/`, and the household id is taken from the caller's session
// context, never from a request body. The old all-tenant bundles are left on disk
// untouched (they are a real safety net) but are no longer reachable by a household — only
// through the operator surface, which lives behind a deployment env var no household
// controls. Format 3 is single-tenant; formats 1 and 2 still restore, and a format-2
// bundle restored by a household imports ONLY that household's slice.
import fs from "node:fs";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { getSettings, setSettings, appendAudit, addNotification, listMembers, tenantEngine, CURRENT_TENANT } from "./store.mjs";
import { currentTenant } from "./tenant-context.mjs";

const DATA_DIR = process.env.HOMEOPS_DATA_DIR || join(process.cwd(), "server", ".data");
const BACKUP_DIR = join(DATA_DIR, "backups");
const RETENTION_DAYS = 30;

const NAME_RE = /^familios-backup-[\d-]+\.json\.gz$/;

/** Tenant ids are minted server-side (`local`, `_system`, `hh_<hex>`), but this value ends
 *  up in a filesystem path, so it is validated rather than trusted. Anything else throws:
 *  a backup silently written to the wrong directory is worse than no backup. */
function tenantDir(householdId) {
  const id = String(householdId ?? "").trim();
  if (!id || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Error(`unsafe_tenant_id:${id}`);
  return join(BACKUP_DIR, id);
}

function backupName(d = new Date()) {
  return `familios-backup-${d.toISOString().slice(0, 10)}.json.gz`;
}

/* ------------------------------ household-facing ------------------------------ */

/** Snapshot ONE household: its full tenant export + its own audit log. */
export function createBackup(householdId = currentTenant()) {
  const dir = tenantDir(householdId);
  fs.mkdirSync(dir, { recursive: true });
  const engine = tenantEngine();
  const files = engine.exportTenant(householdId);
  if (!files) return null; // quarantined tenant: nothing readable to snapshot
  const auditPath = engine.tenantPath(householdId, "audit.jsonl");
  const audit = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, "utf8") : "";
  const count = Object.keys(files).length;
  const bundle = {
    meta: { at: new Date().toISOString(), app: "familios", format: 3, tenant: householdId, count },
    files, audit,
  };
  const name = backupName();
  fs.writeFileSync(join(dir, name), gzipSync(JSON.stringify(bundle)));
  appendAudit({ type: "backup.created", name, files: count, householdId });
  return name;
}

export function listBackups(householdId = currentTenant()) {
  let dir;
  try { dir = tenantDir(householdId); } catch { return []; }
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => NAME_RE.test(f))
    .map((f) => {
      const st = fs.statSync(join(dir, f));
      return { name: f, sizeBytes: st.size, at: st.mtime.toISOString() };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function readBackup(name, householdId = currentTenant()) {
  if (!NAME_RE.test(name)) return null; // no traversal
  let dir;
  try { dir = tenantDir(householdId); } catch { return null; }
  const p = join(dir, name);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p);
}

/**
 * Restore ONE household from its own bundle. Verify the whole payload before importing
 * anything, then import in a single transaction for that tenant.
 *
 * A format-2 (all-tenant) bundle sitting in a household's own directory is restored
 * SLICE-ONLY: just `bundle.tenants[householdId]`. A household restoring a backup must
 * never be able to write into a neighbour's database, whatever the file happens to contain.
 */
export function restoreBackup(name, householdId = currentTenant()) {
  const raw = readBackup(name, householdId);
  if (!raw) return { ok: false, error: "not_found" };
  let bundle;
  try { bundle = JSON.parse(gunzipSync(raw).toString("utf8")); } catch { return { ok: false, error: "corrupt_backup" }; }
  const engine = tenantEngine();

  // Format 3 — single-tenant, the only shape we write now.
  if (bundle?.meta?.format === 3) {
    if (!bundle.files || typeof bundle.files !== "object") return { ok: false, error: "bad_format" };
    // A bundle stamped with a different tenant is a mis-filed file, not a licence to
    // import it: the stamp is checked, and the DESTINATION is always the caller's own.
    if (bundle.meta.tenant && bundle.meta.tenant !== householdId) {
      return { ok: false, error: "tenant_mismatch", expected: householdId, found: bundle.meta.tenant };
    }
    return importOne(engine, householdId, bundle.files, bundle.audit, { name, format: 3 });
  }

  // Format 2 — legacy all-tenant bundle. Import this household's slice only.
  if (bundle?.meta?.format === 2 && bundle.tenants) {
    const slice = bundle.tenants[householdId];
    if (!slice || typeof slice.files !== "object") return { ok: false, error: "no_slice_for_household" };
    return importOne(engine, householdId, slice.files, slice.audit, { name, format: 2, sliceOnly: true });
  }

  // Format 1 — the JSON-file era: a flat file map for a single (then only) household.
  if (bundle?.meta?.format === 1 && bundle.files) {
    const files = {};
    for (const [f, content] of Object.entries(bundle.files)) {
      if (f.endsWith(".json")) {
        try { files[f] = JSON.parse(content); } catch { return { ok: false, error: "invalid_file", file: f }; }
      }
    }
    const audit = typeof bundle.files["audit.jsonl"] === "string" ? bundle.files["audit.jsonl"] : "";
    return importOne(engine, householdId, files, audit, { name, format: 1 });
  }

  return { ok: false, error: "bad_format" };
}

function importOne(engine, householdId, files, audit, meta) {
  engine.importTenant(householdId, files); // single transaction
  if (typeof audit === "string" && audit.length) {
    fs.writeFileSync(engine.tenantPath(householdId, "audit.jsonl"), audit);
  }
  const count = Object.keys(files).length;
  appendAudit({ type: "backup.restored", householdId, files: count, ...meta });
  return { ok: true, files: count, note: "Restart the server so all collections reload." };
}

/** Retention sweep across every household's directory, plus the legacy root bundles. */
export function pruneBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return 0;
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  let pruned = 0;
  const sweep = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = join(dir, f);
      if (!NAME_RE.test(f)) continue;
      if (fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); pruned++; }
    }
  };
  for (const entry of fs.readdirSync(BACKUP_DIR, { withFileTypes: true })) {
    const p = join(BACKUP_DIR, entry.name);
    if (entry.isDirectory()) sweep(p);
    else if (NAME_RE.test(entry.name) && fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); pruned++; }
  }
  return pruned;
}

/** Deleting a household must delete its snapshots too — otherwise "delete my account"
 *  leaves 30 days of complete family data on disk, which is exactly what the Apple
 *  5.1.1(v) flow and every deletion promise say it does not do. */
export function deleteBackupsFor(householdId) {
  let dir;
  try { dir = tenantDir(householdId); } catch { return 0; }
  if (!fs.existsSync(dir)) return 0;
  const n = fs.readdirSync(dir).filter((f) => NAME_RE.test(f)).length;
  fs.rmSync(dir, { recursive: true, force: true });
  /* Deliberately NOT audited here.
   *
   * appendAudit writes to the AMBIENT tenant's audit.jsonl, and the only caller is the
   * account-deletion route — which runs as the household it has just deleted. So this line
   * recreated `tenants/<householdId>/audit.jsonl` moments after deleteTenant removed it,
   * resurrecting a directory for a family that no longer exists and leaving their id on disk
   * indefinitely. Caught by deleting a throwaway household and looking at the filesystem
   * afterwards rather than trusting the 200.
   *
   * The count is returned instead, and the caller records it on the durable tombstone in the
   * system tenant, which is where a fact about a deleted household belongs. */
  return n;
}

/* -------------------------------- operator-only -------------------------------- */
// The pre-2026-07-30 all-tenant bundles. Kept because they are a genuine safety net, and
// reachable ONLY through the operator surface (HOMEOPS_OPERATOR_EMAILS) — never by a
// household Owner. The routes that call these are responsible for the operator check.

export function listLegacyBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && NAME_RE.test(e.name))
    .map((e) => {
      const st = fs.statSync(join(BACKUP_DIR, e.name));
      return { name: e.name, sizeBytes: st.size, at: st.mtime.toISOString(), scope: "all-tenants" };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function readLegacyBackup(name) {
  if (!NAME_RE.test(name)) return null;
  const p = join(BACKUP_DIR, name);
  if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null;
  return fs.readFileSync(p);
}

/** Disaster recovery: restore every tenant from a legacy all-tenant bundle. */
export function restoreLegacyBundle(name) {
  const raw = readLegacyBackup(name);
  if (!raw) return { ok: false, error: "not_found" };
  let bundle;
  try { bundle = JSON.parse(gunzipSync(raw).toString("utf8")); } catch { return { ok: false, error: "corrupt_backup" }; }
  const engine = tenantEngine();
  if (bundle?.meta?.format !== 2 || !bundle.tenants) return { ok: false, error: "bad_format" };
  let count = 0;
  for (const [t, data] of Object.entries(bundle.tenants)) {
    if (!data || typeof data.files !== "object") return { ok: false, error: "bad_format", tenant: t };
    count += Object.keys(data.files).length;
  }
  for (const [t, data] of Object.entries(bundle.tenants)) {
    engine.importTenant(t, data.files);
    if (typeof data.audit === "string" && data.audit.length) {
      fs.writeFileSync(engine.tenantPath(t, "audit.jsonl"), data.audit);
    }
  }
  appendAudit({ type: "backup.restored_legacy_all_tenants", name, files: count, tenants: Object.keys(bundle.tenants).length });
  return { ok: true, files: count, tenants: Object.keys(bundle.tenants).length, note: "Restart the server so all collections reload." };
}

/* ----------------------------------- cadence ----------------------------------- */

/** Called from the periodic sweep, once per household (the caller iterates tenants).
 *  Cadence bookkeeping and the weekly notice are per-household too — previously both
 *  read and wrote the resident household's settings, so only one family was ever told
 *  its backups existed. */
export async function backupTick(householdId = currentTenant()) {
  const s = getSettings(householdId);
  const now = Date.now();
  const lastBackupAt = Number(s.lastBackupAt ?? 0);
  if (now - lastBackupAt < 24 * 3600000) return;
  try {
    const name = createBackup(householdId);
    pruneBackups();
    setSettings({ lastBackupAt: now }, householdId);
    if (!name) return; // quarantined: cadence still advances so we don't spin
    const lastNoticeAt = Number(s.lastBackupNoticeAt ?? 0);
    if (now - lastNoticeAt >= 7 * 86400000) {
      const owner = listMembers({ householdId }).find((m) => !m.archived && m.role === "Owner");
      addNotification({
        householdId, actorId: owner?.actorId ?? "m-owner", channel: "In-App",
        title: "Weekly backup ready",
        body: `Your household data is snapshotted nightly (${name}). Download a copy anytime from the web app's backups panel.`,
        to: null,
      });
      setSettings({ lastBackupNoticeAt: now }, householdId);
    }
  } catch (e) {
    appendAudit({ type: "backup.failed", ok: false, error: String(e?.message ?? e), householdId });
  }
}

// Kept so callers that still import it keep working; the resident tenant is no longer
// special-cased anywhere in this module.
export { CURRENT_TENANT };
