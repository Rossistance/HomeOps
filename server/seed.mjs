// FamiliOS AI — idempotent boot seed. Ensures the household has at least one real
// agent and one real, runnable hybrid skill so the canonical runtime has something
// to select and execute out of the box. The seeded skill uses only internal
// functions (+ a gated sign-off step), so it runs end-to-end with no external
// account — demonstrating the full approval→resume→execute→audit→memory loop.
import { listAgents, putAgent, listMembers, putMember, listContactMethods, putContactMethod, getSettings, setSettings, currentTenant } from "./store.mjs";

/** The household these seed records belong to — the one whose database they are being
 *  written INTO, which is what `currentTenant()` resolves to for every put* call below.
 *
 *  This was the literal string "local". Harmless while seeding only ever ran at boot with
 *  no tenant context (where currentTenant() IS "local" — identical behaviour), but it made
 *  a latent trap: several readers still carry a legacy `|| householdId === "local"` clause
 *  that treats a "local"-stamped record as shared, so a seed run inside a stranger's
 *  database would have written records that household could not own and other code might
 *  treat as everyone's. Stamping what we're actually writing to removes the trap without
 *  changing today's behaviour. */
const SEED_TENANT = () => currentTenant();

/* ============================================================== *
 * WP-004 (ISS-008, FEAT-019/005) — default "Family Chore Board" mini app for NEW
 * households, idempotent, never backfilled onto a household that already exists.
 *
 * Mini apps today are entirely CLIENT-owned (src/store/useStore.ts + the local
 * AppData in src/data/seed.ts) — there is no server-side mini-app collection, so
 * there is no row for this function to write. What IS server-owned and per-household
 * is `settings.json` (store.mjs getSettings/setSettings), so that is where the
 * decision "has this household already been given (or denied) its starter mini app"
 * is durably recorded — mirroring the existing SEED_MEMBERS/contact-methods pattern
 * of a canonical server-side definition kept in step with the client's copy
 * (MiniApps.tsx STARTER_TEMPLATES' "Family Chore Board" entry — same name/type/seed
 * columns) rather than a live round-trip API.
 *
 * DEFAULT_MINI_APP is the single source of truth for that starter definition.
 * seedDefaultMiniAppFlag(householdId) is idempotent per household: it returns true
 * (and stamps the marker) ONLY the first time it is asked about a given household,
 * and false forever after — so calling it twice, or calling it for a household that
 * pre-dates this feature, never re-decides or backfills anything.
 *
 * WIRING NOTE: nothing in this wave's granted surface calls this function for a real
 * signup. The one call site that should — POST /api/signup's NEW-household branch in
 * server/index.mjs, inside `await runWithTenant(householdId, () => { putMember(...);
 * setSettings(...); })` (around index.mjs:659-663) — lives outside this wave's
 * surface (server/seed.mjs "default mini-app provisioning only"; index.mjs itself is
 * not a granted surface this wave). See the WP-004 implementer report for the exact
 * one-line hookup: `seedDefaultMiniAppFlag(householdId);` right after that block.
 * ============================================================== */
export const DEFAULT_MINI_APP = {
  type: "Chore Board",
  name: "Family Chore Board",
  description: "Kanban of who's doing what — To Do → In Progress → Done.",
  data: { columns: [{ key: "todo", title: "To Do" }, { key: "in-progress", title: "In Progress" }, { key: "done", title: "Done" }, { key: "needs-help", title: "Needs Help" }] },
};

export function seedDefaultMiniAppFlag(householdId) {
  const s = getSettings(householdId);
  if (s.defaultMiniAppDecidedAt) return false; // already decided for this household — never re-touch
  setSettings({ defaultMiniAppDecidedAt: Date.now(), defaultMiniApp: DEFAULT_MINI_APP.type }, householdId);
  return true;
}

// Canonical household roster — the server-owned source of truth for each actor's
// role. Mirrors the frontend demo family (src/data/seed.ts) so the dev profile
// switcher keeps working, but here the role is authoritative: the session route
// resolves a session's role from this registry, never from the client.
const SEED_MEMBERS = [
  { actorId: "m-alex", displayName: "Alex Harper", role: "Owner", relationship: "Parent" },
  { actorId: "m-morgan", displayName: "Morgan Harper", role: "Adult Admin", relationship: "Parent" },
  { actorId: "m-lily", displayName: "Lily Harper", role: "Child View", relationship: "Child (age 9)" },
  { actorId: "m-noah", displayName: "Noah Harper", role: "Child View", relationship: "Child (age 6)" },
  { actorId: "m-elaine", displayName: "Elaine Brooks", role: "Guest/Helper", relationship: "Grandparent / caregiving contact" },
  { actorId: "m-sam", displayName: "Sam Rivera", role: "Guest/Helper", relationship: "Babysitter" },
];

