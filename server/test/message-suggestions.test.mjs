// SUGGESTIONS BESIDE A MESSAGE — Famili proposes, a person disposes, exactly once.
// Runs with the test extractor (HOMEOPS_SUGGEST_FAKE=1: bracketed directives in the text), so
// the whole path after the model — storing on the message, the atomic apply, dedupe, the
// ownership rule that turns another member's item into a request — is exercised without a
// provider. Invariants: a suggestion lands on the message for everyone; the first apply wins
// and the second is told; a create whose title already exists that day closes as a duplicate
// instead of a second copy; an update to someone else's event by a non-parent becomes a
// "Can you help?" to the owner, and a parent's applies directly; a system line records it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx, alex, morgan, jamie;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
before(async () => {
  ctx = await startServer({ env: { HOMEOPS_SUGGEST_FAKE: "1" } });
  alex = await makeSession(ctx, "m-alex");
  await alex.req("/api/members", { method: "POST", body: JSON.stringify({ actorId: "m-jamie", displayName: "Jamie Harper", role: "Adult Member" }) });
  morgan = await makeSession(ctx, "m-morgan");
  jamie = await makeSession(ctx, "m-jamie");
});
after(async () => { await stopServer(ctx); });

const send = (who, id, text) => who.req(`/api/threads/${id}/messages`, { method: "POST", body: JSON.stringify({ text }) });
async function waitSuggestions(who, threadId, messageId, n = 1) {
  for (let i = 0; i < 40; i++) {
    const v = await who.req(`/api/threads/${threadId}`);
    const m = v.data.messages.find((x) => x.id === messageId);
    if (m && (m.suggestions ?? []).length >= n) return m;
    await sleep(100);
  }
  throw new Error("suggestions never arrived");
}
const act = (who, t, mid, sid, action = "apply") => who.req(`/api/threads/${t}/messages/${mid}/suggestions/${sid}`, { method: "POST", body: JSON.stringify({ action }) });

test("a suggestion lands on the message for everyone; the first apply wins, the second is told; a system line records it", async () => {
  const t = (await alex.req("/api/threads", { method: "POST", body: JSON.stringify({ participantIds: ["m-morgan", "m-jamie"], title: "Logistics" }) })).data.thread.id;
  const m = (await send(alex, t, "Can someone grab the dry cleaning Friday? [suggest task: Pick up dry cleaning | dueAt=2026-09-25 | assignedMemberId=m-morgan]")).data.message;
  const withS = await waitSuggestions(morgan, t, m.id);
  const s = withS.suggestions[0];
  assert.equal(s.status, "open");
  assert.equal(s.kind, "create"); assert.equal(s.type, "task");
  assert.equal(s.title, "Pick up dry cleaning");
  // Both Morgan and Jamie tap Add at once.
  const [a, b] = await Promise.all([act(morgan, t, m.id, s.id), act(jamie, t, m.id, s.id)]);
  const winner = a.status === 200 ? a : b; const loser = a.status === 200 ? b : a;
  assert.equal(winner.status, 200, JSON.stringify(winner.data));
  assert.equal(loser.status, 409);
  assert.equal(loser.data.error, "already_taken");
  assert.equal(winner.data.suggestion.status, "applied");
  const taskId = winner.data.suggestion.result.created.id;
  const tasks = (await alex.req("/api/tasks")).data.tasks;
  const created = tasks.find((x) => x.id === taskId);
  assert.equal(created.title, "Pick up dry cleaning");
  assert.equal(created.assignedMemberId, "m-morgan");
  assert.ok(String(created.dueAt).startsWith("2026-09-25"), created.dueAt);
  const v = await alex.req(`/api/threads/${t}`);
  assert.equal(v.data.messages.find((x) => x.id === m.id).suggestions[0].status, "applied", "closed for everyone");
  assert.ok(v.data.messages.some((x) => x.kind === "system" && /added the task “Pick up dry cleaning”/.test(x.text)), "a system line says who did it");
});

