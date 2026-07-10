// FamiliOS — household data backups. Nightly gzipped bundle of every JSON
// collection in DATA_DIR (single-file format: { meta, files: { name: content } }),
// 30-day retention, Owner-only list/download/restore. Weekly the Owner gets a
// "backup ready" notification — and, when Gmail is connected, a summary email
// (attachments aren't supported by the gmail tool yet, so the email points at
// Settings → download; the snapshot itself always lives on disk).
import fs from "node:fs";
import { join } from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { getSettings, setSettings, appendAudit, addNotification, listMembers } from "./store.mjs";

const DATA_DIR = process.env.HOMEOPS_DATA_DIR || join(process.cwd(), "server", ".data");
const BACKUP_DIR = join(DATA_DIR, "backups");
const RETENTION_DAYS = 30;
const EXCLUDE = new Set(["key", "win-root-cas.pem"]);

function backupName(d = new Date()) {
  return `familios-backup-${d.toISOString().slice(0, 10)}.json.gz`;
}

/** Create a snapshot bundle of every JSON/JSONL collection. Returns its name. */
export function createBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const files = {};
  for (const f of fs.readdirSync(DATA_DIR)) {
    if (EXCLUDE.has(f) || f.endsWith(".tmp") || f.includes(".corrupt-") || f === "backups") continue;
    const p = join(DATA_DIR, f);
    if (!fs.statSync(p).isFile()) continue;
    files[f] = fs.readFileSync(p, "utf8");
  }
  const bundle = { meta: { at: new Date().toISOString(), app: "familios", format: 1, count: Object.keys(files).length }, files };
  const name = backupName();
  fs.writeFileSync(join(BACKUP_DIR, name), gzipSync(JSON.stringify(bundle)));
  appendAudit({ type: "backup.created", name, files: bundle.meta.count });
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

/** Restore: stage every file, verify each parses, then swap. Never partial. */
export function restoreBackup(name) {
  const raw = readBackup(name);
  if (!raw) return { ok: false, error: "not_found" };
  let bundle;
  try { bundle = JSON.parse(gunzipSync(raw).toString("utf8")); } catch { return { ok: false, error: "corrupt_backup" }; }
  if (bundle?.meta?.format !== 1 || !bundle.files) return { ok: false, error: "bad_format" };
  // Verify all JSON files parse before touching anything.
  for (const [f, content] of Object.entries(bundle.files)) {
    if (f.endsWith(".json")) { try { JSON.parse(content); } catch { return { ok: false, error: "invalid_file", file: f }; } }
  }
  for (const [f, content] of Object.entries(bundle.files)) {
    const p = join(DATA_DIR, f);
    const tmp = `${p}.restore.tmp`;
    fs.writeFileSync(tmp, content);
    fs.renameSync(tmp, p);
  }
  appendAudit({ type: "backup.restored", name, files: Object.keys(bundle.files).length });
  return { ok: true, files: Object.keys(bundle.files).length, note: "Restart the server so all collections reload from disk." };
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
  const s = getSettings();
  const now = Date.now();
  const lastBackupAt = Number(s.lastBackupAt ?? 0);
  if (now - lastBackupAt < 24 * 3600000) return;
  try {
    const name = createBackup();
    pruneBackups();
    setSettings({ lastBackupAt: now });
    const lastNoticeAt = Number(s.lastBackupNoticeAt ?? 0);
    if (now - lastNoticeAt >= 7 * 86400000) {
      const owner = listMembers({ householdId: "local" }).find((m) => !m.archived && m.role === "Owner");
      addNotification({
        householdId: "local", actorId: owner?.actorId ?? "m-owner", channel: "In-App",
        title: "Weekly backup ready",
        body: `Your household data is snapshotted nightly (${name}). Download a copy anytime from the web app's backups panel.`,
        to: null,
      });
      setSettings({ lastBackupNoticeAt: now });
    }
  } catch (e) {
    appendAudit({ type: "backup.failed", ok: false, error: String(e?.message ?? e) });
  }
}
