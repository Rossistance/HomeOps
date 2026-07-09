import type { AppData } from "@/types";
import { SCHEMA_VERSION } from "./db";
import { defaultSettings } from "@/data/seed";

/** Serialize the entire household to a downloadable JSON backup. */
export function exportBackup(data: AppData): void {
  const payload = {
    app: "FamiliOS AI",
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `homeops-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export interface ImportResult {
  ok: boolean;
  data?: AppData;
  error?: string;
}

// Every collection AppData must carry; all must be arrays in a valid backup.
const REQUIRED_ARRAYS: (keyof AppData)[] = [
  "members", "contactMethods", "spaces", "agents", "automations", "runs", "subagentRuns",
  "threads", "messages", "files", "knowledge", "playbooks", "miniApps", "memories",
  "approvals", "activity", "events", "tasks",
];

/**
 * Parse and STRICTLY validate a JSON backup. Rejects malformed/partial files,
 * fills safe defaults for missing-but-optional bits, and migrates settings so a
 * valid import can never leave the app in a broken/half-populated state. The
 * caller only replaces live state when ok===true.
 */
export async function importBackup(file: File): Promise<ImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch (e) {
    return { ok: false, error: e instanceof Error ? `Invalid JSON: ${e.message}` : "Could not read file." };
  }
  const raw = (parsed && typeof parsed === "object" && "data" in (parsed as Record<string, unknown>)
    ? (parsed as { data: unknown }).data
    : parsed) as Partial<AppData> | undefined;

  if (!raw || typeof raw !== "object") return { ok: false, error: "This file does not contain FamiliOS data." };
  if (!raw.household || typeof raw.household !== "object" || !(raw.household as { id?: string }).id) {
    return { ok: false, error: "Backup is missing a valid household record." };
  }
  const missing = REQUIRED_ARRAYS.filter((k) => !Array.isArray((raw as Record<string, unknown>)[k]));
  if (missing.length) {
    return { ok: false, error: `Backup is incomplete or corrupt — missing collections: ${missing.join(", ")}.` };
  }
  if (!Array.isArray(raw.members) || raw.members.length === 0) {
    return { ok: false, error: "Backup must contain at least one household member." };
  }
  if (typeof raw.schemaVersion === "number" && raw.schemaVersion > SCHEMA_VERSION) {
    return { ok: false, error: `Backup is from a newer version (schema ${raw.schemaVersion}). Update FamiliOS before importing.` };
  }

  // Fill safe defaults / migrate so the imported state is internally complete.
  const data: AppData = {
    ...(raw as AppData),
    schemaVersion: SCHEMA_VERSION,
    seededAt: raw.seededAt ?? new Date().toISOString(),
    settings: { ...defaultSettings(), ...(raw.settings ?? {}) } as AppData["settings"],
  };
  return { ok: true, data };
}
