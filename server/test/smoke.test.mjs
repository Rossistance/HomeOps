// Smoke test — proves the harness boots the real server in isolation and can drive it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { startServer, stopServer, makeSession } from "./harness.mjs";

let ctx;
let staticDir;
before(async () => {
  staticDir = fs.mkdtempSync(join(os.tmpdir(), "homeops-static-"));
  fs.mkdirSync(join(staticDir, "assets"), { recursive: true });
  fs.writeFileSync(join(staticDir, "index.html"), "<!doctype html><div id=\"root\">FamiliOS shell</div>", "utf8");
  fs.writeFileSync(join(staticDir, "assets", "app.js"), "console.log('homeops');", "utf8");
  ctx = await startServer({ env: { HOMEOPS_STATIC_DIR: staticDir } });
});
after(async () => {
  await stopServer(ctx);
  try { fs.rmSync(staticDir, { recursive: true, force: true }); } catch { /* best effort */ }
});

test("health endpoint responds", async () => {
  const r = await ctx.fetch("/api/health");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.ok, true);
  assert.equal(body.authRequired, true);
});

test("a session can be created for a seeded member", async () => {
  const owner = await makeSession(ctx, "m-alex");
  assert.equal(owner.status, 200);
  assert.ok(owner.csrf, "session should issue a CSRF token");
});

test("serves the built frontend shell and static assets", async () => {
  const home = await fetch(ctx.base + "/");
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type") ?? "", /text\/html/);
  assert.match(await home.text(), /FamiliOS shell/);

  const route = await fetch(ctx.base + "/settings");
  assert.equal(route.status, 200);
  assert.match(await route.text(), /FamiliOS shell/);

  const asset = await fetch(ctx.base + "/assets/app.js");
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get("content-type") ?? "", /javascript/);
  assert.match(await asset.text(), /homeops/);
});
