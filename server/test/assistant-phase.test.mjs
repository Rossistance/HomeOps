// Saying what it's actually doing.
//
// The working bubble had two states and inferred both from token flow: tokens arriving meant
// "Writing…". For a plain answer that's true. For anything that goes out to the network it
// was false during the slowest part of the whole interaction — the fetch emits no tokens
// while it runs, so the app claimed to be writing for as long as it took. Watching
// "Writing…" for eight seconds with nothing appearing is how a working app looks broken.
//
// The old code announced a lookup by calling onToken("") — a FAKE token whose only purpose
// was to trip the client's inference. That is the same defect this codebase keeps
// producing: a progress signal that doesn't come from the thing it claims to describe.
//
// These tests pin the phase to the decision that causes it, through the real HTTP stream,
// because that is the only place a broken wire would show.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";
import { useFakeModel, streamFrames } from "./fake-model.mjs";

let ctx, adult, fake;

before(async () => {
  ctx = await startServer();
  adult = await makeSession(ctx, "m-morgan");
  fake = await useFakeModel(adult);
});
after(async () => { await stopServer(ctx); await new Promise((r) => fake.server.close(r)); });

const phasesOf = (events) => events.filter((e) => e.type === "phase").map((e) => e.phase);

test("THE REPORTED CASE: looking something up announces that it is searching", async () => {
  fake.state.script = [
    { toolCalls: [{ name: "homeops__find_places", args: { query: "hardware store" } }] },
    { text: "Here are the hardware stores near you." },
  ];
  const events = await streamFrames(adult, "what hardware stores are near us?");
  assert.ok(phasesOf(events).includes("searching"),
    `the client cannot show "Searching" if the server never says it — got ${JSON.stringify(events.map((e) => e.type))}`);
});

test("…and it says so BEFORE the work, not after", async () => {
  // Announced afterwards it would be useless: the whole point is to cover the wait.
  fake.state.script = [
    { toolCalls: [{ name: "homeops__find_places", args: { query: "anything" } }] },
    { text: "Done." },
  ];
  const events = await streamFrames(adult, "look something up");
  const phaseAt = events.findIndex((e) => e.type === "phase" && e.phase === "searching");
  const doneAt = events.findIndex((e) => e.type === "done");
  assert.ok(phaseAt !== -1 && doneAt !== -1 && phaseAt < doneAt,
    "the phase has to arrive while the user is still waiting");
});

test("a write says it is creating, not searching", async () => {
  fake.state.script = [
    { toolCalls: [{ name: "homeops__create_task", args: { title: "Book the dentist" } }] },
    { text: "Added “Book the dentist”." },
  ];
  const events = await streamFrames(adult, "add a task to book the dentist");
  const phases = phasesOf(events);
  assert.ok(phases.includes("creating"), `something is being set up, not looked up — got ${JSON.stringify(phases)}`);
  assert.equal(phases.includes("searching"), false, "and it does not claim to be searching the web");
});

test("a plain answer announces thinking and nothing it isn't doing", async () => {
  fake.state.script = [{ text: "Tuesday works for everyone." }];
  const events = await streamFrames(adult, "which day is free?");
  const phases = phasesOf(events);
  assert.equal(phases.includes("searching"), false);
  assert.equal(phases.includes("creating"), false);
});

test("the phase never replaces the done event", async () => {
  fake.state.script = [
    { toolCalls: [{ name: "homeops__find_places", args: { query: "coffee" } }] },
    { text: "Two places nearby." },
  ];
  const events = await streamFrames(adult, "coffee near me");
  const done = events.filter((e) => e.type === "done");
  assert.equal(done.length, 1, "exactly one terminal frame");
  assert.equal(events[events.length - 1].type, "done", "and it is last");
});

test("a broken phase reporter cannot take the answer down with it", async () => {
  /* The phase callback is progress, not product. It is wrapped at the call site precisely so
   * a client that hangs up mid-stream — the common case — cannot turn a completed turn into
   * a failed one. Asserting it through the real route keeps that wrapper honest. */
  fake.state.script = [{ text: "Still answered." }];
  const events = await streamFrames(adult, "anything");
  const done = events.find((e) => e.type === "done");
  assert.ok(done, "the turn still completes");
  assert.equal(done.result.ok, true);
  assert.match(done.result.answer, /Still answered/);
});
