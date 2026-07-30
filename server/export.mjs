// Per-household data export — "give me everything you hold about my family".
//
// The backup machinery already produces a per-tenant bundle (backup.mjs, format 3) and an Owner
// can download it. That is a RESTORE artifact, not an export: it is gzipped, it is shaped for
// tenant-db's importer, and it contains the household's encrypted credentials because a restore
// needs them. Handing a family that file and calling it their data is technically true and
// practically useless — and shipping someone their own OAuth refresh tokens, even encrypted, is
// a liability nobody asked for.
//
// This is the other artifact: readable JSON, everything the household owns, credentials
// removed and SAID to be removed.
//
// Built by exporting the whole tenant and then redacting, rather than by listing the
// collections worth including. That direction matters. A hand-written include-list silently
// omits whatever gets added next year, and an export that quietly leaves things out is exactly
// the kind of small lie this codebase keeps finding. Everything is in unless it is a credential,
// and the manifest names what went.
import { tenantEngine, currentTenant, appendAudit } from "./store.mjs";

/** Files whose VALUES are credentials, not family data. */
const SECRET_FILES = new Set(["connectors.json"]);

/** Key names that hold a secret wherever they appear. */
const SECRET_KEY = /^(ownerPinHash|signingSecret|apiKey|accessToken|refreshToken|clientSecret|authToken|password|secret|token)$/i;

const REDACTED = "[redacted — credentials are not included in an export]";

/** Deep-redact secret-looking values, leaving structure and non-secret fields intact. */
function redact(value, keyName = "") {
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      // `secrets: { field: blob }` — redact the values, keep the field names, because knowing
      // WHICH credentials a household holds is part of what an export should tell them.
      out[k] = k === "secrets" && v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(Object.keys(v).map((f) => [f, REDACTED]))
        : redact(v, k);
    }
    return out;
  }
  if (typeof value === "string" && SECRET_KEY.test(keyName)) return REDACTED;
  return value;
}

/**
 * Everything this household owns, as a plain object.
 *
 * @returns {{ meta: object, data: object } | null} null when the tenant is unreadable
 *          (quarantined storage) — the caller must say so rather than ship an empty file.
 */
export function exportHousehold(householdId = currentTenant()) {
  const engine = tenantEngine();
  const files = engine.exportTenant(householdId);
  if (!files) return null;

  const data = {};
  const redactedFiles = [];
  for (const [name, value] of Object.entries(files)) {
    if (SECRET_FILES.has(name)) redactedFiles.push(name);
    data[name] = redact(value);
  }

  return {
    meta: {
      app: "familios",
      kind: "household-export",
      format: 1,
      householdId,
      at: new Date().toISOString(),
      collections: Object.keys(data).length,
      /* Say what is NOT here. An export that silently omits things is worse than one that
       * omits them out loud, because the reader has no way to know to ask. */
      excluded: [
        "Credentials — connector API keys, OAuth access and refresh tokens, signing secrets and the household PIN hash are redacted. They are not useful outside this server and shipping them would be a liability.",
        "File CONTENTS — this export carries each file's metadata (name, type, who added it, when). Download the files themselves from Files & Knowledge.",
      ],
      redactedFiles,
    },
    data,
    audit: [],
  };
}

/** The same thing, plus the audit log.
 *
 *  The log lives beside the database as JSONL rather than inside it, so exportTenant never sees
 *  it — and it is the one record saying what was done on the family's behalf and by whom, which
 *  makes it the most accountability-relevant thing in the export. Reading it needs filesystem
 *  access this module deliberately doesn't take, so the caller supplies the reader. */
export function exportHouseholdWithAudit(householdId, readAuditLines) {
  const base = exportHousehold(householdId);
  if (!base) return null;
  try {
    base.audit = readAuditLines(householdId) ?? [];
  } catch {
    // An unreadable audit log must not cost the family the rest of their export — but it also
    // must not silently look like "nothing ever happened".
    base.audit = [];
    base.meta.excluded.push("Activity log — it could not be read at export time.");
  }
  appendAudit({ type: "household.exported", collections: base.meta.collections, auditLines: base.audit.length, householdId });
  return base;
}
