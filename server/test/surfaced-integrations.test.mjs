/* What the app OFFERS to set up, versus what the engine can reach.
 *
 * Most of the OAuth providers are real code with no credentials behind them. Every one of
 * them was a row a family could tap, read a scope list for, and get nowhere with — clutter
 * in front of the handful of things that actually work. The same went for connectors that
 * are not live.
 *
 * So the two list endpoints that feed the Connections screens on web and mobile are
 * filtered. The thing this file exists to prove is that the filter is COSMETIC: toolCatalog
 * reads PROVIDERS and CONNECTORS straight from their modules, so nothing hidden here can
 * stop a tool running, a helper working, or a connected account being used. If that ever
 * stops being true, this is where it shows up.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HOMEOPS_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "familios-surfaced-"));
process.on("exit", () => { try { fs.rmSync(process.env.HOMEOPS_DATA_DIR, { recursive: true, force: true }); } catch { /* best effort */ } });

const { startServer, stopServer, makeSession } = await import("./harness.mjs");
const { PROVIDERS } = await import("../providers.mjs");
const { CONNECTORS } = await import("../connectors.mjs");

let ctx, alex;

before(async () => {
  ctx = await startServer({ env: { HOMEOPS_CONNECTOR_SANDBOX: "1" } });
  alex = await makeSession(ctx, "m-alex");
});
after(async () => { await stopServer(ctx); });

test("ONLY GOOGLE IS OFFERED, though the others still exist in code", async () => {
  const r = await alex.req("/api/providers");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const ids = r.data.providers.map((p) => p.id);

  assert.deepEqual(ids, ["google"], `the app offers one provider: ${JSON.stringify(ids)}`);
  /* The point of the assertion is the gap between these two numbers. The others are not
   * deleted — they are not OFFERED, because offering a credential-less integration is
   * promising something the deployment cannot deliver. Add an id to SURFACED_PROVIDER_IDS
   * in index.mjs when one is genuinely wired up; that it takes a code change is the
   * feature. */
  assert.ok(PROVIDERS.length > ids.length,
    `and the rest are still in the registry, just not on the shelf: ${PROVIDERS.length} defined`);
});

test("only LIVE connectors are offered, and the set is not hard-coded", async () => {
  const r = await alex.req("/api/connectors");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const shown = r.data.connectors;

  assert.ok(shown.every((c) => c.live), `nothing that needs setup is offered: ${JSON.stringify(shown.map((c) => [c.id, c.live]))}`);
  /* Filtered on `live` rather than by name on purpose: that set moves on its own. The
   * iMessage bridge is live today and was not last week, and a hard-coded list would have
   * hidden the thing this deployment runs on. */
  assert.ok(CONNECTORS.length >= shown.length, "the catalog is unchanged; only the listing is narrowed");
});

test("THE FILTER IS COSMETIC — the engine still reaches what the app stopped offering", async () => {
  /* The invariant that makes the whole change safe: buildToolSet -> toolCatalog reads
   * PROVIDERS and CONNECTORS directly and never these endpoints, so hiding a SETUP surface
   * must never become revoking a capability.
   *
   * Demonstrated with a CONNECTOR rather than a provider, and the reason is worth writing
   * down. An unoffered provider's tools are absent from the catalog anyway — not because of
   * this filter, but because it has no connected account, which is a different mechanism
   * that was already there. Using one to "prove" the invariant would prove nothing.
   * Connectors need no OAuth, so a hidden one is hidden by THIS filter alone, and its tools
   * being present is the actual evidence. */
  const shown = new Set((await alex.req("/api/connectors")).data.connectors.map((c) => c.id));
  const hidden = CONNECTORS.filter((c) => !shown.has(c.id) && (c.tools ?? []).length);
  assert.ok(hidden.length, `precondition: something is hidden and has tools (shown: ${JSON.stringify([...shown])})`);

  const { toolCatalog } = await import("../context.mjs");
  const catalogIds = new Set(toolCatalog({ actorId: "m-alex", role: "Owner", householdId: "local" }).map((t) => t.toolId));

  for (const c of hidden) {
    for (const t of c.tools) {
      assert.ok(catalogIds.has(t.id),
        `${c.id} is off the shelf but ${t.id} is still callable by a helper that already uses it`);
    }
  }
});