test("dismiss closes it for everyone without creating anything", async () => {
  const t = (await alex.req("/api/threads", { method: "POST", body: JSON.stringify({ participantIds: ["m-morgan"] }) })).data.thread.id;
  const m = (await send(alex, t, "[suggest task: Buy stamps]")).data.message;
  const s = (await waitSuggestions(morgan, t, m.id)).suggestions[0];
  const r = await act(morgan, t, m.id, s.id, "dismiss");
  assert.equal(r.data.suggestion.status, "dismissed");
  assert.equal((await act(alex, t, m.id, s.id)).status, 409);
  assert.ok(!(await alex.req("/api/tasks")).data.tasks.some((x) => x.title === "Buy stamps"));
});

test("a create whose title already exists that day closes as a duplicate instead of a second copy", async () => {
  const ev = await alex.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Dentist for Lily", startAt: "2026-10-02T14:00:00.000Z", endAt: "2026-10-02T15:00:00.000Z" }) });
  assert.equal(ev.status, 200);
  const t = (await alex.req("/api/threads", { method: "POST", body: JSON.stringify({ participantIds: ["m-morgan"] }) })).data.thread.id;
  const m = (await send(morgan, t, "[suggest event: Dentist for Lily | startAt=2026-10-02T14:00:00.000Z]")).data.message;
  const s = (await waitSuggestions(alex, t, m.id)).suggestions[0];
  const r = await act(alex, t, m.id, s.id);
  assert.equal(r.status, 200);
  assert.equal(r.data.suggestion.result.duplicateOf, ev.data.event.id);
  const events = (await alex.req("/api/events")).data.events.filter((e) => e.title === "Dentist for Lily");
  assert.equal(events.length, 1, "no second copy");
});

test("an update to someone else's event: a non-parent asks the owner, a parent applies it", async () => {
  const ev = (await alex.req("/api/events", { method: "POST", body: JSON.stringify({ title: "Soccer practice", startAt: "2026-10-05T21:00:00.000Z", endAt: "2026-10-05T22:00:00.000Z", location: "Field 3" }) })).data.event;
  const t = (await alex.req("/api/threads", { method: "POST", body: JSON.stringify({ participantIds: ["m-morgan", "m-jamie"], title: "Practice" }) })).data.thread.id;
  const m = (await send(jamie, t, `Coach says field 7 now [suggest event update ${ev.id}: Soccer practice | location=Field 7]`)).data.message;
  const s = (await waitSuggestions(jamie, t, m.id)).suggestions[0];
  assert.equal(s.kind, "update");
  assert.equal(s.ownerActorId, "m-alex");
  // Jamie (Adult Member, not the owner) applies → a help request to Alex, event untouched.
  const r = await act(jamie, t, m.id, s.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.suggestion.result.requested.toActorId, "m-alex");
  assert.equal((await alex.req("/api/events")).data.events.find((e) => e.id === ev.id).location, "Field 3", "nothing moved");
  const asks = (await alex.req("/api/help-requests")).data.helpRequests.filter((h) => h.toActorId === "m-alex" && h.eventId === ev.id);
  assert.equal(asks.length, 1);
  assert.match(asks[0].message, /Field 7/);
  // A second suggestion, applied by Morgan (Adult Admin — a parent) → applied directly.
  const m2 = (await send(jamie, t, `[suggest event update ${ev.id}: Soccer practice | location=Field 9]`)).data.message;
  const s2 = (await waitSuggestions(morgan, t, m2.id)).suggestions[0];
  const r2 = await act(morgan, t, m2.id, s2.id);
  assert.equal(r2.status, 200, JSON.stringify(r2.data));
  assert.equal((await alex.req("/api/events")).data.events.find((e) => e.id === ev.id).location, "Field 9");
});

test("a help suggestion becomes a real Can-you-help to the named member", async () => {
  const t = (await alex.req("/api/threads", { method: "POST", body: JSON.stringify({ participantIds: ["m-morgan"] }) })).data.thread.id;
  const m = (await send(alex, t, "[suggest help: Can you take Lily to dance Thursday? | toActorId=m-morgan]")).data.message;
  const s = (await waitSuggestions(alex, t, m.id)).suggestions[0];
  assert.equal(s.type, "help");
  const r = await act(alex, t, m.id, s.id);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const hr = (await morgan.req("/api/help-requests")).data.helpRequests.find((h) => h.id === r.data.suggestion.result.created.id);
  assert.equal(hr.toActorId, "m-morgan");
  assert.equal(hr.message, "Can you take Lily to dance Thursday?");
});
