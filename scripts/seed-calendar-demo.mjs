#!/usr/bin/env node
// Calendar demo household (ADR-005 verification harness).
//
// Builds a fresh demo household on a LOCAL FamiliOS server so a human, the Maestro flows in
// apps/mobile/.maestro and the Playwright spec tests/topgun/calendar/calendar-privacy.spec.ts
// can see the calendar privacy rules with their own eyes:
//
//   Alex     Owner           no PIN; one family calendar (alex-family.ics) + "Alex dentist"
//   Gpop     Adult Admin     no PIN; "Gpop golf with Frank" + one event he hid ("Gpop busy")
//   Beannie  Adult Member    a WORK calendar (beannie-work.ics: back-to-back weekday meetings
//                            with a lunch gap), a Personal calendar (beannie-personal.ics:
//                            "Mom's birthday dinner"), and one app event "Beannie pottery class"
//   Sam      Limited Member  one calendar of his own (sam-school.ics); the Owner set his
//                            calendarScope to Beannie's app events only and nothing of Gpop's
//   Noah     Child View      nothing of his own; sees the family's calendar with blocks
//
// No PIN is set, so on a dev-mode server every profile signs in with one tap on the Lock
// screen. (A production-mode server — HOMEOPS_ENV/NODE_ENV=production — refuses elevated
// sign-in without a PIN, so run the demo server in development mode.)
//
// HOW IT SEEDS: through the real HTTP routes of a running server, as each member, with bearer
// sessions (POST /api/session with x-homeops-bearer: 1) — the same doors the app uses, so the
// Connections matrix, the Work flag, the Limited Member cap and the scope validation all run
// for real. Nothing is written into the store behind the server's back. The .ics fixtures are
// TEMPLATES (scripts/fixtures/calendar-demo/*.ics); the dates are rendered relative to "today"
// in this machine's local time zone (set TZ to change it) and pasted through
// POST /api/calendar/import-ics, which keeps the rendered text so Sync re-parses it.
//
// Usage
//   node scripts/seed-calendar-demo.mjs --serve [--data-dir DIR] [--port 8787]
//       Starts server/index.mjs on the port with HOMEOPS_DATA_DIR=DIR (a new temp dir when
//       omitted), seeds it, prints the summary, and keeps the server running until Ctrl-C.
//   node scripts/seed-calendar-demo.mjs [--url http://127.0.0.1:8787]
//       Seeds a server you started yourself (it must be on a scratch HOMEOPS_DATA_DIR).
//   --check        after seeding, print what GET /api/events shows each member
//   --check-only   print that summary and seed nothing
//   --json         print the result as JSON (ids included) instead of text
//
// Seeding twice is refused politely: if the household already has Beannie, the seed step is
// skipped and only --check runs.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import fs from "node:fs";
import os from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = join(ROOT, "scripts", "fixtures", "calendar-demo");

/* ---------------------------------------------------------------- dates ---------------- */

const pad = (n) => String(n).padStart(2, "0");
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
/** Local wall-clock time on a day → an ICS UTC stamp (…Z), so the feed names real instants. */
function utcStamp(day, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function addDays(day, n) { return new Date(day.getFullYear(), day.getMonth(), day.getDate() + n); }
/** Local wall-clock time on a day → an ISO instant for POST /api/events. */
export function localISO(day, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0).toISOString();
}

/** Today is always a workday here, even on a weekend, so the Calendar screen opens on
 *  something; after it, every Monday–Friday in the next two weeks. */
export function workdays(today = new Date()) {
  const t0 = addDays(today, 0);
  const out = [t0];
  for (let i = 1; i <= 14; i++) {
    const d = addDays(t0, i);
    if (d.getDay() !== 0 && d.getDay() !== 6) out.push(d);
  }
  return out;
}

/** Render a fixture template. Tokens: {{DAY+N}} (all-day date), {{DAY+N HH:MM}} (instant),
 *  {{WORKDAY}} / {{WORKDAY HH:MM}} — a VEVENT holding a WORKDAY token is repeated for each
 *  workday. X-DEMO-* lines are dropped. Output uses CRLF, as RFC 5545 asks. */
