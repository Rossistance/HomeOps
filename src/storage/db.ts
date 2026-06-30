import { openDB, type IDBPDatabase } from "idb";
import type { AppData } from "@/types";

/**
 * Storage layer.
 *
 * Primary: IndexedDB (a single keyed blob holding normalized AppData — robust
 * for a local-first app and trivial to export/import).
 * Fallback: localStorage, used automatically if IndexedDB is unavailable.
 *
 * The store calls load/save here; failures bubble up as a typed result so the
 * UI can show a clear storage-error banner instead of silently losing data.
 */

export const SCHEMA_VERSION = 1;
const DB_NAME = "homeops-ai";
const STORE = "appdata";
const KEY = "main";
const LS_KEY = "homeops-ai:appdata";
const LS_SETTINGS_KEY = "homeops-ai:settings";

let dbPromise: Promise<IDBPDatabase> | null = null;
let usingFallback = false;

export type StorageMode = "indexeddb" | "localstorage" | "unavailable";

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, SCHEMA_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      },
    });
  }
  return dbPromise;
}

export async function detectStorageMode(): Promise<StorageMode> {
  if (typeof indexedDB !== "undefined") {
    try {
      await getDB();
      usingFallback = false;
      return "indexeddb";
    } catch {
      /* fall through */
    }
  }
  try {
    localStorage.setItem("homeops-ai:probe", "1");
    localStorage.removeItem("homeops-ai:probe");
    usingFallback = true;
    return "localstorage";
  } catch {
    return "unavailable";
  }
}

export async function loadAppData(): Promise<AppData | null> {
  // Try IndexedDB first.
  if (typeof indexedDB !== "undefined" && !usingFallback) {
    try {
      const db = await getDB();
      const data = (await db.get(STORE, KEY)) as AppData | undefined;
      if (data) return data;
    } catch {
      usingFallback = true;
    }
  }
  // localStorage fallback.
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as AppData;
  } catch {
    /* ignore */
  }
  return null;
}

export async function saveAppData(data: AppData): Promise<void> {
  let savedToIDB = false;
  if (typeof indexedDB !== "undefined" && !usingFallback) {
    try {
      const db = await getDB();
      await db.put(STORE, data, KEY);
      savedToIDB = true;
    } catch {
      usingFallback = true;
    }
  }
  // Always mirror small settings to localStorage; mirror full data only when
  // IndexedDB is unavailable (avoids large dupes when IDB works).
  try {
    localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(data.settings));
    if (!savedToIDB) {
      localStorage.setItem(LS_KEY, JSON.stringify(data));
    }
  } catch {
    if (!savedToIDB) throw new Error("Storage unavailable: data could not be saved.");
  }
}

export async function clearAppData(): Promise<void> {
  if (typeof indexedDB !== "undefined") {
    try {
      const db = await getDB();
      await db.delete(STORE, KEY);
    } catch {
      /* ignore */
    }
  }
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
}
