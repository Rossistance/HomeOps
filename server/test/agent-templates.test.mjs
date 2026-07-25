// G6 — [19:18] "There's only four templates in the mobile app, but the web app has a lot
// more. Those all need to be brought over here, and grouped into sections so I can navigate
// them quickly."
//
// Mobile carried four hand-written entries that existed nowhere else; the web read thirteen
// from its own file. Two catalogs, one a stub, neither authoritative. These tests hold the
// server's list to being the one both can ask for — and to being a list of PROMPTS, not
// canned agents, because a pre-built step graph would promise a setup a household may not
// have.
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { startServer, stopServer, makeSession } from "./harness.mjs";
import { AGENT_TEMPLATES, agentTemplateSections } from "../agent-templates.mjs";

let ctx;
before(async () => { ctx = await startServer(); });
after(async () => { await stopServer(ctx); });

test("there are substantially more than the four mobile shipped", () => {
  assert.ok(AGENT_TEMPLATES.length >= 13, `expected the full catalog, got ${AGENT_TEMPLATES.length}`);
});

test("every template is complete enough to actually start from", () => {
  for (const t of AGENT_TEMPLATES) {
    assert.ok(t.id && t.name && t.icon && t.category, `${t.name}: missing identity fields`);
    assert.ok(t.desc?.length > 8, `${t.name}: needs a line that says what it does`);
    // The prompt is the whole mechanism — it goes to the real planner. A stub here would
    // produce a helper that doesn't match its own card.
    assert.ok(t.prompt?.length > 40, `${t.name}: the prompt has to describe the job`);
    assert.match(t.prompt, /helper|agent/i, `${t.name}: the prompt must ask for a helper`);
  }
});

test("ids are unique — a duplicate would silently shadow a template", () => {
  const ids = AGENT_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("every template lands in a section — none is orphaned out of the UI", () => {
  const grouped = agentTemplateSections().flatMap((s) => s.templates.map((t) => t.id));
  for (const t of AGENT_TEMPLATES) {
    assert.ok(grouped.includes(t.id), `"${t.name}" has category "${t.category}", which no section renders`);
  }
});

test("no empty sections — a heading with nothing under it is just noise", () => {
  for (const s of agentTemplateSections()) assert.ok(s.templates.length > 0, `${s.title} is empty`);
});

test("GET /api/agent-templates serves the grouped catalog to a signed-in member", async () => {
  const s = await makeSession(ctx, "m-alex");
  const r = await s.req("/api/agent-templates");
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.data.sections) && r.data.sections.length > 1, "sections, plural — that's the ask");
  const total = r.data.sections.reduce((n, x) => n + x.templates.length, 0);
  assert.equal(total, AGENT_TEMPLATES.length, "the wire response carries the whole catalog");
  assert.ok(r.data.sections[0].templates[0].prompt, "and the prompt the planner needs");
});

test("it needs a session — the catalog is not an anonymous endpoint", async () => {
  const r = await ctx.fetch("/api/agent-templates");
  assert.equal(r.status, 401);
});
