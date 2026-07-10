// FamiliOS — household data backups. Nightly gzipped bundle per household,
// exported from the tenant database back into the human-readable JSON shape
// (format 2: { meta, tenants: { <id>: { files, audit } } }), 30-day retention,
// Owner-only list/download/restore. Weekly the Owner gets a "backup ready"
// notification. Format-1 bundles (the JSON-file era) restore transparently.
import fs from "node:fs";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { getSettings, setSettings, appendAudit, addNotification, listMembers, tenantEngine, CURRENT_TENANT } from "./store.mjs";

const DATA_DIR = process.env.HOMEOPS_DATA_DIR || join(process.cwd(), "server", ".data");
const BACKUP_DIR = join(DATA_DIR, "backups");
const RETENTION_DAYS = 30;

function backupName(d = new Date()) {
  return `familios-backup-${d.toISOString().slice(0, 10)}.json.gz`;
}

/** Snapshot every household: full tenant export + its audit log. */
export function createBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const engine = tenantEngine();
  const tenants = {};
  const ids = new Set([CURRENT_TENANT, ...engine.tenantIds()]);
  for (const t of ids) {
    // One broken household must never abort the snapshot of every other one.
    try {
      const files = engine.exportTenant(t);
      if (!files) continue; // quarantined tenant: nothing readable to snapshot
      const auditPath = engine.tenantPath(t, "audit.jsonl");
      const audit = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, "utf8") : "";
      tenants[t] = { files, audit };
    } catch (e) {
      appendAudit({ type: "backup.tenant_failed", tenant: t, error: String(e?.message ?? e) });
    }
  }
  const count = Object.values(tenants).reduce((n, t) => n + Object.keys(t.files).length, 0);
  const bundle = { meta: { at: new Date().toISOString(), app: "familios", format: 2, count, tenants: Object.keys(tenants) }, tenants };
  const name = backupName();
  fs.writeFileSync(join(BACKUP_DIR, name), gzipSync(JSON.stringify(bundle)));
  appendAudit({ type: "backup.created", name, files: count });
  return name;
}

export function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .filter((f) => f.endsWith(".json.gz"))
    .map((f) => ({ name: f, sizeBytes: fs.statSync(join(BACKUP_DIR, f)).size, at: fs.statSync(join(BACKUP_DIR, f)).mtime.toISOString() }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

export function readBackup(name) {
  if (!/^familios-backup-[\d-]+\.json\.gz$/.test(name)) return null; // no traversal
  const p = join(BACKUP_DIR, name);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p);
}

/** Restore: verify the whole bundle first, then import atomically per tenant. */
export function restoreBackup(name) {
  const raw = readBackup(name);
  if (!raw) return { ok: false, error: "not_found" };
  let bundle;
  try { bundle = JSON.parse(gunzipSync(raw).toString("utf8")); } catch { return { ok: false, error: "corrupt_backup" }; }
  const engine = tenantEngine();

  if (bundle?.meta?.format === 2 && bundle.tenants) {
    let count = 0;
    for (const [t, data] of Object.entries(bundle.tenants)) {
      if (!data || typeof data.files !== "object") return { ok: false, error: "bad_format", tenant: t };
      count += Object.keys(data.files).length;
    }
    for (const [t, data] of Object.entries(bundle.tenants)) {
      engine.importTenant(t, data.files); // single transaction per tenant
      if (typeof data.audit === "string" && data.audit.length) {
        fs.writeFileSync(engine.tenantPath(t, "audit.jsonl"), data.audit);
      }
    }
    appendAudit({ type: "backup.restored", name, files: count });
    return { ok: true, files: count, note: "Restart the server so all collections reload." };
  }

  if (bundle?.meta?.format === 1 && bundle.files) {
    // Legacy JSON-file-era bundle: parse-verify everything, then import into the
    // current household's tenant db (audit.jsonl goes back beside it).
    const files = {};
    for (const [f, content] of Object.entries(bundle.files)) {
      if (f.endsWith(".json")) {
        try { files[f] = JSON.parse(content); } catch { return { ok: false, error: "invalid_file", file: f }; }
      }
    }
    engine.importTenant(CURRENT_TENANT, files);
    if (typeof bundle.files["audit.jsonl"] === "string") {
      fs.writeFileSync(engine.tenantPath(CURRENT_TENANT, "audit.jsonl"), bundle.files["audit.jsonl"]);
    }
    appendAudit({ type: "backup.restored", name, files: Object.keys(files).length, legacyFormat: 1 });
    return { ok: true, files: Object.keys(files).length, note: "Restart the server so all collections reload." };
  }

  return { ok: false, error: "bad_format" };
}

export function pruneBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return 0;
  const cutoff = Date.now() - RETENTION_DAYS * 86400000;
  let pruned = 0;
  for (const f of fs.readdirSync(BACKUP_DIR)) {
    const p = join(BACKUP_DIR, f);
    if (f.endsWith(".json.gz") && fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); pruned++; }
  }
  return pruned;
}

/** Called from the periodic sweep: nightly snapshot + weekly Owner notice. */
export async function backupTick() {
  // Backup cadence bookkeeping lives on the resident household's settings; the
  // snapshot itself covers every tenant. Per-tenant cadence comes with C1.6.
  const s = getSettings(CURRENT_TENANT);
  const now = Date.now();
  const lastBackupAt = Number(s.lastBackupAt ?? 0);
  if (now - lastBackupAt < 24 * 3600000) return;
  try {
    const name = createBackup();
    pruneBackups();
    setSettings({ lastBackupAt: now }, CURRENT_TENANT);
    const lastNoticeAt = Number(s.lastBackupNoticeAt ?? 0);
    if (now - lastNoticeAt >= 7 * 86400000) {
      const owner = listMembers({ householdId: "local" }).find((m) => !m.archived && m.role === "Owner");
      addNotification({
        householdId: "local", actorId: owner?.actorId ?? "m-owner", channel: "In-App",
        title: "Weekly backup ready",
        body: `Your household data is snapshotted nightly (${name}). Download a copy anytime from the web app's backups panel.`,
        to: null,
      });
      setSettings({ lastBackupNoticeAt: now }, CURRENT_TENANT);
    }
  } catch (e) {
    appendAudit({ type: "backup.failed", ok: false, error: String(e?.message ?? e) });
  }
}
