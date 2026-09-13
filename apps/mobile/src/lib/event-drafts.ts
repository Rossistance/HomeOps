// WP-103 slice 4 (ISS-123): an unsaved event draft lived only in component state, so
// dismissing the editor — or iOS reclaiming the app while it sat in the background —
// silently threw away everything typed. "Shouldn't it still be there? I think it should."
//
// Drafts now persist to disk, keyed per household + draft id (the event id when editing,
// "new" when creating), and are cleared ONLY by a successful save or an explicit discard.
// Dismissing keeps the draft, which is the whole point.
//
// Stored as JSON under the app's document directory via `expo-file-system/legacy` — the
// same entry point the upload paths already use on this SDK. SecureStore is the wrong
// home: it is for secrets and caps values far below what a notes field can hold.
import {
  documentDirectory, makeDirectoryAsync, readAsStringAsync, writeAsStringAsync,
  deleteAsync, getInfoAsync,
} from "expo-file-system/legacy";

/** Dates are stored as ISO strings; the form rehydrates them into Date objects. */
export interface EventDraft {
  title: string;
  location: string;
  notes: string;
  scheduled: boolean;
  allDay: boolean;
  hasEnd: boolean;
  day: string;
  start: string;
  end: string;
  endDay: string;
  driverId: string | null;
  bring: { item: string; memberId: string | null }[];
  bringInput: string;
  /** Minutes-before nudges. Optional: drafts written before events had reminders lack it. */
  remindOffsets?: number[];
  savedAt: string;
}

const DIR = documentDirectory ? `${documentDirectory}event-drafts/` : null;
// Ids come from the server (hh_… / ev_…), but a path is never built from unsanitized input.
const safe = (s: string) => String(s ?? "").replace(/[^A-Za-z0-9_-]/g, "_") || "_";
const fileFor = (householdId: string, draftId: string) =>
  (DIR ? `${DIR}${safe(householdId)}__${safe(draftId)}.json` : null);

async function ensureDir(): Promise<boolean> {
  if (!DIR) return false;
  try {
    const info = await getInfoAsync(DIR);
    if (!info.exists) await makeDirectoryAsync(DIR, { intermediates: true });
    return true;
  } catch { return false; }
}

/** Best-effort by design: a draft must never be able to break the editor. */
export async function saveDraft(householdId: string, draftId: string, draft: EventDraft): Promise<void> {
  const uri = fileFor(householdId, draftId);
  if (!uri) return;
  if (!(await ensureDir())) return;
  try { await writeAsStringAsync(uri, JSON.stringify(draft)); } catch { /* ignore */ }
}

export async function loadDraft(householdId: string, draftId: string): Promise<EventDraft | null> {
  const uri = fileFor(householdId, draftId);
  if (!uri) return null;
  try {
    const info = await getInfoAsync(uri);
    if (!info.exists) return null;
    const parsed = JSON.parse(await readAsStringAsync(uri)) as EventDraft;
    // Shape guard: a truncated/corrupt file must read as "no draft", never as a crash.
    return parsed && typeof parsed.title === "string" && typeof parsed.day === "string" ? parsed : null;
  } catch { return null; }
}

export async function clearDraft(householdId: string, draftId: string): Promise<void> {
  const uri = fileFor(householdId, draftId);
  if (!uri) return;
  try { await deleteAsync(uri, { idempotent: true }); } catch { /* already gone */ }
}

/** True when the draft still holds nothing worth restoring — an untouched blank editor
 * shouldn't leave a file behind, or every cancelled "+" would resurrect an empty form. */
export function isEmptyDraft(d: Pick<EventDraft, "title" | "location" | "notes" | "bring" | "bringInput">): boolean {
  return !d.title.trim() && !d.location.trim() && !d.notes.trim() && d.bring.length === 0 && !d.bringInput.trim();
}