export function seedDefaults() {
  const nowISO = new Date().toISOString();

  // Seed the household roster once (idempotent). Existing members are left as-is so a
  // server-side role change is never clobbered by a reboot.
  const haveMembers = new Set(listMembers().map((m) => m.actorId));
  for (const m of SEED_MEMBERS) {
    if (!haveMembers.has(m.actorId)) putMember({ ...m, householdId: SEED_TENANT() });
  }

  // Contact methods — the server-owned delivery registry. Same ids/state as the
  // frontend demo seed (src/data/seed.ts), so the web client's one-time migration
  // is a no-op for these and mobile sees the same registry. Idempotent by id;
  // household edits (verify, allowlists, deletes of OTHER methods) are never clobbered.
  // CONSENT IS NEVER SEEDED. These demo methods used to ship `verified: true,
  // optInStatus: "Opted In"`, which satisfied every fail-closed gate in notify.mjs
  // (verified → opted-in → per-agent allowlist) and in resolveSmsSender. On a seeded
  // install with Google connected, notify_contact to ct-alex-email would attempt a REAL
  // Gmail send to a reserved-TLD address nobody owns — and a seeded phone number counted
  // as a consenting SMS recipient for A2P purposes. Demo data may populate a roster; it
  // may not manufacture permission to contact anyone. Verification is a real round-trip
  // (a code to the address, entered back) and it stays that way for seeds too.
  const haveContacts = new Set(listContactMethods().map((c) => c.id));
  const activeMembers = new Set(listMembers().filter((m) => !m.archived).map((m) => m.actorId));
  for (const c of [
    { id: "ct-alex-email", memberId: "m-alex", label: "Primary email", type: "Email", value: "alex@harper.example", verified: false, optInStatus: "Pending" },
    { id: "ct-alex-text", memberId: "m-alex", label: "Mobile (text)", type: "Phone/Text", value: "(555) 010-2244", verified: false, optInStatus: "Pending" },
    { id: "ct-morgan-email", memberId: "m-morgan", label: "Primary email", type: "Email", value: "morgan@harper.example", verified: false, optInStatus: "Pending" },
    { id: "ct-elaine-text", memberId: "m-elaine", label: "Mobile (prefers text)", type: "Phone/Text", value: "(555) 018-7700", verified: false, optInStatus: "Pending" },
    { id: "ct-sam-text", memberId: "m-sam", label: "Mobile", type: "Phone/Text", value: "(555) 044-3311", verified: false, optInStatus: "Pending" },
  ]) {
    if (!haveContacts.has(c.id) && activeMembers.has(c.memberId)) {
      putContactMethod({ ...c, householdId: SEED_TENANT(), allowedAgentIds: [], createdBy: "system", createdAt: nowISO, updatedAt: nowISO });
    }
  }

  /* The household's own assistant — the identity chat acts as, and the record every other
   * helper is a copy of the shape of. Its allow-lists start EMPTY, which is the documented
   * permissive default (deny-only): the previous seed shipped a six-tool list scoped to one
   * briefing, which silently clamped ordinary chat the moment a run gained an identity. */
  if (!listAgents().some((a) => a.id === "agt_household")) {
    putAgent({
      id: "agt_household",
      householdId: SEED_TENANT(),
      name: "Famili",
      icon: "Bot",
      purpose: "The family's everyday assistant.",
      instructions: "Help with whatever the family asks: the calendar, tasks, meals, lists and reminders. Check what is already there before adding anything, and say plainly when something needs a person to approve it.",
      status: "Active",
      enabled: true,
      visibility: "household",
      schedule: { kind: "manual" },
      system: true,
      allowedToolIds: [], allowedFunctionIds: [], deniedToolIds: [], deniedFunctionIds: [],
      approvalPolicy: {},
      conversationId: null,
      lastRun: null,
      version: 1,
      createdAt: Date.now(),
      updatedAt: nowISO,
    });
  }

  // NOTHING ELSE IS SEEDED.
  //
  // This used to continue for another six hundred lines: two example "functions", nine
  // use-case skills with hand-written step graphs, two more agents that owned them, and
  // sixteen starter playbooks. Every one of those was a promise about what the app could
  // do, written months before the tools it named, and a family's first run was a library
  // of recipes that mostly could not execute against their actual connections.
  //
  // Starter helpers are OFFERED instead of installed — helperTemplates() in helpers.mjs
  // supplies them as editable instructions a family accepts, so what they end up with is
  // something they read and agreed to rather than something that appeared.
}