export function renderIcs(template, today = new Date()) {
  const t0 = addDays(today, 0);
  const days = workdays(t0);
  const text = template.replace(/\r\n/g, "\n").split("\n").filter((l) => !/^X-DEMO-/.test(l)).join("\n");
  const expanded = text.replace(/BEGIN:VEVENT\n[\s\S]*?END:VEVENT\n?/g, (block) => {
    if (!block.includes("{{WORKDAY")) return block;
    return days.map((d) => block
      .replace(/\{\{WORKDAY (\d{2}:\d{2})\}\}/g, (_, hm) => utcStamp(d, hm))
      .replace(/\{\{WORKDAY\}\}/g, ymd(d))).join("");
  });
  const out = expanded
    .replace(/\{\{DAY\+(\d+) (\d{2}:\d{2})\}\}/g, (_, n, hm) => utcStamp(addDays(t0, Number(n)), hm))
    .replace(/\{\{DAY\+(\d+)\}\}/g, (_, n) => ymd(addDays(t0, Number(n))));
  const left = out.match(/\{\{[^}]*\}\}/);
  if (left) throw new Error(`unrendered token ${left[0]}`);
  return out.split("\n").join("\r\n");
}
export function renderFixture(name, today = new Date()) {
  return renderIcs(fs.readFileSync(join(FIXTURES, name), "utf8"), today);
}

/* ---------------------------------------------------------------- the household -------- */

/** Who the demo household is. The server's boot seed (server/seed.mjs) creates the Harper
 *  roster; the demo keeps three of those actor ids (renamed / re-roled) and archives the rest,
 *  so nothing else shows on the Lock screen. */
export const DEMO = {
  alex: { actorId: "m-alex", displayName: "Alex", role: "Owner", relationship: "Parent", photo: "emoji:🦊" },
  gpop: { actorId: "m-gpop", displayName: "Gpop", role: "Adult Admin", relationship: "Grandparent", photo: "emoji:⛳" },
  beannie: { actorId: "m-beannie", displayName: "Beannie", role: "Adult Member", relationship: "Parent", photo: "emoji:🌻" },
  sam: { actorId: "m-sam", displayName: "Sam", role: "Limited Member", relationship: "Cousin", photo: "emoji:🎧" },
  noah: { actorId: "m-noah", displayName: "Noah", role: "Child View", relationship: "Child (age 6)", photo: "emoji:🦖" },
};
const ARCHIVE = ["m-morgan", "m-lily", "m-elaine"];

/** Beannie's Work meeting titles — nobody but Beannie may read these (until she shares one). */
export const WORK_TITLES = ["Team standup", "Q3 roadmap review", "1:1 with Priya", "Vendor call with Acme", "Design critique", "Budget sync", "Hiring panel debrief"];
/** The Work event the eye-toggle flow shares (today's instance). */
export const SHARE_TITLE = "Q3 roadmap review";

/* ---------------------------------------------------------------- HTTP ----------------- */

async function signIn(base, actorId) {
  const r = await fetch(base + "/api/session", {
    method: "POST",
    headers: { "content-type": "application/json", "x-homeops-bearer": "1" },
    body: JSON.stringify({ actorId }),
  });
  const body = await r.json().catch(() => null);
  if (r.status !== 200 || !body?.token) {
    throw new Error(`sign-in as ${actorId} failed (${r.status}): ${JSON.stringify(body)}${body?.error === "pin_required" || body?.error === "pin_not_configured" ? "\n  → run the server in development mode with no Owner PIN and no HOMEOPS_BOOTSTRAP_PIN" : ""}`);
  }
  const token = body.token;
  const req = async (path, { method = "GET", body: payload } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(payload !== undefined ? { "content-type": "application/json" } : {}) },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  const must = async (path, opts, what) => {
    const r2 = await req(path, opts);
    if (r2.status < 200 || r2.status >= 300) throw new Error(`${what ?? path} as ${actorId} → ${r2.status} ${JSON.stringify(r2.data)}`);
    return r2.data;
  };
  return { actorId, req, must };
}

export async function waitForServer(base, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const r = await fetch(base + "/api/profiles");
      if (r.ok) {
        const b = await r.json();
        if ((b.profiles ?? []).some((p) => p.actorId === "m-alex")) return b.profiles;
      }
    } catch { /* not up yet */ }
    if (Date.now() > deadline) throw new Error(`no FamiliOS server answering at ${base}`);
    await new Promise((res) => setTimeout(res, 200));
  }
}

