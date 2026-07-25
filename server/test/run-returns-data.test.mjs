// "you didnt return anything" → "still nothing" → "still nothing".
//
// Three consecutive turns from the 2026-07-25 agent-chat recordings, while the assistant
// kept replying "here's the family task list…". And from the earlier session: "OK, you
// didn't return anything in the chat thread — did you get the events? I can read here in a
// list? I need to be able to do that without going back to the Calendar screen."
//
// The run WORKED. runOutcomeText only ever surfaced text from reasoning steps (no toolId),
// so a step that actually fetched events/tasks/places returned structured rows which were
// dropped — leaving "Done — finished (1/1 steps)" for a run whose whole purpose was to
// show a list.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-runtext-"));
const { runOutcomeText, runResultGroups, rowCard } = await import("../assistant-runs.mjs");

const run = (steps, over = {}) => ({
  id: "run_1", title: "Review upcoming schedule", status: "completed", steps, ...over,
});
const step = (over) => ({ index: 0, status: "succeeded", toolId: "homeops.x", title: "", detail: "", input: {}, ...over });

test("THE BUG: a run that fetched events returns the EVENTS, not just a step count", () => {
  const text = runOutcomeText(run([
    step({
      toolId: "calendar.list", title: "List calendar events",
      result: { events: [
        { title: "All-school movie night", startAt: "2026-07-24T17:00:00.000Z", location: "St. Jude Catholic Church" },
        { title: "Serving as Eucharistic Minister", startAt: "2026-07-26T09:00:00.000Z" },
      ] },
    }),
  ]));
  assert.match(text, /All-school movie night/, "the event the family asked for must be IN the reply");
  assert.match(text, /Eucharistic Minister/);
  assert.match(text, /St\. Jude/, "location rides along so the row is recognisable");
});

test("rows are rendered for ANY key name the tool happens to use", () => {
  // Tools name their payloads differently (tasks/items/results/places); the reply must not
  // depend on guessing the right key.
  for (const key of ["tasks", "items", "results", "places"]) {
    const text = runOutcomeText(run([step({ title: "Fetch", result: { [key]: [{ title: "Car oil change", dueAt: "2026-07-14T12:00:00.000Z" }] } })]));
    assert.match(text, /Car oil change/, `payload under "${key}" must still be shown`);
  }
});

test("a long list is capped and says how many more, rather than dumping or silently cutting", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ title: `Task ${i + 1}` }));
  const text = runOutcomeText(run([step({ title: "Tasks", result: { tasks: many } })]));
  assert.match(text, /Task 1\b/);
  assert.match(text, /and 18 more/, "the remainder is disclosed, not dropped");
});

test("reasoning text still appears, with the fetched rows FIRST", () => {
  const text = runOutcomeText(run([
    step({ toolId: "calendar.list", title: "Events", result: { events: [{ title: "Movie night" }] } }),
    step({ index: 1, toolId: null, title: "Summarize", result: { text: "You have one thing tonight." } }),
  ]));
  assert.match(text, /Movie night/);
  assert.match(text, /You have one thing tonight/);
  assert.ok(text.indexOf("Movie night") < text.indexOf("You have one thing tonight"),
    "when a family asked to SEE something, the list leads and the narration follows");
});

test("a run with nothing fetched is unchanged — no invented content", () => {
  const text = runOutcomeText(run([step({ toolId: "homeops.create_task", title: "Add task", result: { ok: true } })]));
  assert.doesNotMatch(text, /•/, "no bullet list is fabricated when the run returned no rows");
  assert.match(text, /Done|finished/i);
});

test("non-row payloads never leak raw JSON into the chat", () => {
  const text = runOutcomeText(run([step({ title: "Config", result: { settings: [{ enabled: true }, { enabled: false }] } })]));
  assert.doesNotMatch(text, /\{|\}/, "objects with no human-readable name are skipped, not stringified");
});

/* ---- K2: "still not returned in line, in chat, RESULTS AS CARDS" -------------------- */

