// FamiliOS — WP-007 s3: idempotent migration of existing tenant memory.json rows into the
// memory-provider (sqlite-FTS5 fallback, or a real sidecar if HOMEOPS_MEMORY_SIDECAR=1 —
// see server/memory-provider.mjs / DEC-014).
//
// DRY RUN BY DEFAULT — prints a row-count parity report and writes nothing. Pass --apply
// to actually migrate.
//
//   node server/scripts/migrate-memory-to-provider.mjs                 # dry run (default)
//   node server/scripts/migrate-memory-to-provider.mjs --apply         # actually migrate
//
// Idempotent: each row is written to the provider under a deterministic id
// (`sm_mem_<tenantMemoryId>`, the SAME scheme homeops.write_memory's dual-write uses — see
// internal-functions.mjs), so re-running --apply against the same tenant data never
// double-counts or duplicates a row; the provider's add() reports {deduped:true} for a row
// that's already there, and this script reports that distinctly from a genuinely new write.
//
// Data source — chosen to NEVER open a tenant .db file from a second OS process while a
// live server already owns it (see server/store.mjs's own NODE_TEST_CONTEXT guard for why
// that's dangerous — a past incident wedged a running backend's sqlite handle into
// permanent I/O errors):
//   - HOMEOPS_DATA_DIR set (isolated/test dir — nothing else has it open): reads directly
//     via store.mjs's listMemory(). This is the path server/test/memory-migration.test.mjs
//     exercises on a fixture tenant.
//   - HOMEOPS_DATA_DIR NOT set (the default — the real resident household, normally owned
//     by the already-running dev server on :8787): reads via that server's OWN HTTP API
//     (GET /api/profiles -> POST /api/session -> GET /api/memory). The live server process
//     remains the sole owner of the tenant db; this script is just an HTTP client, exactly
//     like the web app. If the resident Owner has a PIN set, this script cannot and will
//     not try to guess it — it aborts with clear instructions instead.
import { memoryProvider } from "../memory-provider.mjs";

// Computed at call time (not module load time) so tests can toggle process.argv between
// calls to main() without re-importing the module.
const isApply = () => process.argv.includes("--apply");
const argValue = (name) => {
  const pfx = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pfx));
  return hit ? hit.slice(pfx.length) : undefined;
};
const SERVER_URL = argValue("server") ?? process.env.HOMEOPS_SERVER_URL ?? "http://localhost:8787";
const ORIGIN = argValue("origin") ?? process.env.HOMEOPS_ORIGIN ?? "http://localhost:5173";
const ACTOR = argValue("actor") ?? process.env.HOMEOPS_MIGRATE_ACTOR;
const PIN = argValue("pin") ?? process.env.HOMEOPS_MIGRATE_PIN;

/** Read source memory rows directly from store.mjs (only safe with an isolated HOMEOPS_DATA_DIR). */
async function readViaStore() {
  const { listMemory } = await import("../store.mjs");
  const rows = listMemory({ limit: 100_000 }); // every household in this isolated dir
  return { ok: true, rows, source: "store" };
}

/** Read source memory rows via the already-running server's own HTTP API. */
async function readViaHttp() {
  const profilesRes = await fetch(`${SERVER_URL}/api/profiles`, { headers: { Origin: ORIGIN } });
  if (!profilesRes.ok) return { ok: false, reason: `GET /api/profiles failed (${profilesRes.status}) — is the dev server running at ${SERVER_URL}?` };
  const profilesBody = await profilesRes.json();
  const profiles = profilesBody?.profiles ?? [];
  if (!profiles.length) return { ok: false, reason: "no household members found via /api/profiles" };
  const candidate = ACTOR ? profiles.find((p) => p.actorId === ACTOR) : (profiles.find((p) => p.role === "Owner") ?? profiles[0]);
  if (!candidate) return { ok: false, reason: `actor "${ACTOR}" not found in /api/profiles` };
  if (candidate.pinRequired && !PIN) {
    return {
      ok: false,
      reason: `actor "${candidate.actorId}" (${candidate.role}) requires an Owner PIN to sign in, and none was provided. ` +
        `Re-run with --pin=<the Owner PIN> or HOMEOPS_MIGRATE_PIN=<pin> — this script will not guess it.`,
    };
  }
  const sessionRes = await fetch(`${SERVER_URL}/api/session`, {
    method: "POST",
    headers: { Origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ actorId: candidate.actorId, actorName: candidate.displayName, ...(PIN ? { pin: PIN } : {}) }),
  });
  if (!sessionRes.ok) return { ok: false, reason: `POST /api/session failed (${sessionRes.status}) for actor "${candidate.actorId}"` };
  const setCookie = sessionRes.headers.get("set-cookie") || "";
  const cookie = setCookie.split(";")[0];
  if (!cookie) return { ok: false, reason: "session created but no cookie was returned" };

  const memRes = await fetch(`${SERVER_URL}/api/memory`, { headers: { Origin: ORIGIN, Cookie: cookie } });
  if (!memRes.ok) return { ok: false, reason: `GET /api/memory failed (${memRes.status})` };
  const memBody = await memRes.json();
  const rows = (memBody?.memory ?? []).map((m) => ({ ...m, householdId: m.householdId ?? "local" }));
  return {
    ok: true,
    rows,
    source: "http",
    note:
      rows.length && candidate.role !== "Owner"
        ? `read as "${candidate.actorId}" (${candidate.role}) — personal-scoped memory belonging to OTHER actors is excluded by /api/memory's own visibility rule, not by this script.`
        : undefined,
  };
}

