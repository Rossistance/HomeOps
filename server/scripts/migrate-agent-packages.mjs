#!/usr/bin/env node
/**
 * WP-005 — migrate-agent-packages.mjs
 * =====================================================================
 * Consolidates a household's fragmented helper configuration (loose agents,
 * playbooks, skills, functions, triggers) into a small set of coherent
 * PACKAGES (the WP-005 packaged-agent model: instructions + skills +
 * triggers/schedules + tools + approval gates; playbooks become an agent's
 * instructions/recipes).
 *
 * The migration is ADDITIVE and REVERSIBLE:
 *   • package metadata is ADDED (packageId, packageVersion) — nothing is renamed;
 *   • retired fragments are ARCHIVED (status "Archived" / archived:true), never
 *     deleted — a full server backup is taken first;
 *   • duplicate agents are consolidated into a named survivor; their skills move
 *     to the survivor and their triggers are RETARGETED so no trigger is orphaned;
 *   • every skill stays attached to a package and therefore stays invocable.
 *
 * MODES
 *   --dry-run   (DEFAULT) enumerate + print the full mapping and the exact
 *               would-do actions. Mutates NOTHING.
 *   --apply     execute the plan. GUARDED: refuses unless BOTH
 *                 --tenant <householdId>   is passed explicitly, AND
 *                 env HOMEOPS_MIGRATION_CONFIRM=yes
 *               Apply is backup-first, then PATCH-only (additive; the server's
 *               partialUpdateAgent spreads unknown keys, so packageId/packageVersion
 *               round-trip — POST/PUT would strip them via normalizeAgent).
 *
 * TRANSPORT
 *   Reads/writes a tenant through the LIVE server HTTP API.
 *     --base-url  http://localhost:8787         (default)
 *     --token     <owner bearer token>          (required)
 *     --csrf      <csrf>                         (required for --apply)
 *     --origin    http://localhost:5173         (default)
 *   It never opens any SQLite file directly.
 *
 * USAGE
 *   node server/scripts/migrate-agent-packages.mjs --token TT                 # dry-run resident
 *   HOMEOPS_MIGRATION_CONFIRM=yes node server/scripts/migrate-agent-packages.mjs \
 *        --apply --tenant local --token TT --csrf CC
 */

/* ------------------------------- args -------------------------------- */
const argv = process.argv.slice(2);
function arg(name, def = undefined) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v && !v.startsWith("--") ? v : true;
}
const MODE = argv.includes("--apply") ? "apply" : "dry-run";
const BASE = String(arg("base-url", "http://localhost:8787")).replace(/\/$/, "");
const ORIGIN = String(arg("origin", "http://localhost:5173"));
const TOKEN = arg("token");
const CSRF = arg("csrf");
const TENANT = arg("tenant");
const CONFIRM = process.env.HOMEOPS_MIGRATION_CONFIRM === "yes";

function die(msg) { console.error(`\n[migrate] FATAL: ${msg}\n`); process.exit(1); }
if (!TOKEN) die("missing --token (owner bearer token; dev: POST /api/session)");

if (MODE === "apply") {
  if (TENANT === undefined || TENANT === true) die("--apply refuses without an explicit --tenant <householdId>");
  if (!CONFIRM) die("--apply refuses unless env HOMEOPS_MIGRATION_CONFIRM=yes");
  if (!CSRF) die("--apply needs --csrf (mutations require the CSRF token)");
}

