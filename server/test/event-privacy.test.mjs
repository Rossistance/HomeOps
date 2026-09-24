/* HIDDEN EVENTS: WHAT EACH VIEWER IS SHOWN (event-privacy.mjs, ADR-005).
 *
 * The household's rules, as the owner put them on 2026-09-24:
 *  - a Work calendar's events are hidden from everyone but their owner — the household Owner
 *    included — and show as "<Name> working", back-to-back ones merged into one block;
 *  - the owner sees each hidden event on its own and shares one with the eye toggle;
 *  - any adult can hide their own event ("<Name> busy");
 *  - the assistant tells the OWNER everything about their own hidden events, anywhere — except
 *    a surprise (birthday, anniversary, gift, vacation, surprise), which it discusses only
 *    where the owner is alone, and which then records nothing.
 * These are the pure decisions; the routes and tools that use them have their own tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-privacy-"));
process.env.HOMEOPS_SECRET_KEY = "test-secret-key-test-secret-key-32";
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const P = await import("../event-privacy.mjs");
const { validateInput } = await import("../actions/define-action.mjs");
const { EVENT_RECORD } = await import("../actions/schemas/event.mjs");

const HH = "hh_priv";
const members = [
  { actorId: "m-owner", displayName: "Alex", role: "Owner" },
  { actorId: "m-bean", displayName: "Beannie", role: "Adult Member" },
  { actorId: "m-gpop", displayName: "Gpop", role: "Adult Admin" },
  { actorId: "m-teen", displayName: "Sam", role: "Limited Member" },
  { actorId: "m-kid", displayName: "Noah", role: "Child View" },
].map((m) => ({ ...m, householdId: HH }));
const subs = [
  { id: "sub_work", householdId: HH, ownerActorId: "m-bean", isWork: true, name: "Work" },
  { id: "sub_home", householdId: HH, ownerActorId: "m-bean", isWork: false, name: "Personal" },
  { id: "sub_teen", householdId: HH, ownerActorId: "m-teen", isWork: true, name: "Teen job" },
  { id: "sub_gpop", householdId: HH, ownerActorId: "m-gpop", isWork: false, name: "Gpop" },
];
const pc = (over = {}) => ({
  householdId: HH,
  subsById: new Map(subs.map((s) => [s.id, s])),
  membersById: new Map(members.map((m) => [m.actorId, { ...m, ...(over[m.actorId] ?? {}) }])),
});
const who = (id) => ({ actorId: id, role: members.find((m) => m.actorId === id).role });

let n = 0;
function ev(fields) {
  n++;
  const linked = fields.sub ? { layer: "linked", ownerId: subs.find((s) => s.id === fields.sub).ownerActorId, provenance: { via: "ics", subscriptionId: fields.sub, uid: `u${n}` } } : { layer: "canonical", provenance: { via: "user" } };
  const { sub, ...rest } = fields;
  return {
    id: `ev_${n}`, householdId: HH, title: "Untitled", startAt: null, endAt: null, allDay: false, location: "", notes: "",
    spaceId: "sp-family", participantIds: [], driverId: null, ownerId: null, backupOwnerId: null, whatToBring: [], checklist: [],
    travel: null, reminders: [], attachments: [], comments: [], mealImpact: null, visibility: "household", nestId: null,
    category: "Calendar", status: "confirmed", source: "x", createdBy: "m-owner", createdAt: 0, updatedAt: "2026-09-24T00:00:00.000Z",
    ...linked, ...rest,
  };
}
const at = (h, m = 0) => new Date(Date.UTC(2026, 8, 25, h, m)).toISOString();

test("surprise words are matched on word boundaries; the owner's switch wins either way", () => {
  for (const t of ["Dad's birthday dinner", "BDAY cake pickup", "b-day party", "Anniversary", "gift for Mom", "Gifts wrap", "Vacation — Maui", "SURPRISE party", "🎂 at 6"]) {
    assert.equal(P.secretCategory({ title: t }), true, t);
  }
  for (const t of ["Board presentation", "Gifted program meeting", "Birthdayish", "Surprised by rain", "Dentist"]) {
    assert.equal(P.secretCategory({ title: t }), false, t);
  }
  assert.equal(P.secretCategory({ title: "Party", notes: "it's a surprise, don't tell Dad" }), true, "notes count");
  assert.equal(P.isSecret({ title: "Dad's party", secret: true }), true, "the switch covers what the words miss");
  assert.equal(P.isSecret({ title: "Gift card reimbursement", secret: false }), false, "the switch un-flags a false hit");
});

test("a Work calendar hides by default; the owner's per-event choice wins; only adults can hide", () => {
  const c = pc();
  assert.equal(P.obscureStateOf(ev({ sub: "sub_work", title: "Standup" }), c).obscured, true);
  assert.equal(P.obscureStateOf(ev({ sub: "sub_work", title: "Standup" }), c).kind, "work");
  assert.equal(P.obscureStateOf(ev({ sub: "sub_work", shareState: "shared" }), c).obscured, false, "shared with the eye toggle");
  assert.equal(P.obscureStateOf(ev({ sub: "sub_home" }), c).obscured, false, "a non-Work calendar shows by default");
  const manual = P.obscureStateOf(ev({ ownerId: "m-bean", createdBy: "m-bean", shareState: "hidden" }), c);
  assert.deepEqual([manual.obscured, manual.kind], [true, "busy"], "hidden by hand reads busy");
  assert.equal(P.obscureStateOf(ev({ sub: "sub_teen" }), c).obscured, false, "a Limited Member cannot hide, even on a calendar flagged Work");
  assert.equal(P.obscureStateOf(ev({ ownerId: "m-kid", createdBy: "m-kid", shareState: "hidden" }), c).obscured, false, "nor a child");
  assert.equal(P.obscureStateOf(ev({ sub: "sub_work" }), pc({ "m-bean": { role: "Limited Member" } })).obscured, false, "a demotion reveals rather than stranding hidden events");
});

test("the owner sees each hidden event in full; everyone else — the household Owner included — sees a block", () => {
  const events = [ev({ sub: "sub_work", title: "1:1 with Pat", notes: "raise", location: "Room 4", startAt: at(13), endAt: at(14) })];
  const [mine] = P.presentEvents(events, who("m-bean"), { pc: pc() });
  assert.equal(mine.title, "1:1 with Pat");
  assert.deepEqual(mine.privacy, { obscured: true, kind: "work", secret: false, canToggle: true });
  for (const viewer of ["m-owner", "m-gpop", "m-teen", "m-kid"]) {
    const out = P.presentEvents(events, who(viewer), { pc: pc() });
    assert.equal(out.length, 1, viewer);
    const b = out[0];
    assert.equal(b.title, "Beannie working", viewer);
    assert.deepEqual([b.startAt, b.endAt, b.ownerId], [at(13), at(14), "m-bean"]);
    assert.equal(JSON.stringify(b).includes("Pat") || JSON.stringify(b).includes("Room 4") || JSON.stringify(b).includes("raise"), false, `${viewer} gets nothing of the event`);
    assert.deepEqual([b.editable, b.appendable, b.block], [false, false, { kind: "work", count: 1 }]);
    assert.ok(b.id.startsWith("blk_") && b.id !== events[0].id, "a block never carries the real id");
  }
});

test("participants see the block too — only the owner sees through a hide", () => {
  const e = ev({ ownerId: "m-bean", createdBy: "m-bean", shareState: "hidden", participantIds: ["m-kid"], title: "Dentist", startAt: at(9), endAt: at(10) });
  const [b] = P.presentEvents([e], who("m-kid"), { pc: pc() });
  assert.equal(b.title, "Beannie busy");
  assert.deepEqual(b.participantIds, []);
});

test("back-to-back hidden events merge into one block; a shared one splits it; kinds and all-day never mix", () => {
  const events = [
    ev({ sub: "sub_work", title: "A", startAt: at(9), endAt: at(10) }),
    ev({ sub: "sub_work", title: "B", startAt: at(10, 10), endAt: at(11) }),        // 10-minute gap: same block
    ev({ sub: "sub_work", title: "C", startAt: at(11, 30), endAt: at(12) }),        // 30-minute gap: new block
    ev({ sub: "sub_work", title: "D", startAt: at(12), endAt: at(13), shareState: "shared" }),
    ev({ sub: "sub_work", title: "E", startAt: at(13), endAt: at(14) }),
    ev({ ownerId: "m-bean", createdBy: "m-bean", shareState: "hidden", title: "Therapy", startAt: at(14), endAt: at(15) }),
    ev({ sub: "sub_work", title: "Offsite", allDay: true, startAt: at(4), endAt: null }),
  ];
  const out = P.presentEvents(events, who("m-owner"), { pc: pc() });
  const blocks = out.filter((e) => e.block).map((e) => [e.title, e.startAt, e.endAt, e.block.count, e.allDay]);
  assert.deepEqual(blocks.sort((a, b) => String(a[1]).localeCompare(String(b[1]))), [
    ["Beannie working", at(4), null, 1, true],
    ["Beannie working", at(9), at(11), 2, false],
    ["Beannie working", at(11, 30), at(12), 1, false],
    ["Beannie working", at(13), at(14), 1, false],
    ["Beannie busy", at(14), at(15), 1, false],
  ]);
  assert.ok(out.some((e) => e.title === "D"), "the shared event shows in full, between the blocks");
});

test("all-day hidden days in a row merge", () => {
  const d = (day) => new Date(Date.UTC(2026, 8, day, 4)).toISOString();
  const events = [ev({ sub: "sub_work", allDay: true, startAt: d(21), endAt: d(22) }), ev({ sub: "sub_work", allDay: true, startAt: d(23) }), ev({ sub: "sub_work", allDay: true, startAt: d(26) })];
  const blocks = P.presentEvents(events, who("m-kid"), { pc: pc() }).map((b) => [b.startAt, b.endAt, b.block.count]);
  assert.deepEqual(blocks, [[d(21), d(23), 2], [d(26), null, 1]]);
});

test("blocks fit the event contract every client is generated from, and keep their id across fetches", () => {
  const events = [ev({ sub: "sub_work", startAt: at(9), endAt: at(10) }), ev({ sub: "sub_work", startAt: at(10), endAt: at(11) })];
  const a = P.presentEvents(events, who("m-owner"), { pc: pc() });
  const b = P.presentEvents(events, who("m-owner"), { pc: pc() });
  assert.equal(a[0].id, b[0].id);
  const v = validateInput(EVENT_RECORD, a[0], { unknown: "reject" });
  assert.ok(v.ok, `${v.field}: ${v.message}`);
  assert.equal(a[0].createdBy, "m-bean", "createdBy names the owner, never the viewer");
});

test("the assistant: the owner hears their hidden events anywhere; a surprise only where they are alone", () => {
  const work = ev({ sub: "sub_work", title: "Haircut for X", startAt: at(14), endAt: at(15) });
  const party = ev({ ownerId: "m-bean", createdBy: "m-bean", shareState: "hidden", title: "Surprise party for Alex", notes: "at Rosa's", startAt: at(19), endAt: at(22) });
  const ask = (audience, ledger, purpose = "assistant") => P.presentEvents([work, party], who("m-bean"), { pc: pc(), purpose, audience, ledger });

  let ledger = {};
  let out = ask("shared", ledger);
  assert.equal(out.find((e) => e.id === work.id).title, "Haircut for X", "a Work event is the owner's to discuss even in a group");
  const withheld = out.find((e) => e.id === party.id);
  assert.equal(withheld.title, "Private event");
  assert.equal(JSON.stringify(withheld).includes("Rosa"), false);
  assert.equal(withheld.privacy.withheld, true);
  assert.equal(ledger.secretReleased, undefined, "nothing surprising was handed over");

  ledger = {};
  out = ask("self", ledger);
  assert.equal(out.find((e) => e.id === party.id).title, "Surprise party for Alex", "alone with the owner, the details are theirs");
  assert.equal(ledger.secretReleased, true, "…and the turn is marked so it records nothing");

  ledger = {};
  out = ask("self", ledger, "snapshot");
  assert.equal(out.find((e) => e.id === party.id).title, "Private event", "the pre-loaded briefing never carries a surprise");
  assert.equal(ledger.secretReleased, undefined);

  const alex = P.presentEvents([work, party], who("m-owner"), { pc: pc(), purpose: "assistant", audience: "self" });
  assert.deepEqual(alex.map((e) => e.title).sort(), ["Beannie busy", "Beannie working"], "anyone else gets blocks, however private their chat");
});

test("the owner's own unhidden events carry the toggle and the surprise hint; nobody else's do", () => {
  const e = ev({ ownerId: "m-bean", createdBy: "m-bean", title: "Anniversary dinner" });
  assert.deepEqual(P.presentEvents([e], who("m-bean"), { pc: pc() })[0].privacy, { obscured: false, secret: true, canToggle: true });
  assert.equal(P.presentEvents([e], who("m-owner"), { pc: pc() })[0].privacy, undefined);
  const kid = ev({ ownerId: "m-kid", createdBy: "m-kid", title: "Soccer" });
  assert.equal(P.presentEvents([kid], who("m-kid"), { pc: pc() })[0].privacy, undefined, "a child has nothing to toggle");
});

test("the existing visibility gate still applies first", () => {
  const priv = ev({ ownerId: "m-gpop", createdBy: "m-gpop", visibility: "private", title: "Private" });
  assert.deepEqual(P.presentEvents([priv], who("m-kid"), { pc: pc() }), []);
  const adults = ev({ ownerId: "m-owner", createdBy: "m-owner", visibility: "adults", title: "Bills" });
  assert.deepEqual(P.presentEvents([adults], who("m-kid"), { pc: pc() }), []);
  const grp = ev({ ownerId: "m-bean", createdBy: "m-bean", visibility: "adults", title: "x" });
  assert.deepEqual(P.presentEvents([grp], who("m-bean"), { pc: pc(), channel: "group" }), [], "group channel narrows even the owner's own");
});

test("a Limited Member's Owner-set scope: none, all, chosen calendars, app events — own and participating always", () => {
  const events = {
    beanHome: ev({ sub: "sub_home", title: "Bean home", startAt: at(8) }),
    beanApp: ev({ ownerId: "m-bean", createdBy: "m-bean", title: "Bean app", startAt: at(9) }),
    gpop: ev({ sub: "sub_gpop", title: "Gpop cal", startAt: at(10) }),
    gpopRide: ev({ sub: "sub_gpop", title: "Gpop drives Sam", driverId: "m-teen", startAt: at(11) }),
    owner: ev({ ownerId: "m-owner", createdBy: "m-owner", title: "Alex", startAt: at(12) }),
    mine: ev({ sub: "sub_teen", shareState: "shared", title: "My shift", startAt: at(13) }),
  };
  const scope = { members: { "m-bean": { calendars: ["app"] }, "m-gpop": "none" } };
  const out = P.presentEvents(Object.values(events), who("m-teen"), { pc: pc({ "m-teen": { calendarScope: scope } }) }).map((e) => e.title).sort();
  assert.deepEqual(out, ["Alex", "Bean app", "Gpop drives Sam", "My shift"]);
  const all = P.presentEvents(Object.values(events), who("m-teen"), { pc: pc() }).length;
  assert.equal(all, 6, "no scope = everything they could see anyway");
  const adult = P.presentEvents(Object.values(events), who("m-gpop"), { pc: pc({ "m-gpop": { calendarScope: scope } }) }).length;
  assert.equal(adult, 6, "a scope on anyone but a Limited Member is inert");
});

test("normalizeCalendarScope accepts only real members and their own calendars", () => {
  const c = pc();
  const lm = c.membersById.get("m-teen");
  assert.deepEqual(P.normalizeCalendarScope(null, lm, c), { ok: true, value: null });
  assert.deepEqual(P.normalizeCalendarScope({ members: { "m-bean": { calendars: ["sub_home", "app", "sub_home"] }, "m-gpop": "none" } }, lm, c),
    { ok: true, value: { members: { "m-bean": { calendars: ["sub_home", "app"] }, "m-gpop": "none" } } });
  assert.equal(P.normalizeCalendarScope({ members: { "m-bean": { calendars: ["sub_gpop"] } } }, lm, c).error, "bad_calendar", "not Beannie's calendar");
  assert.equal(P.normalizeCalendarScope({ members: { "m-ghost": "all" } }, lm, c).error, "bad_member");
  assert.equal(P.normalizeCalendarScope({ members: { "m-teen": "none" } }, lm, c).error, "bad_member", "cannot scope themselves out");
  assert.equal(P.normalizeCalendarScope({ members: { "m-bean": "some" } }, lm, c).error, "bad_scope");
  assert.equal(P.normalizeCalendarScope([], lm, c).error, "bad_scope");
});

test("acting on someone else's hidden event is refused without saying what it is", () => {
  const e = ev({ sub: "sub_work", title: "Secret project" });
  const r = P.hiddenEventRefusal(e, who("m-owner"), pc());
  assert.equal(r.error, "event_hidden");
  assert.equal(r.message.includes("Secret"), false);
  assert.match(r.message, /Beannie/);
  assert.equal(P.hiddenEventRefusal(e, who("m-bean"), pc()), null, "the owner may");
  assert.equal(P.hiddenEventRefusal(ev({ sub: "sub_home" }), who("m-owner"), pc()), null, "an unhidden event is not this rule's business");
});