/* ---------------------------------------------------------------- seed ----------------- */

export async function seedCalendarDemo(base, { today = new Date(), log = () => {} } = {}) {
  const profiles = await waitForServer(base);
  if (profiles.some((p) => p.actorId === DEMO.beannie.actorId)) {
    log("This household already has Beannie — seed skipped (use a fresh HOMEOPS_DATA_DIR to start over).");
    return { skipped: true, ...(await demoIds(base, today)) };
  }
  if (profiles.some((p) => !["m-alex", "m-morgan", "m-lily", "m-noah", "m-elaine", "m-sam"].includes(p.actorId))) {
    throw new Error("This server's household is not fresh (it has members the boot seed did not create). Point the server at a scratch HOMEOPS_DATA_DIR.");
  }

  // 1. The roster, as the Owner.
  const alex = await signIn(base, DEMO.alex.actorId);
  await alex.must(`/api/members/${DEMO.alex.actorId}`, { method: "PATCH", body: { displayName: DEMO.alex.displayName, relationship: DEMO.alex.relationship } }, "rename Alex");
  for (const id of ARCHIVE) await alex.must(`/api/members/${id}`, { method: "DELETE" }, `archive ${id}`);
  for (const m of [DEMO.gpop, DEMO.beannie]) {
    await alex.must("/api/members", { method: "POST", body: { actorId: m.actorId, displayName: m.displayName, role: m.role, relationship: m.relationship } }, `add ${m.displayName}`);
  }
  for (const m of [DEMO.sam, DEMO.noah]) {
    await alex.must(`/api/members/${m.actorId}`, { method: "PATCH", body: { displayName: m.displayName, role: m.role, relationship: m.relationship } }, `set up ${m.displayName}`);
  }
  // Faces for the blocks (MemberAvatar draws emoji ids). Cosmetic: a refusal is not fatal.
  for (const m of Object.values(DEMO)) {
    const r = await alex.req(`/api/members/${m.actorId}`, { method: "PATCH", body: { photoFileId: m.photo } });
    if (r.status !== 200) log(`  (photo for ${m.displayName} not set: ${r.status})`);
  }
  log("Roster: Alex (Owner), Gpop (Adult Admin), Beannie (Adult Member), Sam (Limited Member), Noah (Child View).");

  const gpop = await signIn(base, DEMO.gpop.actorId);
  const beannie = await signIn(base, DEMO.beannie.actorId);
  const sam = await signIn(base, DEMO.sam.actorId);

  // 2. Calendars, each added by the person it belongs to.
  const importAs = async (who, name, file) => {
    const d = await who.must("/api/calendar/import-ics", { method: "POST", body: { name, ics: renderFixture(file, today) } }, `import ${file}`);
    return d.subscription;
  };
  const alexCal = await importAs(alex, "Harper family", "alex-family.ics");
  const work = await importAs(beannie, "Beannie work", "beannie-work.ics");
  await beannie.must(`/api/calendar/subscriptions/${work.id}`, { method: "PATCH", body: { isWork: true } }, "mark Beannie work as Work");
  const personal = await importAs(beannie, "Beannie personal", "beannie-personal.ics");
  const samCal = await importAs(sam, "Sam school", "sam-school.ics");
  log(`Calendars: Harper family (Alex), Beannie work [Work], Beannie personal, Sam school.`);

  // 3. Events made in FamiliOS ("app" events).
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const day = (n) => addDays(t0, n);
  const event = (who, title, n, from, to, extra = {}) =>
    who.must("/api/events", { method: "POST", body: { title, startAt: localISO(day(n), from), endAt: localISO(day(n), to), ...extra } }, `event ${title}`);
  await event(beannie, "Beannie pottery class", 1, "18:00", "19:30");
  await event(gpop, "Gpop golf with Frank", 0, "16:00", "18:00");
  await event(gpop, "Gpop cardiology appointment", 2, "10:00", "11:00", { hidden: true });
  await event(alex, "Alex dentist", 2, "08:00", "09:00");
  log("App events: Beannie pottery class, Gpop golf with Frank, Gpop cardiology appointment (hidden), Alex dentist.");

  // 4. Sam's view: Beannie's app events only, nothing of Gpop's. Alex is unmentioned → all.
  await alex.must(`/api/members/${DEMO.sam.actorId}/calendar-scope`, {
    method: "PUT",
    body: { scope: { members: { [DEMO.beannie.actorId]: { calendars: ["app"] }, [DEMO.gpop.actorId]: "none" } } },
  }, "set Sam's calendar scope");
  log("Sam's calendar scope: Beannie → app events only; Gpop → none.");

  return { skipped: false, subscriptions: { alexFamily: alexCal.id, beannieWork: work.id, beanniePersonal: personal.id, samSchool: samCal.id }, ...(await demoIds(base, today)) };
}

