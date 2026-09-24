// The phone's calendar refresh coordinator (ADR-005): one request at a time, none within ~20 s
// of the last, except a screen that needs to wait for fresh data.
import test from "node:test";
import assert from "node:assert/strict";
import { createRefresher } from "./calendar-refresh.ts";

function harness() {
  const calls = [];
  const pending = [];
  let t = 1_000_000;
  const call = (reason, wait) => {
    calls.push({ reason, wait });
    return new Promise((resolve) => pending.push(resolve));
  };
  const finish = async () => { pending.shift()?.({ ok: true }); await new Promise((r) => setImmediate(r)); };
  const r = createRefresher(call, { minGapMs: 20_000, now: () => t });
  return { r, calls, finish, advance: (ms) => { t += ms; } };
}

test("calls made while one is in flight join it", async () => {
  const { r, calls, finish } = harness();
  const a = r.refresh("launch");
  const b = r.refresh("foreground");
  await new Promise((res) => setImmediate(res));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { reason: "launch", wait: false });
  await finish();
  await Promise.all([a, b]);
  assert.equal(calls.length, 1);
});

test("a call within 20 s of the last is skipped; after that it goes through", async () => {
  const { r, calls, finish, advance } = harness();
  void r.refresh("launch");
  await new Promise((res) => setImmediate(res));
  await finish();
  advance(5_000);
  await r.refresh("foreground");
  assert.equal(calls.length, 1, "skipped inside the gap");
  advance(16_000);
  void r.refresh("foreground");
  await new Promise((res) => setImmediate(res));
  assert.equal(calls.length, 2);
  assert.equal(calls[1].reason, "foreground");
});

test("a screen that waits always asks, even inside the gap", async () => {
  const { r, calls, finish, advance } = harness();
  void r.refresh("launch");
  await new Promise((res) => setImmediate(res));
  await finish();
  advance(2_000);
  const p = r.refresh("calendar_open", { wait: true });
  await new Promise((res) => setImmediate(res));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { reason: "calendar_open", wait: true });
  let done = false;
  void p.then(() => { done = true; });
  await new Promise((res) => setImmediate(res));
  assert.equal(done, false, "resolves only once the server answered");
  await finish();
  assert.equal(done, true);
});

test("a waiting call behind a fire-and-forget one asks again after it, once", async () => {
  const { r, calls, finish } = harness();
  void r.refresh("launch");
  const w1 = r.refresh("calendar_open", { wait: true });
  const w2 = r.refresh("calendar_open", { wait: true });
  await new Promise((res) => setImmediate(res));
  assert.equal(calls.length, 1, "never two on the wire");
  await finish();
  await new Promise((res) => setImmediate(res));
  assert.equal(calls.length, 2, "the two waiting callers share one follow-up");
  assert.deepEqual(calls[1], { reason: "calendar_open", wait: true });
  await finish();
  await Promise.all([w1, w2]);
});

test("a waiting call joins a waiting call already in flight", async () => {
  const { r, calls, finish } = harness();
  const a = r.refresh("calendar_open", { wait: true });
  const b = r.refresh("calendar_open", { wait: true });
  await new Promise((res) => setImmediate(res));
  assert.equal(calls.length, 1);
  await finish();
  await Promise.all([a, b]);
});

test("a failed refresh never rejects and does not wedge the next one", async () => {
  let n = 0;
  let t = 0;
  const r = createRefresher(async () => { n++; throw new Error("offline"); }, { minGapMs: 20_000, now: () => t });
  await r.refresh("launch");
  t += 21_000;
  await r.refresh("foreground");
  assert.equal(n, 2);
});