test("the rows also come back as STRUCTURE, so the chat can render them as cards", () => {
  const groups = runResultGroups(run([
    step({
      toolId: "google.places.search", title: "Find restaurants nearby",
      result: { places: [
        { name: "Terra & Vine", rating: 4.7, priceLevel: "$$", address: "12 Main St", busy: "Usually busy", waitTime: "25 min", distance: "1.4 mi", driveTime: "6 min", url: "https://example.com/tv" },
        { name: "Hearth", rating: 4.5, address: "88 Oak Ave" },
      ] },
    }),
  ]));
  assert.equal(groups.length, 1);
  const g = groups[0];
  assert.equal(g.title, "Find restaurants nearby");
  assert.equal(g.connector, "Google", "the card names the connection its data came through (A10)");
  assert.equal(g.rows.length, 2);
  const [first] = g.rows;
  assert.equal(first.title, "Terra & Vine");
  assert.equal(first.where, "12 Main St");
  assert.equal(first.url, "https://example.com/tv");
  // The exact comparison the owner asked for: "whether it is often busy or not right now,
  // estimated wait time" plus distance and drive time — each as its own labelled fact.
  const labels = first.meta.map((m) => m.label);
  for (const want of ["Rating", "Price", "Busy now", "Wait", "Distance", "Drive"]) {
    assert.ok(labels.includes(want), `"${want}" must be a comparable fact on the card, got ${labels.join(", ")}`);
  }
  assert.equal(first.meta.find((m) => m.label === "Rating").value, "4.7★");
});

test("cards and text are built from the SAME extraction — they cannot disagree", () => {
  const r = run([step({ toolId: "calendar.list", title: "Events", result: { events: [
    { title: "All-school movie night", startAt: "2026-07-24T17:00:00.000Z", location: "St. Jude Catholic Church" },
  ] } })]);
  const text = runOutcomeText(r);
  const [card] = runResultGroups(r)[0].rows;
  assert.match(text, new RegExp(card.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(text, new RegExp(card.where.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("includeRows:false drops the bullets but keeps the headline and the caveats", () => {
  const r = run([
    step({ toolId: "calendar.list", title: "Events", result: { events: [{ title: "Movie night" }] } }),
    step({ index: 1, toolId: "gmail.send", title: "Email the family", status: "skipped_no_tool" }),
  ]);
  const full = runOutcomeText(r);
  const carded = runOutcomeText(r, { includeRows: false });
  assert.match(full, /Movie night/);
  assert.doesNotMatch(carded, /Movie night/, "the card renders this row — the prose must not repeat it");
  assert.match(carded, /Not sent/, "a step that didn't deliver is still disclosed in the prose");
});

test("a row with no name yields no card — never a JSON blob with a chevron on it", () => {
  assert.equal(rowCard({ enabled: true, count: 4 }), null);
  assert.equal(rowCard(null), null);
  assert.deepEqual(rowCard("Pick up Beannie at 4"), { title: "Pick up Beannie at 4" });
});

test("openNow reads as a sentence in both directions, not \"Open: true\"", () => {
  assert.equal(rowCard({ name: "Hearth", openNow: true }).meta[0].value, "Open now");
  assert.equal(rowCard({ name: "Hearth", openNow: false }).meta[0].value, "Closed now");
});

test("FamiliOS's own functions claim no connector — only real connections are named", () => {
  const groups = runResultGroups(run([step({ toolId: "homeops.list_tasks", title: "Tasks", result: { tasks: [{ title: "Car oil change" }] } })]));
  assert.equal(groups[0].connector, undefined, "an internal function must not be dressed up as a connected service");
});

test("the card cap matches the text cap and discloses the remainder", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ title: `Task ${i + 1}` }));
  const [g] = runResultGroups(run([step({ title: "Tasks", result: { tasks: many } })]));
  assert.equal(g.rows.length, 12);
  assert.equal(g.more, 18);
});