async function main() {
  const APPLY = isApply();
  const usingIsolatedDir = !!process.env.HOMEOPS_DATA_DIR;
  const read = usingIsolatedDir ? await readViaStore() : await readViaHttp();
  if (!read.ok) {
    console.error(`[migrate-memory] could not read source memory: ${read.reason}`);
    process.exitCode = 1;
    return;
  }
  if (read.note) console.log(`[migrate-memory] note: ${read.note}`);

  const byHousehold = new Map();
  for (const row of read.rows) {
    const hh = row.householdId ?? "local";
    if (!byHousehold.has(hh)) byHousehold.set(hh, []);
    byHousehold.get(hh).push(row);
  }

  // ---- Parity report (ALWAYS printed first, before any write — even in --apply mode) ----
  console.log(`[migrate-memory] source: ${read.source}${usingIsolatedDir ? ` (HOMEOPS_DATA_DIR=${process.env.HOMEOPS_DATA_DIR})` : ` (${SERVER_URL})`}`);
  console.log(`[migrate-memory] mode: ${APPLY ? "APPLY (will write)" : "DRY RUN (no writes)"}`);
  console.log(`[migrate-memory] households found: ${byHousehold.size}, total tenant memory rows: ${read.rows.length}`);
  for (const [hh, rows] of byHousehold) {
    console.log(`  - household "${hh}": ${rows.length} row(s)`);
  }

  if (!APPLY) {
    console.log("[migrate-memory] dry run complete — nothing was written. Re-run with --apply to migrate.");
    return { byHousehold, applied: false };
  }

  // ---- Apply: idempotent writes, deterministic id per tenant row ----
  const outcome = { written: 0, deduped: 0, failed: 0, byHousehold: {} };
  for (const [hh, rows] of byHousehold) {
    const hhOutcome = { written: 0, deduped: 0, failed: 0 };
    for (const row of rows) {
      const text = String(row.text ?? "").trim();
      if (!text) { hhOutcome.failed++; continue; }
      const r = await memoryProvider.add(text, { containerTag: hh, scope: row.scope, type: row.type, sourceActorId: row.source?.actorId, id: `sm_mem_${row.id}` });
      if (!r.ok) hhOutcome.failed++;
      else if (r.deduped) hhOutcome.deduped++;
      else hhOutcome.written++;
    }
    outcome.byHousehold[hh] = hhOutcome;
    outcome.written += hhOutcome.written;
    outcome.deduped += hhOutcome.deduped;
    outcome.failed += hhOutcome.failed;
    console.log(`  - household "${hh}": written=${hhOutcome.written} deduped(already present)=${hhOutcome.deduped} failed=${hhOutcome.failed}`);
  }
  console.log(`[migrate-memory] apply complete: written=${outcome.written} deduped=${outcome.deduped} failed=${outcome.failed}`);
  return { byHousehold, applied: true, outcome };
}

export { main, readViaStore, readViaHttp };

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("migrate-memory-to-provider.mjs");
if (isMain) {
  main().catch((e) => {
    console.error(`[migrate-memory] unexpected error: ${e?.stack ?? e}`);
    process.exitCode = 1;
  });
}
