// The native memory delete (ADR-004 Stage 1): famili.delete_memory. Anything the assistant
// can plant it must be able to pull (see ./meals.mjs) — under the same rule as the API's
// DELETE /api/memory, writing the same audit row. The body is the one that lived inline in
// assistant-agent.mjs nativeTools(), moved unchanged.
import { getMemoryEntry, deleteMemoryEntry, appendAudit } from "../../store.mjs";
import { canForgetMemory } from "../../nests.mjs";
import { defineAction } from "../define-action.mjs";
import { short, readOnly, nativeScope, always } from "./shared.mjs";

export const familiDeleteMemory = defineAction({
  id: "famili.delete_memory",
  name: "Forget a remembered fact",
  description: "Delete one entry from family memory — something remembered wrongly, or a test note. Search memory first to get its id. A personal memory can only be forgotten by the person it belongs to; to anyone else it does not exist.",
  action: "Write", risk: "Medium", requiresApproval: false, delivers: false, lane: "native", timeoutMs: 60_000, available: always,
  input: { type: "object", properties: { memoryId: { type: "string", description: "The memory entry's id, from famili__search_memory." } }, required: ["memoryId"], additionalProperties: false },
  output: {
    type: "object",
    properties: { deleted: { type: "boolean" }, text: { type: "string" } },
    required: ["deleted", "text"], additionalProperties: false,
  },
  errorCodes: ["invalid_input", "read_only_profile", "memory_not_found"],
  async run(ctx, input) {
    const { session, hh, channel, canWrite } = nativeScope(ctx);
    if (!canWrite) return readOnly();
    // Either spelling of the id is accepted — the store's, or the provider's prefixed copy.
    const m = getMemoryEntry(String(input?.memoryId ?? "").replace(/^sm_mem_/, ""));
    // EXACTLY the API's DELETE rule (nests.mjs canForgetMemory): what this person cannot
    // read does not exist for them — except an orphaned personal memory, which an adult may clear.
    // And in the group thread only a HOUSEHOLD memory exists at all — a personal one is not
    // there even for its owner, and a nest's is not there even for its members (the tasks and
    // events of a nest are hidden there the same way, canSeeEntityInChannel) — so its text never
    // echoes into a thread people outside the household read. famili.search_memory keeps the
    // same rule there. Elsewhere unchanged. (ADR-004 decision C.)
    if (!m || m.householdId !== hh || !canForgetMemory(m, session) || (channel === "group" && m.scope !== "household")) return { ok: false, error: "memory_not_found", message: "No such memory entry — search memory to find the right id." };
    deleteMemoryEntry(m.id);
    appendAudit({ type: "memory.delete", memoryId: m.id, via: "assistant", householdId: hh, actorId: session.actorId });
    return { ok: true, result: { deleted: true, text: short(m.text ?? "", 80) } };
  },
});