/** Ids the flows need: the next "Q3 roadmap review" still ahead (as Beannie sees it) — the
 *  same one apps/mobile/.maestro/scripts/demo-api.js picks. */
export async function demoIds(base, now = new Date()) {
  const beannie = await signIn(base, DEMO.beannie.actorId);
  const { events } = await beannie.must("/api/events");
  const share = events
    .filter((e) => e.title === SHARE_TITLE && !e.block && Date.parse(e.startAt) > now.getTime())
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))[0];
  return { shareEventId: share?.id ?? null };
}

/* ---------------------------------------------------------------- check ---------------- */

const fmt = (iso) => {
  if (!iso) return "(no time)";
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
};

/** What GET /api/events shows each member, grouped: full titles, the viewer's own hidden
 *  events, and blocks. Returned as data; printed by the CLI. */
export async function checkCalendarDemo(base, { days = 3, today = new Date() } = {}) {
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const to = from + days * 86_400_000;
  const out = {};
  for (const key of ["alex", "gpop", "beannie", "sam", "noah"]) {
    const who = await signIn(base, DEMO[key].actorId);
    const { events } = await who.must("/api/events");
    const inWindow = events.filter((e) => { const t = Date.parse(e.startAt ?? ""); return Number.isFinite(t) && t >= from && t < to; })
      .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt));
    const conns = await who.req("/api/calendar/subscriptions");
    out[key] = {
      name: DEMO[key].displayName,
      role: DEMO[key].role,
      total: events.length,
      events: inWindow.map((e) => ({
        id: e.id,
        kind: e.block ? "block" : e.privacy?.obscured ? "own-hidden" : "full",
        label: e.title,
        startAt: e.startAt, endAt: e.endAt ?? null,
        ...(e.block ? { count: e.block.count ?? null } : {}),
      })),
      titles: [...new Set(events.filter((e) => !e.block).map((e) => e.title))].sort(),
      blocks: [...new Set(events.filter((e) => e.block).map((e) => e.title))].sort(),
      connections: conns.status === 200
        ? (conns.data.subscriptions ?? []).map((s) => ({ name: s.name, owner: s.ownerName ?? s.ownerActorId ?? null, isWork: !!s.isWork, can: s.can ?? null }))
        : { status: conns.status, error: conns.data?.error ?? null },
      canAdd: conns.status === 200 ? conns.data.canAdd : null,
    };
  }
  return out;
}

function printCheck(summary, days) {
  const leaks = [];
  for (const [key, v] of Object.entries(summary)) {
    console.log(`\n=== ${v.name} (${v.role}) — ${v.total} events in all; the next ${days} days:`);
    for (const e of v.events) {
      const tag = e.kind === "block" ? `[block${e.count ? ` ×${e.count}` : ""}]` : e.kind === "own-hidden" ? "[mine, hidden]" : "";
      console.log(`  ${fmt(e.startAt).padEnd(26)} ${e.label} ${tag}`.trimEnd());
    }
    console.log(`  titles seen: ${v.titles.join(" · ") || "(none)"}`);
    console.log(`  blocks seen: ${v.blocks.join(" · ") || "(none)"}`);
    if (Array.isArray(v.connections)) {
      console.log(`  connections (${v.connections.length}):`);
      for (const c of v.connections) {
        const can = c.can ? Object.entries(c.can).filter(([, ok]) => ok).map(([k]) => k).join(",") || "nothing" : "legend only";
        console.log(`    ${c.name}${c.isWork ? " [Work]" : ""} — ${c.owner ?? "?"} — may: ${can}`);
      }
      console.log(`  canAdd: ${JSON.stringify(v.canAdd)}`);
    } else console.log(`  connections: refused ${JSON.stringify(v.connections)}`);
    if (key !== "beannie") {
      const seen = WORK_TITLES.filter((t) => v.titles.includes(t));
      if (seen.length) leaks.push(`${v.name} sees Work titles: ${seen.join(", ")}`);
    }
  }
  console.log("");
  if (leaks.length) console.log("NOTE — Work titles visible to someone other than Beannie (expected only for an event she shared):\n  " + leaks.join("\n  "));
  else console.log("Nobody but Beannie sees a Work meeting title.");
}