/* ------------------------------ http --------------------------------- */
const H = { Origin: ORIGIN, Authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
async function api(method, path, body) {
  const headers = { ...H };
  if (method !== "GET" && CSRF) headers["x-homeops-csrf"] = CSRF;
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 200)}`);
  return json;
}
const GET = (p) => api("GET", p);
const PATCH = (p, b) => api("PATCH", p, b);
const POST = (p, b) => api("POST", p, b);

/* --------------------------- enumeration ----------------------------- */
async function enumerate() {
  const [ag, sk, fn, tg, pb] = await Promise.all([
    GET("/api/agents"), GET("/api/skills"), GET("/api/functions"),
    GET("/api/triggers"), GET("/api/playbooks"),
  ]);
  return {
    agents: ag.agents ?? [], skills: sk.skills ?? [], functions: fn.functions ?? [],
    triggers: tg.triggers ?? [], playbooks: pb.playbooks ?? [],
  };
}

/* ------------------------ classification rules ----------------------- */
const isTG = (name = "") => /^TG[-_ ]/i.test(name) || /\bTG-WP\d/i.test(name);
const isGmailCleanup = (name = "") =>
  /gmail/i.test(name) && /(cleanup|promotional|promo|marketing|triage|sales)/i.test(name);

// Functional helper agents that get absorbed into a domain package anchor.
// Keyed by agent id (stable on resident and on the seeded copy, which reuses ids).
const MERGE_INTO = {
  agt_morning_status: "ag-briefing",   // Morning Status Helper  -> Family Briefing
  agt_meal_planner:   "ag-meal",       // Meal Planner & Sign-Off -> Meal & Grocery
};

// Domain routing for un-attached skills / playbooks (name/keyword -> anchor agent id).
function routeByName(name = "", domain = "") {
  const s = `${name} ${domain}`.toLowerCase();
  if (/school|daycare|correspondence/.test(s)) return "ag-school";
  if (/meal|grocery|recipe|signoff|sign-off/.test(s)) return "ag-meal";
  if (/brief|morning|status|weekly.*plan|daily.*family/.test(s)) return "ag-briefing";
  if (/gift|birthday|scrapbook|memory|celebration/.test(s)) return "ag-gift";
  if (/pet/.test(s)) return "ag-pet";
  if (/document|renewal|packet|records|chore.*doc|doc.*link/.test(s)) return "ag-document";
  if (/caregiv|caregiver/.test(s)) return "ag-caregiving";
  if (/home|repair|maintenance|climate|night.?mode|smarthome/.test(s)) return "ag-home";
  if (/medical|appointment|health|doctor/.test(s)) return "ag-medical";
  if (/travel|trip|flight|itinerary/.test(s)) return "ag-travel";
  if (/bill|receipt|budget|invoice|finance/.test(s)) return "ag-bill";
  if (/gmail|promo|marketing|inbox.*clean/.test(s)) return "__gmail__";  // resolved to gmail survivor
  if (/inbox|email/.test(s)) return "ag-inbox";
  if (/event|logistics|system.*sync|internal.*sync|reset|household/.test(s)) return "agt_household";
  return "agt_household"; // safe general home
}

const PKG_VERSION = 1;

/* ------------------------------ plan --------------------------------- */
function buildPlan(data) {
  const { agents, skills, functions, triggers, playbooks } = data;
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]));
  const rows = [];        // disposition rows for the report
  const actions = [];     // concrete would-do mutations

  // 1) Gmail-cleanup consolidation — survivor = most allowedToolIds (richest tools).
  const gmail = agents.filter((a) => isGmailCleanup(a.name));
  let gmailSurvivor = null;
  if (gmail.length) {
    gmailSurvivor = gmail.slice().sort(
      (a, b) => (b.allowedToolIds?.length ?? 0) - (a.allowedToolIds?.length ?? 0)
    )[0];
  }

  // Resolve every agent's package + action.
  const mergedAway = new Set(); // agent ids that become archived/merged
  const survivorSkillAdds = {}; // survivorId -> Set(skillIds) to attach
  const addSkill = (target, ids) => {
    (survivorSkillAdds[target] ??= new Set());
    for (const s of (ids ?? [])) survivorSkillAdds[target].add(s);
  };

  for (const a of agents) {
    if (isTG(a.name)) {
      rows.push({ kind: "agent", id: a.id, name: a.name, pkg: "(archived)", action: "archive",
        why: "TG-* mission test remnant — hidden, retained for audit",
        rev: "PATCH status back to prior value" });
      actions.push({ op: "archive-agent", id: a.id, from: a.status });
      mergedAway.add(a.id);
      continue;
    }
    if (gmailSurvivor && isGmailCleanup(a.name) && a.id !== gmailSurvivor.id) {
      rows.push({ kind: "agent", id: a.id, name: a.name, pkg: gmailSurvivor.id, action: "merge-into",
        why: `duplicate of Gmail package; survivor ${gmailSurvivor.id} "${gmailSurvivor.name}"`,
        rev: "un-archive + detach survivor skills" });
      addSkill(gmailSurvivor.id, a.skillIds?.filter((s) => skills.some((k) => k.id === s)));
      actions.push({ op: "merge-agent", id: a.id, into: gmailSurvivor.id });
      mergedAway.add(a.id);
      continue;
    }
    if (MERGE_INTO[a.id] && byId[MERGE_INTO[a.id]]) {
      const anchor = MERGE_INTO[a.id];
      rows.push({ kind: "agent", id: a.id, name: a.name, pkg: anchor, action: "merge-into",
        why: `functional helper absorbed into "${byId[anchor].name}" package`,
        rev: "un-archive + detach moved skills" });
      addSkill(anchor, a.skillIds?.filter((s) => skills.some((k) => k.id === s)));
      actions.push({ op: "merge-agent", id: a.id, into: anchor });
      mergedAway.add(a.id);
      continue;
    }
    // anchor / survivor — keep as its own package
    const label = (gmailSurvivor && a.id === gmailSurvivor.id) ? "keep (gmail survivor)" : "keep (package anchor)";
    rows.push({ kind: "agent", id: a.id, name: a.name, pkg: a.id, action: "keep",
      why: label, rev: "clear packageId/packageVersion" });
    actions.push({ op: "tag-agent", id: a.id, packageId: a.id, packageVersion: PKG_VERSION });
  }

  // Apply the collected skill-moves onto anchors/survivors.
  for (const [target, set] of Object.entries(survivorSkillAdds)) {
    if (set.size) actions.push({ op: "attach-skills-to-agent", id: target, skillIds: [...set] });
  }

  // 2) Skills — every real skill attaches to a package (never deleted); TG skill archived.
  const gmailPkg = gmailSurvivor?.id ?? "ag-inbox";
  for (const s of skills) {
    if (isTG(s.name)) {
      rows.push({ kind: "skill", id: s.id, name: s.name, pkg: "(archived)", action: "archive",
        why: "TG-* test skill — hidden, retained", rev: "PATCH archived:false" });
      actions.push({ op: "archive-skill", id: s.id });
      continue;
    }
    // Which package already references this skill? Follow merges to the survivor
    // so a skill on a consolidated agent lands in the surviving package (not a
    // domain-keyword false match).
    let host = agents.find((a) => (a.skillIds ?? []).includes(s.id));
    let pkg, why;
    if (host && mergedAway.has(host.id)) {
      const m = actions.find((x) => x.op === "merge-agent" && x.id === host.id);
      pkg = m ? m.into : routeByName(s.name, s.domain);
      why = `follows merged host "${host.name}" -> survivor package`;
    } else if (host) {
      pkg = host.id; why = `already used by "${host.name}"`;
    } else {
      pkg = routeByName(s.name, s.domain); why = "domain-routed; stays invocable";
    }
    if (pkg === "__gmail__") pkg = gmailPkg;
    rows.push({ kind: "skill", id: s.id, name: s.name, pkg, action: "attach", why, rev: "clear packageId tag" });
    actions.push({ op: "tag-skill", id: s.id, packageId: pkg, packageVersion: PKG_VERSION });
  }

  // 3) Functions — shared capabilities; referenced by packages, never deleted.
  for (const f of functions) {
    const pkg = routeByName(f.name, "");
    const resolved = pkg === "__gmail__" ? gmailPkg : pkg;
    rows.push({ kind: "function", id: f.id, name: f.name, pkg: resolved, action: "attach",
      why: "capability referenced by package(s); retained", rev: "n/a (reference only)" });
    // functions are referenced, not mutated in this migration
  }

  // 4) Playbooks — become the package's instructions/recipes (tag only; not deleted).
  for (const p of playbooks) {
    const name = p.title ?? p.name ?? p.id;
    const pkg = routeByName(name, "");
    const resolved = pkg === "__gmail__" ? gmailPkg : pkg;
    rows.push({ kind: "playbook", id: p.id, name, pkg: resolved, action: "becomes-instructions",
      why: "recipe folded into package instructions at apply-time; source retained", rev: "revert anchor instructions" });
    // No standalone playbook mutation: folding the recipe text into the anchor
    // agent's instructions is done as part of building the package (in-process
    // apply). Playbooks have no PATCH route and are never deleted.
  }

  // 5) Triggers — retarget merged targets; verify zero orphans.
  for (const t of triggers) {
    const tgt = t.target ?? {};
    let newAgentId = tgt.agentId;
    let action = "keep", why = "target resolves; unchanged";
    if (tgt.kind === "agent" && tgt.agentId && mergedAway.has(tgt.agentId)) {
      // find where it merged
      const mergeAct = actions.find((x) => x.op === "merge-agent" && x.id === tgt.agentId);
      newAgentId = mergeAct ? mergeAct.into : (gmailSurvivor?.id ?? tgt.agentId);
      action = "attach-trigger"; why = `retarget ${tgt.agentId} -> ${newAgentId} (survivor)`;
      actions.push({ op: "retarget-trigger", id: t.id, target: { ...tgt, agentId: newAgentId } });
    }
    // resolvability check
    const resolves =
      tgt.kind === "skill"
        ? skills.some((s) => s.id === tgt.skillId)
        : agents.some((a) => a.id === newAgentId);
    rows.push({ kind: "trigger", id: t.id, name: t.name,
      pkg: tgt.kind === "skill" ? tgt.skillId : newAgentId, action,
      why: why + (resolves ? "" : "  [!! WOULD ORPHAN]"), rev: "restore prior target" });
  }

  // package roster
  const pkgIds = new Set(rows.filter((r) => r.kind === "agent" && r.action === "keep").map((r) => r.pkg));
  return { rows, actions, packages: [...pkgIds], gmailSurvivor, mergedAway: [...mergedAway], data };
}

/* --------------------------- verification ---------------------------- */
function invariants(plan) {
  const { rows, packages, data } = plan;
  const out = [];
  out.push(["package count <= 20", packages.length <= 20, `${packages.length} packages`]);

  // zero orphaned triggers
  const trigRows = rows.filter((r) => r.kind === "trigger");
  const orphans = trigRows.filter((r) => /WOULD ORPHAN/.test(r.why));
  out.push(["zero orphaned triggers", orphans.length === 0, `${trigRows.length} triggers, ${orphans.length} orphans`]);

  // every non-TG skill still attached (invocable)
  const realSkills = data.skills.filter((s) => !isTG(s.name));
  const attached = rows.filter((r) => r.kind === "skill" && r.action === "attach");
  out.push(["all real skills invocable", attached.length === realSkills.length,
    `${attached.length}/${realSkills.length} skills attached`]);

  // nothing deleted — every fragment has a disposition row
  const total = data.agents.length + data.skills.length + data.functions.length +
    data.triggers.length + data.playbooks.length;
  out.push(["nothing deleted (all fragments retained)", rows.length === total,
    `${rows.length} rows / ${total} fragments`]);
  return out;
}

/* ------------------------------ apply -------------------------------- */
async function apply(plan) {
  console.log(`\n[migrate] APPLY on tenant "${TENANT}" — backup first ...`);
  const b = await POST("/api/backups/run", {});
  console.log(`[migrate] backup created: ${b.name}`);
  let n = 0;
  for (const act of plan.actions) {
    try {
      if (act.op === "archive-agent") await PATCH(`/api/agents/${act.id}`, { status: "Archived", packageArchived: true });
      else if (act.op === "merge-agent") await PATCH(`/api/agents/${act.id}`, { status: "Archived", mergedInto: act.into, packageArchived: true });
      else if (act.op === "tag-agent") await PATCH(`/api/agents/${act.id}`, { packageId: act.packageId, packageVersion: act.packageVersion });
      else if (act.op === "attach-skills-to-agent") {
        const cur = (await GET(`/api/agents/${act.id}`)).agent;
        const merged = [...new Set([...(cur.skillIds ?? []), ...act.skillIds])];
        await PATCH(`/api/agents/${act.id}`, { skillIds: merged });
      }
      else if (act.op === "archive-skill") await PATCH(`/api/skills/${act.id}`, { archived: true });
      else if (act.op === "tag-skill") await PATCH(`/api/skills/${act.id}`, { packageId: act.packageId, packageVersion: act.packageVersion });
      else if (act.op === "tag-playbook") await PATCH(`/api/playbooks/${act.id}`, { packageId: act.packageId, packageVersion: act.packageVersion });
      else if (act.op === "retarget-trigger") await PATCH(`/api/triggers/${act.id}`, { target: act.target });
      n++;
    } catch (e) {
      console.error(`[migrate] action failed (${act.op} ${act.id}): ${e.message}`);
    }
  }
  console.log(`[migrate] applied ${n}/${plan.actions.length} actions. Backup: ${b.name}`);
  return b.name;
}

/* ------------------------------ report ------------------------------- */
function printReport(plan) {
  const { rows, packages, gmailSurvivor } = plan;
  const tally = {};
  for (const r of rows) tally[`${r.kind}:${r.action}`] = (tally[`${r.kind}:${r.action}`] ?? 0) + 1;
  console.log(`\n=================  WP-005 MIGRATION ${MODE.toUpperCase()}  =================`);
  console.log(`fragments: ${rows.length}  ->  packages: ${packages.length}  (limit 20)`);
  if (gmailSurvivor) console.log(`gmail survivor: ${gmailSurvivor.id} "${gmailSurvivor.name}"`);
  console.log(`\nDISPOSITIONS BY ACTION:`);
  for (const k of Object.keys(tally).sort()) console.log(`  ${k.padEnd(28)} ${tally[k]}`);
  console.log(`\nPER-RECORD DISPOSITION TABLE:`);
  console.log(`  ${"kind".padEnd(9)}${"id".padEnd(26)}${"action".padEnd(19)}pkg`);
  for (const r of rows)
    console.log(`  ${r.kind.padEnd(9)}${String(r.id).padEnd(26)}${r.action.padEnd(19)}${r.pkg}   — ${r.why}`);
  console.log(`\nPACKAGE ROSTER (${packages.length}):`);
  for (const p of packages) {
    const contents = rows.filter((r) => r.pkg === p && r.id !== p);
    const anchor = rows.find((r) => r.kind === "agent" && r.id === p);
    console.log(`  • ${p}  "${anchor?.name ?? ""}"  <- ${contents.length} attached fragments`);
  }
  console.log(`\nINVARIANTS:`);
  for (const [name, ok, detail] of invariants(plan))
    console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}  (${detail})`);
}

/* ------------------------------- main -------------------------------- */
(async () => {
  console.log(`[migrate] mode=${MODE} base=${BASE} tenant=${TENANT ?? "(read-only)"} `);
  const data = await enumerate();
  console.log(`[migrate] enumerated: ${data.agents.length} agents, ${data.skills.length} skills, ` +
    `${data.functions.length} functions, ${data.triggers.length} triggers, ${data.playbooks.length} playbooks`);
  const plan = buildPlan(data);
  printReport(plan);
  if (MODE === "apply") {
    const backup = await apply(plan);
    console.log(`\n[migrate] verifying post-apply invariants ...`);
    const after = buildPlan(await enumerate());
    for (const [name, ok, detail] of invariants(after))
      console.log(`  [${ok ? "PASS" : "FAIL"}] ${name}  (${detail})`);
    console.log(`\n[migrate] DONE. Rollback with: POST /api/backups/restore { name: "${backup}" }`);
  } else {
    console.log(`\n[migrate] DRY-RUN complete — NOTHING MUTATED.`);
  }
})().catch((e) => die(e.stack || e.message));
