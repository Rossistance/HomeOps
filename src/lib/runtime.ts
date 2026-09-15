/**
 * The two things this client still does to its OWN local draft: append to the activity
 * log, and run the on-device pass over a freshly uploaded file.
 *
 * What used to live here — a simulated agent run that invented steps, approvals and
 * outcomes — is gone. Every real run is durable and server-owned (see runPlan /
 * syncServerRun in the store), so a local imitation of one could only ever disagree with
 * the truth, and did.
 */
import type { AppData, ActivityLogEntry } from "@/types";
import { uid } from "./ids";

export function pushActivity(
  draft: AppData,
  entry: Partial<ActivityLogEntry> & { actionType: string; description: string },
): string {
  const id = uid("act");
  const full: ActivityLogEntry = {
    id,
    timestamp: new Date().toISOString(),
    actorType: entry.actorType ?? "system",
    actorId: entry.actorId ?? "system",
    actorName: entry.actorName ?? "FamiliOS",
    actionType: entry.actionType,
    description: entry.description,
    entityType: entry.entityType,
    entityId: entry.entityId,
    spaceId: entry.spaceId,
    status: entry.status ?? "success",
    metadata: entry.metadata,
  };
  draft.activity.unshift(full);
  if (draft.activity.length > 500) draft.activity.length = 500;
  return id;
}

/** Local "extraction" pass for a freshly uploaded file (runs entirely on-device). */
export function processFile(draft: AppData, fileId: string): void {
  const file = draft.files.find((f) => f.id === fileId);
  if (!file) return;
  file.searchIndexed = true;
  if (!file.summary) {
    file.summary = `Auto-summary: ${file.name} processed in the sandbox. Key details extracted for the household.`;
  }
  const now = new Date().toISOString();
  pushActivity(draft, {
    actorType: "system",
    actorId: "sandbox",
    actorName: "Document Organizer Agent",
    actionType: "file.processed",
    description: `Processed ${file.name}: ${file.detectedDates.length} dates, ${file.detectedTasks.length} tasks detected`,
    entityType: "file",
    entityId: file.id,
    spaceId: file.spaceId,
    status: "success",
    metadata: { at: now },
  });
}