/* ---------------------------------------------------------------- CLI ------------------ */

function parseArgs(argv) {
  const a = { url: null, serve: false, dataDir: null, port: 8787, check: false, checkOnly: false, json: false, days: 3 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--url") a.url = argv[++i];
    else if (k === "--serve") a.serve = true;
    else if (k === "--data-dir") a.dataDir = argv[++i];
    else if (k === "--port") a.port = Number(argv[++i]);
    else if (k === "--check") a.check = true;
    else if (k === "--check-only") { a.check = true; a.checkOnly = true; }
    else if (k === "--json") a.json = true;
    else if (k === "--days") a.days = Number(argv[++i]);
    else if (k === "-h" || k === "--help") { a.help = true; }
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

/** Start server/index.mjs on a scratch data dir. Refuses the real server/.data. */
export function startDemoServer({ dataDir, port = 8787, stdio = "inherit", env = {} } = {}) {
  const dir = resolve(dataDir ?? fs.mkdtempSync(join(os.tmpdir(), "familios-calendar-demo-")));
  if (dir.toLowerCase() === resolve(ROOT, "server", ".data").toLowerCase()) {
    throw new Error("Refusing to seed the real server/.data — give --data-dir a scratch directory.");
  }
  fs.mkdirSync(dir, { recursive: true });
  const child = spawn(process.execPath, [join(ROOT, "server", "index.mjs")], {
    cwd: ROOT, stdio,
    env: {
      ...process.env,
      PORT: String(port),
      HOMEOPS_DATA_DIR: dir,
      NODE_ENV: "development",
      HOMEOPS_ENV: "development",
      // A PIN from the caller's shell would put the demo profiles behind it.
      HOMEOPS_BOOTSTRAP_PIN: "",
      ...env,
    },
  });
  return { child, dataDir: dir, scratch: !dataDir, base: `http://127.0.0.1:${port}` };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).slice(0, 44).map((l) => l.slice(3)).join("\n"));
    return;
  }
  const log = args.json ? () => {} : (m) => console.log(m);
  let server = null;
  let base = args.url ?? "http://127.0.0.1:8787";
  if (args.serve) {
    server = startDemoServer({ dataDir: args.dataDir, port: args.port });
    base = server.base;
    log(`[demo] server/index.mjs on ${base} with HOMEOPS_DATA_DIR=${server.dataDir}`);
    // A temp dir this script made is removed on the way out; a --data-dir you named is kept.
    const tidy = () => { if (server.scratch) { try { fs.rmSync(server.dataDir, { recursive: true, force: true }); } catch { /* still locked */ } } };
    let stopping = false;
    const stop = () => { stopping = true; try { server.child.kill(); } catch { /* gone */ } };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    server.child.on("exit", (code) => {
      log(`[demo] server exited (${code})`);
      setTimeout(() => { tidy(); process.exit(stopping ? 0 : (code ?? 1)); }, 300);
    });
  }
  try {
    const result = args.checkOnly ? await demoIds(base) : await seedCalendarDemo(base, { log });
    const summary = args.check ? await checkCalendarDemo(base, { days: args.days }) : null;
    if (args.json) console.log(JSON.stringify({ base, dataDir: server?.dataDir ?? null, ...result, ...(summary ? { check: summary } : {}) }, null, 2));
    else {
      if (!args.checkOnly) log(`\nSeeded ${base}. Next "${SHARE_TITLE}" (the one the eye-toggle flow shares): ${result.shareEventId ?? "(not found)"}`);
      if (summary) printCheck(summary, args.days);
    }
  } catch (e) {
    console.error(`[demo] ${e.message}`);
    if (server) server.child.kill();
    process.exit(1);
  }
  if (server) log(`\n[demo] Seeded. Server keeps running on ${base} — Ctrl-C to stop.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
